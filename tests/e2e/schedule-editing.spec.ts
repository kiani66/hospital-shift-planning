import { expect, test, type Locator, type Page } from "@playwright/test";

import { DEMO_USERS, isDesktop, signInAndWait } from "./support/auth";
import {
  forceScheduleStatus,
  provisionReviewDepartment,
  type ReviewDepartment,
} from "./support/review";

const HEAD = "سرپرستار آزمایشی";

const noHorizontalOverflow = async (page: Page) => {
  const overflow = await page.evaluate(() => {
    const dialog = document.querySelector("dialog[open]");
    return Math.max(
      document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
      dialog ? dialog.scrollWidth - dialog.clientWidth : 0,
    );
  });
  expect(overflow).toBeLessThanOrEqual(0);
};

const dayDialog = (page: Page) => page.getByRole("dialog");
/** A nurse's shift controls in the day editor. */
const controls = (dialog: Locator, name: string) =>
  dialog.getByRole("group", { name: `شیفت ${name}` });
const row = (dialog: Locator, name: string) =>
  dialog.locator("li[data-nurse-row]").filter({
    has: dialog.page().getByRole("group", { name: `شیفت ${name}` }),
  });
/** The list filter chips ("همه", "تعیین‌نشده", one per shift). */
const chip = (dialog: Locator, name: RegExp) =>
  dialog
    .getByRole("group", { name: "نمایش پرسنل" })
    .getByRole("button", { name });

/** Waits until the edit is saved by the server (not only shown as pending). */
async function saved(dialog: Locator, text: RegExp | string = /ثبت شد|پاک شد/) {
  await expect(dialog.locator("[data-pending]")).toHaveCount(0);
  await expect(dialog.getByRole("status").first()).toContainText(text);
}

async function expectShift(dialog: Locator, name: string, shift: string) {
  await expect(
    controls(dialog, name).getByRole("button", { name: shift }),
  ).toHaveAttribute("aria-pressed", "true");
}

