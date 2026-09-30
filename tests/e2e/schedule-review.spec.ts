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
    // VALID is cautious: no violation found, staffing is not checked yet.
    await expect(dialog).toContainText(
      "در قوانین پیاده‌سازی‌شده فعلی موردی یافت نشد؛ تأمین نفرات هنوز بررسی نمی‌شود.",
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

  test("Previous / Next move by calendar month and never skip a month without a schedule", async ({
    page,
  }) => {
    // Only Aban and Azar 1405 have schedules; Mehr and Dey do not.
    await page.goto(pageOf(department));
    const region = calendar(page);
    const empty = region.getByText(
      "برای این ماه هنوز برنامه‌ای ایجاد نشده است.",
    );
    const month = (label: string) => region.getByText(label, { exact: true });

    // Previous of Aban is Mehr: an empty month, not "no previous schedule".
    await region.getByRole("link", { name: "ماه قبل: مهر ۱۴۰۵" }).click();
    await expect(page).toHaveURL(/[?&]month=1405-07$/);
    await expect(month("مهر ۱۴۰۵")).toBeVisible();
    await expect(empty).toBeVisible();
    await expect(region.locator("table")).toHaveCount(0);
    await expect(
      region.getByRole("button", { name: "ایجاد برنامه ماهانه" }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page, "empty month");

    // And the month before that: still navigable, still empty.
    await region.getByRole("link", { name: "ماه قبل: شهریور ۱۴۰۵" }).click();
    await expect(page).toHaveURL(/[?&]month=1405-06$/);
    await expect(month("شهریور ۱۴۰۵")).toBeVisible();
    await expect(empty).toBeVisible();

    // Forward again through Mehr to Aban, which shows its calendar.
    await region.getByRole("link", { name: "ماه بعد: مهر ۱۴۰۵" }).click();
    await expect(month("مهر ۱۴۰۵")).toBeVisible();
    await expect(empty).toBeVisible();
    await region.getByRole("link", { name: "ماه بعد: آبان ۱۴۰۵" }).click();
    await expect(page).toHaveURL(/[?&]month=1405-08$/);
    await expect(month("آبان ۱۴۰۵")).toBeVisible();
    await expect(empty).toHaveCount(0);
    await expect(region.locator("tbody tr")).toHaveCount(6);
    await expect(region.locator("tbody a")).toHaveCount(30);

    // Azar has a schedule; Dey after it does not.
    await region.getByRole("link", { name: "ماه بعد: آذر ۱۴۰۵" }).click();
    await expect(month("آذر ۱۴۰۵")).toBeVisible();
    // Azar 1405 starts on a Sunday and fits in five weeks.
    await expect(region.locator("tbody tr")).toHaveCount(5);
    await expect(region.locator("tbody a")).toHaveCount(30);
    await region.getByRole("link", { name: "ماه بعد: دی ۱۴۰۵" }).click();
    await expect(page).toHaveURL(/[?&]month=1405-10$/);
    await expect(month("دی ۱۴۰۵")).toBeVisible();
    await expect(empty).toBeVisible();

    // The controls are ordinary links: keyboard operable.
    const previous = region.getByRole("link", { name: "ماه قبل: آذر ۱۴۰۵" });
    await previous.focus();
    await page.keyboard.press("Enter");
    await expect(month("آذر ۱۴۰۵")).toBeVisible();
    await expect(region.locator("tbody tr")).toHaveCount(5);
  });

  test("crosses the Jalali year in both directions", async ({ page }) => {
    await page.goto(`/departments/${department.code}/schedule?month=1405-01`);
    const region = calendar(page);
    await region.getByRole("link", { name: "ماه قبل: اسفند ۱۴۰۴" }).click();
    await expect(page).toHaveURL(/[?&]month=1404-12$/);
    await expect(region.getByText("اسفند ۱۴۰۴", { exact: true })).toBeVisible();
    await region.getByRole("link", { name: "ماه بعد: فروردین ۱۴۰۵" }).click();
    await expect(page).toHaveURL(/[?&]month=1405-01$/);
  });

  test("offers to create the month it shows, and lands on its calendar", async ({
    page,
  }) => {
    await page.goto(`/departments/${department.code}/schedule?month=1405-10`);
    const region = calendar(page);
    await region.getByRole("button", { name: "ایجاد برنامه ماهانه" }).click();
    const dialog = page.getByRole("dialog", { name: "ایجاد برنامه ماهانه" });
    // Preselected: the month on screen, not the usual "next month" suggestion.
    await expect(dialog.getByLabel("سال")).toHaveValue("1405");
    await expect(dialog.getByLabel("ماه")).toHaveValue("10");
    await expect(dialog.locator("p", { hasText: "دی ۱۴۰۵" })).toBeVisible();
    await dialog.getByRole("button", { name: "ایجاد برنامه" }).click();

    await expect(page).toHaveURL(/\?schedule=[0-9a-f-]{36}$/);
    await expect(dialog).toBeHidden();
    await expect(
      region.getByText("برای این ماه هنوز برنامه‌ای ایجاد نشده است."),
    ).toHaveCount(0);
    await expect(region.getByText("دی ۱۴۰۵", { exact: true })).toBeVisible();
    await expect(
      region.getByRole("list", { name: "خلاصه وضعیت روزهای ماه" }),
    ).toContainText("برنامه‌ریزی‌نشده: ۳۰ روز");
    await expect(region.locator("tbody a")).toHaveCount(30);
  });

  test("keeps a day open and closes back to the month URL it came from", async ({
    page,
  }) => {
    await page.goto(
      `/departments/${department.code}/schedule?month=1405-08&day=2026-10-26`,
    );
    const dialog = dayDialog(page);
    await expect(dialog).toHaveAccessibleName("دوشنبه ۴ آبان ۱۴۰۵");
    await dialog.getByRole("button", { name: "بستن جزئیات روز" }).click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/[?&]month=1405-08$/);
    // A day link keeps the month URL form.
    await expect(dayLink(page, /^دوشنبه ۴ آبان ۱۴۰۵/)).toHaveAttribute(
      "href",
      /month=1405-08&day=2026-10-26$/,
    );
  });

  test("ignores an invalid month parameter and shows the requested schedule", async ({
    page,
  }) => {
    await page.goto(
      `/departments/${department.code}/schedule?month=1405-13&schedule=${department.abanId}`,
    );
    await expect(
      calendar(page).getByText("آبان ۱۴۰۵", { exact: true }),
    ).toBeVisible();
    await expect(calendar(page).locator("tbody a")).toHaveCount(30);
  });
});

test.describe("monthly review access", () => {
  test("a nurse and a supervisor get the same 404 as an unknown department", async ({
    page,
  }) => {
    const department = await provisionReviewDepartment();
    const base = `/departments/${department.code}/schedule`;
    const urls = [
      `${base}?schedule=${department.abanId}&day=2026-10-26`,
      // An empty month must not reveal the create action or the department.
      `${base}?month=1405-07`,
    ];
    for (const email of [department.nurseEmail, DEMO_USERS.supervisor.email]) {
      await signInAndWait(page, email);
      for (const url of urls) {
        const response = await page.goto(url);
        expect(response?.status()).toBe(404);
        await expect(page.getByRole("dialog")).toHaveCount(0);
        await expect(
          page.getByRole("button", { name: "ایجاد برنامه ماهانه" }),
        ).toHaveCount(0);
      }
      await page.context().clearCookies();
    }
  });
});
