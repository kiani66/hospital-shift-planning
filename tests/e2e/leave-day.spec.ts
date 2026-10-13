import { expect, test, type Page } from "@playwright/test";
import { signInAndWait } from "./support/auth";
import { provisionExplicitOffDepartment } from "./support/explicit-off";
import { abanState } from "./support/requests";

/**
 * D118: Leave (H) in the Head Nurse's schedule. The fixture is fully staffed
 * except «پرستار آزمایشی ۱» on 27 Oct (undecided, with an OFF wish), so
 * recording leave there completes the month without touching coverage.
 */

const DAY = "2026-10-27";
const header = (page: Page) =>
  page.locator('section[aria-labelledby="schedule-month-heading"]');
const dialog = (page: Page) => page.getByRole("dialog");
const row = (page: Page) =>
  dialog(page)
    .locator("li[data-nurse-row]")
    .filter({ hasText: "پرستار آزمایشی ۱" });
const controls = (page: Page) =>
  dialog(page).getByRole("group", { name: "شیفت پرستار آزمایشی ۱" });
const leave = (page: Page) =>
  controls(page).getByRole("button", { name: "مرخصی (H)", exact: true });
const saved = async (page: Page) => {
  await expect(dialog(page).locator("[data-pending]")).toHaveCount(0);
  await expect(dialog(page).getByRole("status").first()).toContainText(
    /ثبت شد|پاک شد/,
  );
};
async function confirm(page: Page, trigger: string, label: string) {
  await header(page).getByRole("button", { name: trigger }).click();
  await dialog(page).getByRole("button", { name: label }).click();
  await expect(dialog(page)).toBeHidden();
}
async function closeDay(page: Page, url: string) {
  await dialog(page).getByRole("button", { name: "بستن جزئیات روز" }).click();
  await expect(page).toHaveURL(url);
  await expect(dialog(page)).toBeHidden();
}

test("Head Nurse records leave (H) in the monthly schedule; the nurse sees «مرخصی» once approved", async ({
  page,
}) => {
  test.slow();
  const d = await provisionExplicitOffDepartment();
  const url = `/departments/${d.code}/schedule?month=1405-08`;
  await signInAndWait(page, d.headEmail);
  await page.goto(`${url}&day=${DAY}`);

  // H sits next to the other codes, shows its code, is named «مرخصی (H)».
  await expect(leave(page)).toHaveText("H");
  await leave(page).click();
  await saved(page);
  await expect(leave(page)).toHaveAttribute("aria-pressed", "true");
  // An OFF wish is not leave: a neutral mismatch, never converted.
  await expect(row(page)).toContainText("مغایر ترجیح");
  expect((await abanState(d, d.nurseEmail, DAY)).shift).toBe("H");

  // Replace with a working shift, then back to leave by keyboard (H).
  await controls(page)
    .getByRole("button", { name: "صبح (M)", exact: true })
    .click();
  await saved(page);
  expect((await abanState(d, d.nurseEmail, DAY)).shift).toBe("M");
  await controls(page)
    .getByRole("button", { name: "صبح (M)", exact: true })
    .focus();
  await page.keyboard.press("h");
  await saved(page);
  await expect(leave(page)).toHaveAttribute("aria-pressed", "true");
  // Clearing returns to undecided; leave again completes the day.
  await controls(page)
    .getByRole("button", { name: "تعیین‌نشده", exact: true })
    .click();
  await saved(page);
  expect((await abanState(d, d.nurseEmail, DAY)).shift).toBeNull();
  await leave(page).click();
  await saved(page);

  // The month: the day counts one nurse on leave; nothing blocks finalizing.
  await closeDay(page, url);
  await expect(page.locator(`#day-${DAY}`)).toHaveAttribute(
    "aria-label",
    /۱ نفر مرخصی \(H\)/,
  );
  await expect(page.locator("#workflow-blockers")).toHaveCount(0);
  await confirm(page, "نهایی‌سازی برنامه", "بله، نهایی شود");
  await confirm(page, "ارسال برای تأیید", "بله، ارسال شود");

  // SUBMITTED is locked: the day opens read-only, no shift controls.
  await page.goto(`${url}&day=${DAY}`);
  await expect(controls(page)).toHaveCount(0);
  await closeDay(page, url);

  // The Supervisor's read-only day lists the nurse under «مرخصی».
  await page.context().clearCookies();
  await signInAndWait(page, d.supervisorEmail);
  await page.goto(`/review/${d.abanId}?day=${DAY}`);
  const section = dialog(page).getByTestId("day-leave");
  await section.locator("summary").click();
  await expect(section).toContainText("مرخصی (۱ نفر)");
  await expect(section).toContainText("پرستار آزمایشی ۱");
  await closeDay(page, `/review/${d.abanId}`);
  await confirm(page, "تأیید برنامه", "بله، تأیید شود");

  // The nurse sees «مرخصی» as official, counted apart from shifts and rest.
  await page.context().clearCookies();
  await signInAndWait(page, d.nurseEmail);
  await page.goto(`/my-shifts?month=1405-08&day=${DAY}`);
  await expect(page.locator('[data-publication="OFFICIAL"]')).toBeVisible();
  await expect(
    page.getByRole("region", { name: "سه‌شنبه ۵ آبان ۱۴۰۵" }),
  ).toContainText("مرخصی");
  await expect(
    page
      .locator("dt", { hasText: "روزهای مرخصی" })
      .locator("xpath=following-sibling::dd"),
  ).toHaveText("۱");
  expect(await abanState(d, d.nurseEmail, DAY)).toMatchObject({
    shift: "H",
    approvedShift: "H",
  });
});

for (const width of [360, 390]) {
  test(`the leave control fits ${width}px with an accessible touch target`, async ({
    page,
  }) => {
    const d = await provisionExplicitOffDepartment();
    await page.setViewportSize({ width, height: 800 });
    await signInAndWait(page, d.headEmail);
    await page.goto(`/departments/${d.code}/schedule?month=1405-08&day=${DAY}`);
    await expect(leave(page)).toHaveText("H");
    const box = (await leave(page).boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
    await leave(page).click();
    await saved(page);
    await expect(leave(page)).toHaveAttribute("aria-pressed", "true");
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
  });
}
