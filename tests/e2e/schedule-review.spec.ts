import { expect, test, type Page } from "@playwright/test";

import { DEMO_USERS, isDesktop, signInAndWait } from "./support/auth";
import {
  forceScheduleStatus,
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

const main = (page: Page) => page.locator("main");
const calendar = (page: Page) =>
  page.getByRole("region", { name: "تقویم ماه" });
const dayLink = (page: Page, name: RegExp | string) =>
  calendar(page).getByRole("link", { name });
const dayDialog = (page: Page) => page.getByRole("dialog");
/** The page heading names the department and, as its focal line, the month. */
const monthHeading = (page: Page, label: string) =>
  main(page).getByRole("heading", { level: 1, name: new RegExp(`${label}$`) });

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
    await expect(monthHeading(page, "آبان ۱۴۰۵")).toBeVisible();
    await expect(monthHeading(page, "آبان ۱۴۰۵")).toContainText(
      department.name,
    );

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
    await expect(
      dayLink(page, "شنبه ۲ آبان ۱۴۰۵، بدون مغایرت"),
    ).toHaveAttribute("data-health", "VALID");
    await expect(
      dayLink(page, "دوشنبه ۴ آبان ۱۴۰۵، نیاز به بررسی (۶ مورد)"),
    ).toHaveAttribute("data-health", "NEEDS_ATTENTION");
    await expect(
      dayLink(page, "جمعه ۱ آبان ۱۴۰۵، برنامه‌ریزی‌نشده"),
    ).toHaveAttribute("data-health", "UNPLANNED");

    const totals = main(page).getByRole("list", {
      name: "خلاصه وضعیت روزهای ماه",
    });
    await expect(totals).toContainText("بدون مغایرت: ۱ روز");
    await expect(totals).toContainText("نیاز به بررسی: ۲ روز");
    await expect(totals).toContainText("برنامه‌ریزی‌نشده: ۲۷ روز");

    // Quiet by default, loud on exceptions: a VALID day is not tinted or
    // outlined; the day needing attention is (its count is in its name).
    const style = (name: string) =>
      dayLink(page, new RegExp(`^${name}`)).evaluate((el) => {
        const s = getComputedStyle(el);
        return { background: s.backgroundColor, shadow: s.boxShadow };
      });
    const valid = await style("شنبه ۲ آبان ۱۴۰۵");
    const attention = await style("دوشنبه ۴ آبان ۱۴۰۵");
    expect(valid.background).toBe("rgba(0, 0, 0, 0)");
    expect(valid.shadow).toBe("none");
    expect(attention.background).not.toBe("rgba(0, 0, 0, 0)");
    expect(attention.shadow).not.toBe("none");

    // "Which days need me": one link per attention day, to that day.
    const attentionDays = main(page).getByRole("navigation", {
      name: "روزهای نیازمند بررسی",
    });
    await expect(attentionDays.getByRole("link")).toHaveCount(2);
    await expect(attentionDays.getByRole("link").last()).toHaveAttribute(
      "href",
      /day=2026-10-26$/,
    );

    // The header: lifecycle status, preference window, editing mode.
    const header = main(page).getByRole("region", { name: /آبان ۱۴۰۵$/ });
    await expect(header).toContainText("پیش‌نویس");
    await expect(header).toContainText("ترجیحات:باز نشده");
    await expect(header).toContainText("ویرایش شیفت‌ها");
    await expect(
      header.getByRole("button", { name: "باز کردن ثبت ترجیحات" }),
    ).toBeVisible();

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
    // Focus starts on the date (the dialog's name), not on a header button.
    await expect(
      dialog.getByRole("heading", { name: "دوشنبه ۴ آبان ۱۴۰۵" }),
    ).toBeFocused();
    await expect(dialog.getByText("نیاز به بررسی").first()).toBeVisible();
    await expect(dialog.getByText("مانع نهایی‌سازی").first()).toBeVisible();
    await expect(dialog).toContainText(
      `«${department.nurseNames[0]}» در یکشنبه ۳ آبان ۱۴۰۵ شیفت شب دارد و روز بعد (دوشنبه ۴ آبان ۱۴۰۵) شیفت صبح برایش ثبت شده است`,
    );
    // Actionable: how to resolve it, and who, linked to their row.
    await expect(dialog).toContainText(
      "برای رفع: شیفت صبح روز بعد را بردارید یا شیفت شب روز قبل را تغییر دهید.",
    );
    const flaggedRow = dialog
      .locator("li[data-nurse-row][data-flagged]")
      .filter({ hasText: department.nurseNames[0]! });
    await expect(flaggedRow).toHaveCount(1);
    await expect(flaggedRow).toContainText(department.nurseNames[0]!);
    const who = dialog
      .getByRole("region", { name: /نیاز به بررسی/ })
      .getByRole("link", { name: department.nurseNames[0]! })
      .first();
    await expect(who).toHaveAttribute(
      "href",
      `#${await flaggedRow.getAttribute("id")}`,
    );
    // The four shifts, each a way to list who works it (Phase 7b editor).
    const shifts = dialog.getByRole("group", { name: "نمایش پرسنل" });
    for (const name of ["صبح (M)", "عصر (E)", "شب (N)", "طولانی (ME)"])
      await expect(
        shifts.getByRole("button", {
          name: new RegExp(`^${name.replace(/[()]/g, "\\$&")}`),
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
    const works = (name: string, shift: string) =>
      expect(
        dialog
          .getByRole("group", { name: `شیفت ${name}` })
          .getByRole("button", { name: shift }),
      ).toHaveAttribute("aria-pressed", "true");
    await works(department.nurseNames[0]!, "صبح (M)");
    await works(department.nurseNames[1]!, "عصر (E)");
    await works(department.nurseNames[2]!, "شب (N)");
    await works("سرپرستار آزمایشی", "طولانی (ME)");
    // Listing one shift shows exactly who works it.
    const chips = dialog.getByRole("group", { name: "نمایش پرسنل" });
    await chips.getByRole("button", { name: /^صبح \(M\)/ }).click();
    await expect(dialog.locator("li[data-nurse-row]")).toHaveCount(1);
    await expect(dialog.locator("li[data-nurse-row]")).toContainText(
      department.nurseNames[0]!,
    );
    await chips.getByRole("button", { name: /^همه/ }).click();
    // The nurse's own wish is shown as context, never as an assignment.
    const nurse2 = dialog.locator("li[data-nurse-row]").filter({
      hasText: department.nurseNames[1]!,
    });
    await expect(nurse2).toContainText("ترجیح: شب");
    await expect(nurse2).toContainText("مغایر ترجیح");
    // ME counts toward Morning coverage; staffing numbers are not invented.
    const coverage = dialog.getByRole("region", { name: "پوشش نفرات" });
    await expect(coverage.locator('[data-period="M"]')).toHaveText(
      /پوشش صبح\s*۲\s*نفر\s*۱ نفر از شیفت طولانی/,
    );
    await expect(
      dialog.getByText("حداقل و حداکثر نفرات تعریف نشده است"),
    ).toHaveCount(0);
    // VALID is cautious: no violation found, staffing is not checked yet,
    // and a day without findings never opens under "needs attention".
    await expect(dialog).toContainText(
      "مغایرتی یافت نشد: در قوانین پیاده‌سازی‌شده فعلی موردی دیده نشد. تصمیم‌های روز و حداقل پوشش نفرات نیز بررسی می‌شود.",
    );
    await expect(
      dialog.getByRole("heading", { name: /نیاز به بررسی/ }),
    ).toHaveCount(0);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(page).not.toHaveURL(/day=/);
  });

  test("shows a locked (submitted) schedule read-only, with the reason", async ({
    page,
  }) => {
    await forceScheduleStatus(department.abanId, "SUBMITTED");
    await page.goto(pageOf(department, "&day=2026-10-24"));
    const dialog = dayDialog(page);
    await expect(dialog).toHaveAccessibleName("شنبه ۲ آبان ۱۴۰۵");
    await expect(dialog.getByText("فقط مشاهده")).toBeVisible();
    await expect(dialog).toContainText(
      "برنامه در وضعیت فعلی قفل است؛ شیفت‌ها فقط قابل مشاهده‌اند.",
    );
    const shift = (code: string) =>
      dialog.getByRole("list", { name: `پرستاران شیفت ${code}` });
    await expect(shift("صبح")).toHaveText(
      new RegExp(department.nurseNames[0]!),
    );
    await expect(shift("عصر")).toContainText(department.nurseNames[1]!);
    await expect(shift("عصر")).toContainText("ترجیح: شب");
    await expect(shift("شب")).toContainText(department.nurseNames[2]!);
    await expect(shift("طولانی")).toContainText("سرپرستار آزمایشی");
    // Nothing to edit: only closing and moving between days.
    await expect(dialog.getByRole("group", { name: /^شیفت / })).toHaveCount(0);
    await expect(dialog.locator("input, select, textarea, form")).toHaveCount(
      0,
    );
    await expect(
      dialog.getByRole("button", { name: "بستن جزئیات روز" }),
    ).toBeVisible();
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
    const region = main(page);
    const empty = region.getByText(
      "برای این ماه هنوز برنامه‌ای ایجاد نشده است.",
    );
    const month = (label: string) => monthHeading(page, label);

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
    const region = main(page);
    await region.getByRole("link", { name: "ماه قبل: اسفند ۱۴۰۴" }).click();
    await expect(page).toHaveURL(/[?&]month=1404-12$/);
    await expect(monthHeading(page, "اسفند ۱۴۰۴")).toBeVisible();
    await region.getByRole("link", { name: "ماه بعد: فروردین ۱۴۰۵" }).click();
    await expect(page).toHaveURL(/[?&]month=1405-01$/);
  });

  test("offers to create the month it shows, and lands on its calendar", async ({
    page,
  }) => {
    await page.goto(`/departments/${department.code}/schedule?month=1405-10`);
    const region = main(page);
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
    await expect(monthHeading(page, "دی ۱۴۰۵")).toBeVisible();
    await expect(
      region.getByRole("list", { name: "خلاصه وضعیت روزهای ماه" }),
    ).toContainText("برنامه‌ریزی‌نشده: ۳۰ روز");
    await expect(region.locator("tbody a")).toHaveCount(30);
    // A schedule with no assignment yet says so, and how to start.
    await expect(region.getByRole("note")).toContainText(
      "هنوز شیفتی در این برنامه ثبت نشده است",
    );
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
    await expect(monthHeading(page, "آبان ۱۴۰۵")).toBeVisible();
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
