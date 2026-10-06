import { expect, test, type Page } from "@playwright/test";
import { signInAndWait } from "./support/auth";
import { provisionExplicitOffDepartment } from "./support/explicit-off";
import { abanState } from "./support/requests";

const header = (page: Page) =>
  page.locator('section[aria-labelledby="schedule-month-heading"]');
const dialog = (page: Page) => page.getByRole("dialog");
const row = (page: Page) =>
  dialog(page)
    .locator("li[data-nurse-row]")
    .filter({ hasText: "پرستار آزمایشی ۱" });
const controls = (page: Page) =>
  dialog(page).getByRole("group", { name: "شیفت پرستار آزمایشی ۱" });
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

test("explicit OFF, pending clear, independent staffing and publication through approval", async ({
  page,
}) => {
  test.slow();
  const d = await provisionExplicitOffDepartment();
  const url = `/departments/${d.code}/schedule?month=1405-08`;
  await signInAndWait(page, d.headEmail);
  await page.goto(url);
  await expect(
    header(page).getByRole("button", { name: "نهایی‌سازی برنامه" }),
  ).toBeDisabled();
  await expect(page.locator("#workflow-blockers")).toContainText(
    "۱ تصمیم تعیین‌نشده",
  );
  await page.goto(`${url}&day=2026-10-27`);
  await expect(row(page)).toContainText("در انتظار تخصیص");
  await controls(page)
    .getByRole("button", { name: "استراحت", exact: true })
    .click();
  await saved(page);
  await expect(row(page)).toContainText("مطابق ترجیح");
  expect((await abanState(d, d.nurseEmail, "2026-10-27")).shift).toBe("OFF");
  await controls(page)
    .getByRole("button", { name: "تعیین‌نشده", exact: true })
    .click();
  await saved(page);
  await expect(row(page)).toContainText("در انتظار تخصیص");
  expect((await abanState(d, d.nurseEmail, "2026-10-27")).shift).toBeNull();
  await controls(page)
    .getByRole("button", { name: "استراحت", exact: true })
    .focus();
  await page.keyboard.press("o");
  await saved(page);
  await expect(row(page)).toContainText("مطابق ترجیح");
  // Fully decided day, but OFF cannot cover Morning or Evening.
  const head = dialog(page).getByRole("group", {
    name: "شیفت سرپرستار آزمایشی",
  });
  await head.getByRole("button", { name: "استراحت", exact: true }).click();
  await saved(page);
  await closeDay(page, url);
  await expect(page.locator("#workflow-blockers")).toContainText(
    "۲ مشکل پوشش (۲ کمبود نیرو)",
  );
  await expect(page.locator("#workflow-blockers")).not.toContainText(
    "تصمیم تعیین‌نشده",
  );
  await expect(
    header(page).getByRole("button", { name: "نهایی‌سازی برنامه" }),
  ).toBeDisabled();
  await page.goto(`${url}&day=2026-10-27`);
  await dialog(page)
    .getByRole("group", { name: "شیفت سرپرستار آزمایشی" })
    .getByRole("button", { name: "طولانی (ME)" })
    .click();
  await saved(page);
  await closeDay(page, url);
  await expect(page.locator("#workflow-blockers")).toHaveCount(0);
  await confirm(page, "نهایی‌سازی برنامه", "بله، نهایی شود");
  await confirm(page, "ارسال برای تأیید", "بله، ارسال شود");
  await page.context().clearCookies();
  await signInAndWait(page, d.supervisorEmail);
  await page.goto(`/review/${d.abanId}?day=2026-10-27`);
  await expect(dialog(page).getByRole("group", { name: /^شیفت / })).toHaveCount(
    0,
  );
  await expect(dialog(page)).toContainText("استراحت");
  await closeDay(page, `/review/${d.abanId}`);
  await confirm(page, "تأیید برنامه", "بله، تأیید شود");
  await page.context().clearCookies();
  await signInAndWait(page, d.nurseEmail);
  await page.goto("/my-shifts?month=1405-08&day=2026-10-27");
  await expect(page.locator('[data-publication="OFFICIAL"]')).toBeVisible();
  await expect(
    page.getByRole("region", { name: "سه‌شنبه ۵ آبان ۱۴۰۵" }),
  ).toContainText("استراحت");
  await expect(
    page
      .locator("dt", { hasText: "روزهای استراحت" })
      .locator("xpath=following-sibling::dd"),
  ).toHaveText("۲۸");
  expect(await abanState(d, d.nurseEmail, "2026-10-27")).toMatchObject({
    shift: "OFF",
    approvedShift: "OFF",
  });
});

for (const width of [360, 390]) {
  test(`OFF editor and clear fit ${width}px with accessible touch targets`, async ({
    page,
  }) => {
    const d = await provisionExplicitOffDepartment();
    await page.setViewportSize({ width, height: 800 });
    await signInAndWait(page, d.headEmail);
    await page.goto(
      `/departments/${d.code}/schedule?month=1405-08&day=2026-10-27`,
    );
    const off = controls(page).getByRole("button", {
      name: "استراحت",
      exact: true,
    });
    expect((await off.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await off.click();
    await saved(page);
    await expect(off).toHaveAttribute("aria-pressed", "true");
    await expect(row(page)).toContainText("مطابق ترجیح");
    await controls(page)
      .getByRole("button", { name: "تعیین‌نشده", exact: true })
      .click();
    await saved(page);
    await expect(row(page)).toContainText("در انتظار تخصیص");
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
    await page.reload();
    await expect(
      controls(page).getByRole("button", { name: "تعیین‌نشده", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
  });
}

test("Head Nurse directly swaps an explicit rest and working decision without a request", async ({
  page,
}) => {
  const d = await provisionExplicitOffDepartment();
  await signInAndWait(page, d.headEmail);
  await page.goto(
    `/departments/${d.code}/schedule?month=1405-08&day=2026-10-28`,
  );
  await dialog(page).getByText("جابه‌جایی مستقیم", { exact: true }).click();
  await dialog(page)
    .getByLabel("پرستار اول", { exact: true })
    .selectOption({ label: "سرپرستار آزمایشی — طولانی (ME)" });
  await dialog(page)
    .getByLabel("پرستار دوم", { exact: true })
    .selectOption({ label: "پرستار آزمایشی ۱ — استراحت" });
  await dialog(page)
    .getByLabel("علت", { exact: true })
    .selectOption({ label: "نیاز عملیاتی بخش" });
  await dialog(page).getByRole("button", { name: "ثبت جابه‌جایی" }).click();
  await expect(
    dialog(page).getByRole("status").filter({ hasText: "جابه‌جایی ثبت شد" }),
  ).toBeVisible();
  await expect(
    controls(page).getByRole("button", { name: "طولانی (ME)" }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(await abanState(d, d.nurseEmail, "2026-10-28")).toMatchObject({
    shift: "ME",
    status: "PLANNING",
  });
  expect(await abanState(d, d.headEmail, "2026-10-28")).toMatchObject({
    shift: "OFF",
    status: "PLANNING",
  });
});
