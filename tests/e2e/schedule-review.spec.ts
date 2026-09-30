import { expect, test, type Page } from "@playwright/test";

import { DEMO_USERS, isDesktop, signInAndWait } from "./support/auth";
import {
  provisionReviewDepartment,
  type ReviewDepartment,
} from "./support/review";

const ISO_DATE = /\d{4}-\d{2}-\d{2}/;
const RULE_CODE = /NIGHT_REST|DUPLICATE_ASSIGNMENT|OUTSIDE_PERIOD|UNPLANNED/;

const expectNoHorizontalOverflow = async (page: Page, step: string) => {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow, step).toBeLessThanOrEqual(0);
};

const calendar = (page: Page) =>
  page.getByRole("region", { name: "مرور ماهانه" });
const dayLink = (page: Page, name: RegExp | string) =>
  calendar(page).getByRole("link", { name });
const dayDialog = (page: Page) => page.getByRole("dialog");

test.describe("Head Nurse monthly review (read-only)", () => {
  let department: ReviewDepartment;
  const pageOf = (d: ReviewDepartment, query = "") =>
    `/departments/${d.code}/schedule?schedule=${d.abanId}${query}`;

  test.beforeEach(async ({ page }) => {
    department = await provisionReviewDepartment();
    await signInAndWait(page, department.headEmail);
  });

  test("shows the month as a Saturday-first calendar with per-day health", async ({
    page,
  }) => {
    await page.goto(pageOf(department));
    const region = calendar(page);
    await expect(region).toBeVisible();
    await expect(region.getByText("آبان ۱۴۰۵", { exact: true })).toBeVisible();

    // Aban 1405 starts on a Friday: six weeks of seven columns.
    const rows = region.locator("tbody tr");
    await expect(rows).toHaveCount(6);
    await expect(rows.first().locator("td")).toHaveCount(7);
    await expect(region.locator("thead th").first()).toHaveAttribute(
      "abbr",
      "شنبه",
    );

    // Only the 30 days of the month are interactive; the others are inert.
    await expect(region.locator("tbody a")).toHaveCount(30);
    await expect(rows.first().locator("td a")).toHaveCount(1);

    // Health is in the accessible name (text, not color).
    await expect(dayLink(page, "شنبه ۲ آبان ۱۴۰۵، بدون ایراد")).toHaveAttribute(
      "data-health",
      "VALID",
    );
    await expect(
      dayLink(page, "دوشنبه ۴ آبان ۱۴۰۵، نیاز به بررسی (۱ مورد)"),
    ).toHaveAttribute("data-health", "NEEDS_ATTENTION");
    await expect(
      dayLink(page, "جمعه ۱ آبان ۱۴۰۵، برنامه‌ریزی‌نشده"),
    ).toHaveAttribute("data-health", "UNPLANNED");

    const totals = region.getByRole("list", {
      name: "خلاصه وضعیت روزهای ماه",
    });
    await expect(totals).toContainText("بدون ایراد: ۲ روز");
    await expect(totals).toContainText("نیاز به بررسی: ۱ روز");
    await expect(totals).toContainText("برنامه‌ریزی‌نشده: ۲۷ روز");

    // No nurse names in the month overview; Jalali only.
    for (const name of department.nurseNames)
      await expect(region.getByText(name)).toHaveCount(0);
    expect(await region.innerText()).not.toMatch(ISO_DATE);
    await expectNoHorizontalOverflow(page, "month calendar");
  });

  test("opens a day with its four shifts, nurses and a Persian diagnostic, then closes", async ({
    page,
  }) => {
    await page.goto(pageOf(department));
    await dayLink(page, /^دوشنبه ۴ آبان ۱۴۰۵/).click();
    await expect(page).toHaveURL(/&day=2026-10-26$/);

    const dialog = dayDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAccessibleName("دوشنبه ۴ آبان ۱۴۰۵");
    await expect(dialog.getByText("نیاز به بررسی").first()).toBeVisible();
    await expect(dialog.getByText("مانع نهایی‌سازی")).toBeVisible();
    await expect(dialog).toContainText(
      `«${department.nurseNames[0]}» در یکشنبه ۳ آبان ۱۴۰۵ شیفت شب دارد و روز بعد (دوشنبه ۴ آبان ۱۴۰۵) شیفت صبح برایش ثبت شده است`,
    );
    for (const code of ["M", "E", "N", "ME"])
      await expect(
        dialog.getByRole("region").filter({
          has: page.getByRole("heading", { name: new RegExp(`^${code}\\b`) }),
        }),
      ).toHaveCount(1);
    expect(await dialog.innerText()).not.toMatch(ISO_DATE);
    expect(await dialog.innerText()).not.toMatch(RULE_CODE);
    await expectNoHorizontalOverflow(page, "day detail");

    if (!isDesktop(page)) {
      // Full screen on phones, not a shrunken desktop modal.
      const box = (await dialog.boundingBox())!;
      const viewport = page.viewportSize()!;
      expect(box.width).toBeGreaterThanOrEqual(viewport.width - 1);
      expect(box.height).toBeGreaterThanOrEqual(viewport.height - 1);
    }

    await dialog.getByRole("button", { name: "بستن جزئیات روز" }).click();
    await expect(dialog).toBeHidden();
    await expect(page).not.toHaveURL(/day=/);
    await expect(dayLink(page, /^دوشنبه ۴ آبان ۱۴۰۵/)).toBeFocused();
  });

  test("answers who works Morning, Evening, Night and Long on a planned day", async ({
    page,
  }) => {
    await page.goto(pageOf(department, "&day=2026-10-24"));
    const dialog = dayDialog(page);
    await expect(dialog).toHaveAccessibleName("شنبه ۲ آبان ۱۴۰۵");
    const shift = (code: string) =>
      dialog.getByRole("list", { name: `پرستاران شیفت ${code}` });
    await expect(shift("صبح")).toHaveText(
      new RegExp(department.nurseNames[0]!),
    );
    await expect(shift("عصر")).toContainText(department.nurseNames[1]!);
    // The nurse's own wish is shown as context, never as an assignment.
    await expect(shift("عصر")).toContainText("ترجیح: شب");
    await expect(shift("شب")).toContainText(department.nurseNames[2]!);
    await expect(shift("طولانی")).toContainText("سرپرستار آزمایشی");
    // ME counts toward Morning coverage; staffing numbers are not invented.
    await expect(dialog).toContainText(
      "پوشش صبح: ۲ نفر (۱ نفر از شیفت طولانی)",
    );
    await expect(
      dialog.getByText("حداقل و حداکثر نفرات تعریف نشده است").first(),
    ).toBeVisible();
    await expect(dialog).toContainText(
      "شیفت‌ها ثبت شده‌اند و هیچ‌یک از قوانین فعلی برنامه‌ریزی نقض نشده است.",
    );

    // Read-only: the only control is closing (plus the collapsible list).
    await expect(dialog.locator("button")).toHaveCount(1);
    await expect(dialog.locator("input, select, textarea, form")).toHaveCount(
      0,
    );

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(page).not.toHaveURL(/day=/);
  });

  test("is keyboard operable and ignores days outside the month", async ({
    page,
  }) => {
    await page.goto(pageOf(department, "&day=2026-10-10"));
    await expect(dayDialog(page)).toHaveCount(0);

    const day = dayLink(page, /^شنبه ۲ آبان ۱۴۰۵/);
    await day.focus();
    await page.keyboard.press("Enter");
    const dialog = dayDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAccessibleName("شنبه ۲ آبان ۱۴۰۵");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(day).toBeFocused();
  });

  test("moves between months only with the previous / next controls", async ({
    page,
  }) => {
    await page.goto(pageOf(department));
    const region = calendar(page);
    await expect(
      region.getByRole("button", { name: /^ماه قبل/ }),
    ).toBeDisabled();
    await region.getByRole("link", { name: "ماه بعد: آذر ۱۴۰۵" }).click();
    await expect(page).toHaveURL(new RegExp(`schedule=${department.azarId}$`));
    await expect(region.getByText("آذر ۱۴۰۵", { exact: true })).toBeVisible();
    // Azar 1405 starts on a Sunday and fits in five weeks.
    await expect(region.locator("tbody tr")).toHaveCount(5);
    await expect(region.locator("tbody a")).toHaveCount(30);
    await expect(
      region.getByRole("button", { name: /^ماه بعد/ }),
    ).toBeDisabled();
    await region.getByRole("link", { name: "ماه قبل: آبان ۱۴۰۵" }).click();
    await expect(page).toHaveURL(new RegExp(`schedule=${department.abanId}$`));
  });
});

test.describe("monthly review access", () => {
  test("a nurse and a supervisor get the same 404 as an unknown department", async ({
    page,
  }) => {
    const department = await provisionReviewDepartment();
    const url = `/departments/${department.code}/schedule?schedule=${department.abanId}&day=2026-10-26`;
    for (const email of [department.nurseEmail, DEMO_USERS.supervisor.email]) {
      await signInAndWait(page, email);
      const response = await page.goto(url);
      expect(response?.status()).toBe(404);
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await page.context().clearCookies();
    }
  });
});