test.describe("Head Nurse schedule editing", () => {
  let department: ReviewDepartment;
  const monthUrl = (d: ReviewDepartment, day?: string) =>
    `/departments/${d.code}/schedule?month=1405-08${day ? `&day=${day}` : ""}`;

  test.beforeEach(async ({ page }) => {
    department = await provisionReviewDepartment();
    await signInAndWait(page, department.headEmail);
  });

  test("assigns, changes and clears shifts; the nurse stays listed; the Head Nurse gets a shift", async ({
    page,
  }) => {
    test.skip(!isDesktop(page), "desktop flow");
    const [nurse1, nurse2, nurse3] = department.nurseNames as [
      string,
      string,
      string,
    ];
    await page.goto(monthUrl(department));
    // 6 Aban is unplanned: open it from the calendar.
    await page
      .getByRole("region", { name: "تقویم ماه" })
      .getByRole("link", { name: /^چهارشنبه ۶ آبان ۱۴۰۵، برنامه‌ریزی‌نشده/ })
      .click();
    const dialog = dayDialog(page);
    await expect(dialog).toHaveAccessibleName("چهارشنبه ۶ آبان ۱۴۰۵");
    await expect(dialog.getByText("قابل ویرایش")).toBeVisible();
    // Everyone on the roster is listed, assigned or not.
    await expect(dialog.locator("li[data-nurse-row]")).toHaveCount(
      department.memberCount,
    );

    // Assign an unassigned nurse (found through the "no shift" list).
    await chip(dialog, /^تعیین‌نشده/).click();
    await controls(dialog, nurse3)
      .getByRole("button", { name: "صبح (M)" })
      .click();
    await saved(
      dialog,
      `صبح (M) برای «${nurse3}» در چهارشنبه ۶ آبان ۱۴۰۵ ثبت شد.`,
    );
    // The edited row stays in view although the filter no longer matches it.
    await expectShift(dialog, nurse3, "صبح (M)");
    await chip(dialog, /^همه/).click();

    // Change it in one step.
    await controls(dialog, nurse3)
      .getByRole("button", { name: "عصر (E)" })
      .click();
    await saved(dialog);
    await expectShift(dialog, nurse3, "عصر (E)");

    // Clear it: still in the list, with no shift, ready to be assigned again.
    await controls(dialog, nurse3)
      .getByRole("button", { name: "تعیین‌نشده" })
      .click();
    await saved(dialog, "در فهرست پرسنل می‌ماند");
    await expectShift(dialog, nurse3, "تعیین‌نشده");
    await expect(row(dialog, nurse3)).toBeVisible();

    // The Head Nurse is scheduled like any nurse.
    await controls(dialog, HEAD)
      .getByRole("button", { name: "شب (N)" })
      .click();
    await saved(dialog);
    await controls(dialog, nurse1)
      .getByRole("button", { name: "طولانی (ME)" })
      .click();
    await saved(dialog);

    // Undo restores the replaced value through the server.
    await dialog.getByRole("button", { name: "بازگردانی" }).click();
    await saved(dialog, "بازگردانده شد");
    await expectShift(dialog, nurse1, "تعیین‌نشده");

    // The calendar behind reflects the edits once the day is closed.
    await dialog.getByRole("button", { name: "بستن جزئیات روز" }).click();
    await expect(
      page.getByRole("link", { name: /^چهارشنبه ۶ آبان ۱۴۰۵، نیاز به بررسی/ }),
    ).toBeVisible();

    // Persisted: a reload shows the same.
    await page.goto(monthUrl(department, "2026-10-28"));
    await expectShift(dayDialog(page), HEAD, "شب (N)");
    await expectShift(dayDialog(page), nurse3, "تعیین‌نشده");
    await expectShift(dayDialog(page), nurse2, "تعیین‌نشده");
  });

  test("keyboard: creates and fixes a night-rest conflict across adjacent days", async ({
    page,
  }) => {
    test.skip(!isDesktop(page), "keyboard flow");
    const nurse1 = department.nurseNames[0]!;
    await page.goto(monthUrl(department, "2026-10-28"));
    const dialog = dayDialog(page);
    await controls(dialog, nurse1)
      .getByRole("button", { name: "صبح (M)" })
      .focus();

    // N on 6 Aban, then ] to 7 Aban: focus stays on the same nurse.
    await page.keyboard.press("n");
    await saved(dialog);
    await expectShift(dialog, nurse1, "شب (N)");
    await page.keyboard.press("]");
    await expect(page).toHaveURL(/day=2026-10-29/);
    await expect(dialog).toHaveAccessibleName("پنجشنبه ۷ آبان ۱۴۰۵");
    await expect(
      controls(dialog, nurse1).getByRole("button", { name: "صبح (M)" }),
    ).toBeFocused();

    // M the day after a Night: allowed while editing, reported in Persian.
    await page.keyboard.press("m");
    await saved(dialog);
    const finding = `«${nurse1}» در چهارشنبه ۶ آبان ۱۴۰۵ شیفت شب دارد و روز بعد (پنجشنبه ۷ آبان ۱۴۰۵) شیفت صبح برایش ثبت شده است`;
    await expect(dialog).toContainText(finding);
    await expect(dialog.getByText("مانع نهایی‌سازی").first()).toBeVisible();
    await expect(row(dialog, nurse1)).toContainText("نیاز به بررسی");
    expect(await dialog.innerText()).not.toMatch(
      /NIGHT_REST|\d{4}-\d{2}-\d{2}/,
    );

    // The night's day shows it too, as related.
    await page.keyboard.press("[");
    await expect(dialog).toHaveAccessibleName("چهارشنبه ۶ آبان ۱۴۰۵");
    await expect(
      dialog.getByRole("region", { name: /مرتبط با روز دیگر/ }),
    ).toContainText("استراحت پس از شیفت شب");

    // Fix it on 7 Aban with Delete: the finding disappears on both days.
    await dialog.getByRole("link", { name: /^روز بعد/ }).click();
    await expect(dialog).toHaveAccessibleName("پنجشنبه ۷ آبان ۱۴۰۵");
    await controls(dialog, nurse1)
      .getByRole("button", { name: "صبح (M)" })
      .focus();
    await page.keyboard.press("Delete");
    await saved(dialog);
    await expect(dialog).not.toContainText(finding);
    await expect(row(dialog, nurse1)).toContainText("نیاز به بررسی");

    // Arrow keys move between nurses; L is the long shift.
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("l");
    await saved(dialog);
    await expect(dialog.locator('li[data-shift="ME"]')).toHaveCount(1);

    await page.reload();
    await expect(dayDialog(page)).not.toContainText(finding);
    await expect(dayDialog(page).locator('li[data-shift="ME"]')).toHaveCount(1);
  });

  test("applies one shift to a range of days for one nurse, and undoes it", async ({
    page,
  }) => {
    test.skip(!isDesktop(page), "desktop flow");
    const nurse3 = department.nurseNames[2]!;
    await page.goto(monthUrl(department, "2026-11-01"));
    const dialog = dayDialog(page);
    await controls(dialog, nurse3)
      .getByRole("button", { name: `چند روز برای ${nurse3}` })
      .click();
    const form = dialog.getByRole("form", {
      name: `اعمال برای چند روز: ${nurse3}`,
    });
    await form.getByLabel("عصر (E)").check();
    await form
      .getByLabel("از این روز تا")
      .selectOption({ label: "سه‌شنبه ۱۲ آبان ۱۴۰۵" });
    await form.getByRole("button", { name: "اعمال برای ۳ روز" }).click();
    await saved(dialog, `عصر (E) برای «${nurse3}» در ۳ روز ثبت شد.`);

    await dialog.getByRole("link", { name: /^روز بعد/ }).click();
    await expect(dialog).toHaveAccessibleName("دوشنبه ۱۱ آبان ۱۴۰۵");
    await expectShift(dialog, nurse3, "عصر (E)");
    await dialog.getByRole("button", { name: "بازگردانی" }).click();
    await saved(dialog, "بازگردانده شد");
    await expectShift(dialog, nurse3, "تعیین‌نشده");
  });

  test("a stale tab gets a conflict instead of overwriting newer work", async ({
    page,
  }) => {
    test.skip(!isDesktop(page), "desktop flow");
    const nurse2 = department.nurseNames[1]!;
    await page.goto(monthUrl(department, "2026-10-30"));
    const stale = dayDialog(page);
    await expect(stale).toHaveAccessibleName("جمعه ۸ آبان ۱۴۰۵");

    // Another tab of the same Head Nurse saves first.
    const other = await page.context().newPage();
    await other.goto(monthUrl(department, "2026-10-30"));
    await controls(dayDialog(other), nurse2)
      .getByRole("button", { name: "شب (N)" })
      .click();
    await saved(dayDialog(other));
    await other.close();

    await controls(stale, nurse2)
      .getByRole("button", { name: "صبح (M)" })
      .click();
    await expect(stale.getByRole("alert")).toContainText(
      "برنامه در این فاصله در جای دیگری",
    );
    // The newer value is shown, not the stale tab's.
    await expectShift(stale, nurse2, "شب (N)");
    // The tab is current again: the next edit goes through.
    await controls(stale, nurse2)
      .getByRole("button", { name: "صبح (M)" })
      .click();
    await saved(stale);
  });

  test("a locked schedule offers no editing", async ({ page }) => {
    await forceScheduleStatus(department.abanId, "APPROVED");
    await page.goto(monthUrl(department, "2026-10-24"));
    const dialog = dayDialog(page);
    await expect(dialog.getByText("فقط مشاهده")).toBeVisible();
    await expect(dialog.getByRole("group", { name: /^شیفت / })).toHaveCount(0);
  });

  test("mobile: open a day, change and clear one nurse's shift", async ({
    page,
  }) => {
    test.skip(isDesktop(page), "phone flow");
    const nurse2 = department.nurseNames[1]!;
    await page.goto(monthUrl(department));
    await page
      .getByRole("region", { name: "تقویم ماه" })
      .getByRole("link", { name: /^شنبه ۲ آبان ۱۴۰۵/ })
      .click();
    const dialog = dayDialog(page);
    await expect(dialog).toHaveAccessibleName("شنبه ۲ آبان ۱۴۰۵");
    // Full screen, no sideways scrolling.
    const box = (await dialog.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(page.viewportSize()!.width - 1);
    await noHorizontalOverflow(page);

    // Touch-sized controls.
    const n = controls(dialog, nurse2).getByRole("button", { name: "شب (N)" });
    expect((await n.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await n.tap();
    await saved(dialog);
    await expectShift(dialog, nurse2, "شب (N)");
    // Matches the nurse's wish now.
    await expect(row(dialog, nurse2)).toContainText("مطابق ترجیح");

    await controls(dialog, nurse2)
      .getByRole("button", { name: "تعیین‌نشده" })
      .tap();
    await saved(dialog, "در فهرست پرسنل می‌ماند");
    await expect(row(dialog, nurse2)).toBeVisible();

    // The header (date, days, close) stays reachable after scrolling the list.
    await row(dialog, HEAD).scrollIntoViewIfNeeded();
    await expect(
      dialog.getByRole("button", { name: "بستن جزئیات روز" }),
    ).toBeInViewport();
    await noHorizontalOverflow(page);

    await page.reload();
    await expectShift(dayDialog(page), nurse2, "تعیین‌نشده");
  });
});

test.describe("schedule editing access", () => {
  test("a nurse cannot reach the editor (404), and a supervisor neither", async ({
    page,
  }) => {
    const department = await provisionReviewDepartment();
    for (const email of [department.nurseEmail, DEMO_USERS.supervisor.email]) {
      await signInAndWait(page, email);
      const response = await page.goto(
        `/departments/${department.code}/schedule?month=1405-08&day=2026-10-24`,
      );
      expect(response?.status()).toBe(404);
      await expect(page.getByRole("group", { name: /^شیفت / })).toHaveCount(0);
      await page.context().clearCookies();
    }
  });
});
