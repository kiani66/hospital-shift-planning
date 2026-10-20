import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { signInAndWait } from "./support/auth";
import { forceScheduleStatus } from "./support/review";
import {
  monthlyPreferenceCells,
  provisionMonthlyPreferences,
  updateMonthlyPreference,
} from "./support/monthly-preferences";

const trigger = (page: Page) =>
  page.getByRole("button", { name: "اعمال ترجیحات ماه", exact: true });
const confirmation = (page: Page) =>
  page.getByRole("dialog", { name: "اعمال ترجیحات ماه؟" });
const confirm = async (page: Page) => {
  await trigger(page).click();
  await confirmation(page)
    .getByRole("button", { name: "بله، ترجیحات اعمال شود" })
    .click();
  await expect(confirmation(page)).not.toBeVisible();
};
async function layout(page: Page) {
  expect(await page.locator("html").getAttribute("dir")).toBe("rtl");
  expect(
    await page.evaluate(() => {
      const dialog = document.querySelector("dialog[open]");
      return Math.max(
        document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
        dialog ? dialog.scrollWidth - dialog.clientWidth : 0,
      );
    }),
  ).toBeLessThanOrEqual(0);
}
async function screenshot(page: Page, info: TestInfo, name: string) {
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: name.endsWith("result") });
  await info.attach(name, { path, contentType: "image/png" });
}

test("confirms monthly replacement, preserves leave, shows findings and reapplies after manual edits", async ({
  page,
}, info) => {
  const d = await provisionMonthlyPreferences();
  const url = `/departments/${d.code}/schedule?schedule=${d.abanId}`;
  await signInAndWait(page, d.headEmail);
  await page.goto(url);
  const before = await monthlyPreferenceCells(d);
  await trigger(page).click();
  await expect(confirmation(page)).toContainText(
    "کمبود نیرو، پوشش اضافی یا مغایرت",
  );
  await expect(confirmation(page)).toContainText("مرخصی (H)");
  await expect(
    confirmation(page).getByRole("button", { name: "انصراف" }),
  ).toBeFocused();
  await layout(page);
  await screenshot(page, info, "monthly-preferences-confirm");
  await confirmation(page).getByRole("button", { name: "انصراف" }).click();
  await expect(trigger(page)).toBeFocused();
  expect(await monthlyPreferenceCells(d)).toEqual(before);

  await confirm(page);
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "۲ تصمیم بر اساس ترجیحات اعمال شد" }),
  ).toBeVisible();
  await page.getByText("موارد اعمال‌نشده", { exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "مرخصی (H) ثبت‌شده حفظ شد" }),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: "تقویم ماه" })).toBeVisible();
  await expect(page.locator("#day-2026-10-26")).toHaveAttribute(
    "data-state",
    "RULE_VIOLATION",
  );
  expect((await monthlyPreferenceCells(d)).map((c) => c.shift)).toContain("H");
  await layout(page);
  await screenshot(page, info, "monthly-preferences-result");

  await page.goto(`${url}&day=2026-10-24`);
  const day = page.getByRole("dialog");
  const controls = day.getByRole("group", { name: `شیفت ${d.nurseNames[0]}` });
  await expect(
    controls.getByRole("button", { name: /\(ME\)/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await controls
    .getByRole("button", { name: "تعیین‌نشده", exact: true })
    .click();
  await expect(day.locator("[data-pending]")).toHaveCount(0);
  await expect(day.getByRole("status").first()).toContainText("پاک شد");
  await day.getByRole("button", { name: "بستن جزئیات روز" }).click();
  await updateMonthlyPreference(d);
  await confirm(page);
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "۲ تصمیم بر اساس ترجیحات اعمال شد" }),
  ).toBeVisible();
  await page.goto(`${url}&day=2026-10-24`);
  await expect(
    page
      .getByRole("group", { name: `شیفت ${d.nurseNames[0]}` })
      .getByRole("button", { name: /\(ME\)/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page
      .getByRole("group", { name: `شیفت ${d.nurseNames[1]}` })
      .getByRole("button", { name: /\(OFF\)/ }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("empty preference set is a no-op and the action is absent after planning", async ({
  page,
}) => {
  const d = await provisionMonthlyPreferences();
  await signInAndWait(page, d.headEmail);
  const url = `/departments/${d.code}/schedule?schedule=${d.azarId}`;
  await page.goto(url);
  await confirm(page);
  await expect(
    page.getByRole("status").filter({
      hasText: "ترجیحی برای این ماه ثبت نشده است؛ ۰ تصمیم اعمال شد",
    }),
  ).toBeVisible();
  await forceScheduleStatus(d.azarId, "FINALIZED");
  await page.reload();
  await expect(trigger(page)).toHaveCount(0);
});

test("uses normal nurse registration in PLANNING, updates while open and reapplies after closing", async ({
  page,
  browser,
}, info) => {
  test.slow(); // Two signed-in people, three applications and a manual correction.
  const d = await provisionMonthlyPreferences();
  const url = `/departments/${d.code}/schedule?schedule=${d.abanId}`;
  await signInAndWait(page, d.headEmail);
  await page.goto(url);
  await page
    .getByRole("button", { name: "باز کردن ثبت ترجیحات", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "بله، باز شود" })
    .click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(trigger(page)).toBeVisible();

  const nurseContext = await browser.newContext({
    viewport: page.viewportSize()!,
    locale: "fa-IR",
    timezoneId: "Asia/Tehran",
  });
  try {
    const nurse = await nurseContext.newPage();
    await signInAndWait(nurse, d.nurseEmail);
    await nurse.goto(`/preferences?schedule=${d.abanId}`);
    const card = nurse.getByRole("listitem", {
      name: "جمعه ۱ آبان ۱۴۰۵",
      exact: true,
    });
    const choose = async (code: string) => {
      const option = card
        .getByRole("group", { name: /^ترجیح شیفت/ })
        .getByRole("button", { name: new RegExp(`^${code} —`) });
      await option.click();
      await expect(option).toHaveAttribute("aria-pressed", "true");
      await expect(card.getByRole("status")).toContainText("ذخیره شد");
    };
    await choose("M");
    await confirm(page);
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "۳ تصمیم بر اساس ترجیحات اعمال شد" }),
    ).toBeVisible();
    await choose("E");
    await confirm(page);
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "۱ تصمیم بر اساس ترجیحات اعمال شد" }),
    ).toBeVisible();

    await page.goto(`${url}&day=2026-10-23`);
    const day = page.getByRole("dialog");
    await day
      .getByRole("group", { name: `شیفت ${d.nurseNames[0]}` })
      .getByRole("button", { name: /\(OFF\)/ })
      .click();
    await expect(day.locator("[data-pending]")).toHaveCount(0);
    await expect(day.getByRole("status").first()).toContainText("ثبت شد");
    await day.getByRole("button", { name: "بستن جزئیات روز" }).click();
    await page
      .getByRole("button", { name: "بستن ثبت ترجیحات", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "بله، بسته شود" })
      .click();
    await expect(page.getByRole("dialog")).toBeHidden();
    await confirm(page);
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "۱ تصمیم بر اساس ترجیحات اعمال شد" }),
    ).toBeVisible();
    expect(
      (await monthlyPreferenceCells(d))
        .filter((a) => a.date === "2026-10-23")
        .map((a) => a.shift),
    ).toEqual(["E"]);
    await layout(page);
    await screenshot(page, info, "monthly-preferences-planning-result");
  } finally {
    await nurseContext.close();
  }
});

test("stale confirmation rejects a concurrent edit and preserves the newer decision", async ({
  page,
  context,
}) => {
  const d = await provisionMonthlyPreferences();
  const url = `/departments/${d.code}/schedule?schedule=${d.abanId}`;
  await signInAndWait(page, d.headEmail);
  await page.goto(url);
  await trigger(page).click();
  const other = await context.newPage();
  await other.goto(`${url}&day=2026-10-24`);
  await other
    .getByRole("group", { name: `شیفت ${d.nurseNames[0]}` })
    .getByRole("button", { name: /\(OFF\)/ })
    .click();
  await expect(other.getByRole("dialog").locator("[data-pending]")).toHaveCount(
    0,
  );
  await expect(
    other.getByRole("dialog").getByRole("status").first(),
  ).toContainText("ثبت شد");
  const newer = await monthlyPreferenceCells(d);
  await confirmation(page)
    .getByRole("button", { name: "بله، ترجیحات اعمال شود" })
    .click();
  await expect(confirmation(page).getByRole("alert")).toContainText("هم‌زمان");
  expect(await monthlyPreferenceCells(d)).toEqual(newer);
  await confirmation(page).getByRole("button", { name: "انصراف" }).click();
  await confirm(page);
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "۲ تصمیم بر اساس ترجیحات اعمال شد" }),
  ).toBeVisible();
  await other.close();
});
