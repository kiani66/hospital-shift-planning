import { expect, test, type Locator, type Page } from "@playwright/test";

import { isDesktop, signInAndWait } from "./support/auth";
import {
  LONG_NAME,
  provisionAlignmentDepartment,
  type AlignmentDepartment,
} from "./support/review";

/**
 * D99: the day editor's preference alignment («انطباق با ترجیحات»), row
 * hierarchy, «فقط مغایر ترجیح» filter, staffing presentation and responsive
 * layout. Fixture: `provisionAlignmentDepartment` (2 Aban: one match, two
 * conflicts, one without preference; 5 Aban: an OFF and a shift wish, both
 * awaiting assignment
 * wish; 7 Aban: no preference at all).
 */

const HEAD = "سرپرستار آزمایشی";
const dayUrl = (d: AlignmentDepartment, day: string) =>
  `/departments/${d.code}/schedule?month=1405-08&day=${day}`;

const dayDialog = (page: Page) => page.getByRole("dialog");
const controls = (dialog: Locator, name: string) =>
  dialog.getByRole("group", { name: `شیفت ${name}` });
const row = (dialog: Locator, name: string) =>
  dialog.locator("li[data-nurse-row]").filter({
    has: dialog.page().getByRole("group", { name: `شیفت ${name}` }),
  });
const rows = (dialog: Locator) => dialog.locator("li[data-nurse-row]");
const conflictsOnly = (dialog: Locator) =>
  dialog.getByRole("button", { name: /^فقط مغایر ترجیح/ });
const chip = (dialog: Locator, name: RegExp) =>
  dialog
    .getByRole("group", { name: "نمایش پرسنل" })
    .getByRole("button", { name });
const alignment = (dialog: Locator) =>
  dialog.getByRole("region", { name: "انطباق با ترجیحات" });
const count = (dialog: Locator, name: string) =>
  alignment(dialog).locator(`[data-alignment="${name}"]`);

async function saved(dialog: Locator, text: RegExp | string = /ثبت شد|پاک شد/) {
  await expect(dialog.locator("[data-pending]")).toHaveCount(0);
  await expect(dialog.getByRole("status").first()).toContainText(text);
}

async function expectShift(dialog: Locator, name: string, shift: string) {
  await expect(
    controls(dialog, name).getByRole("button", { name: shift }),
  ).toHaveAttribute("aria-pressed", "true");
}

/** Every rostered nurse's pressed control, by name: the assignments on screen. */
const assignmentsOnScreen = (dialog: Locator) =>
  dialog.evaluate((root) =>
    [...root.querySelectorAll<HTMLElement>("li[data-nurse-row]")]
      .map((li) => [li.dataset.nurseRow, li.dataset.shift])
      .sort(),
  );

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

/** Optional screenshots for the PR (`SCREENSHOT_DIR=… pnpm test:e2e …`). */
async function snapshot(page: Page, name: string) {
  const dir = process.env.SCREENSHOT_DIR;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png` });
}

let department: AlignmentDepartment;

test.beforeEach(async ({ page }) => {
  department = await provisionAlignmentDepartment();
  await signInAndWait(page, department.headEmail);
});

test.describe("preference alignment summary and rows", () => {
  test("counts matches, conflicts, pending wishes and no preference; unassigned apart", async ({
    page,
  }) => {
    const [nurse1, nurse2, nurse3] = department.nurseNames;
    await page.goto(dayUrl(department, "2026-10-24"));
    const dialog = dayDialog(page);
    await expect(dialog).toHaveAccessibleName("شنبه ۲ آبان ۱۴۰۵");

    await expect(count(dialog, "matches")).toHaveText(/مطابق ترجیح\s*۱\s*نفر/);
    await expect(count(dialog, "differs")).toHaveText(/مغایر ترجیح\s*۲\s*نفر/);
    await expect(count(dialog, "pending")).toHaveText(/۰\s*نفر/);
    await expect(count(dialog, "noPreference")).toHaveText(
      /ترجیحی ثبت نشده\s*۱\s*نفر/,
    );
    await expect(alignment(dialog)).toContainText(
      "هر نفر فقط در یکی از این چهار دسته است (جمع: ۴ نفر).",
    );
    await expect(count(dialog, "unassigned")).toHaveText(
      /^تعیین‌نشده در این روز:\s*۰ نفر\s*جدا شمرده می‌شود/,
    );
    await expect(alignment(dialog)).toContainText(
      "مغایرت با ترجیح جلوی نهایی‌سازی برنامه را نمی‌گیرد",
    );

    // Rows: name, role, recorded preference and fit, in words.
    await expect(row(dialog, nurse1)).toContainText("ترجیح: صبح");
    await expect(row(dialog, nurse1)).toContainText("مطابق ترجیح");
    await expect(row(dialog, nurse2)).toContainText("ترجیح: شب");
    await expect(row(dialog, nurse2)).toContainText("مغایر ترجیح");
    // An explicit rest wish is not "no preference".
    await expect(row(dialog, nurse3)).toContainText("ترجیح: استراحت");
    await expect(row(dialog, nurse3)).toContainText("مغایر ترجیح");
    await expect(row(dialog, HEAD)).toContainText("سرپرستار");
    await expect(row(dialog, HEAD)).toContainText("ترجیحی ثبت نشده");
    await expect(row(dialog, HEAD)).not.toContainText("ترجیح:");
    // The preference line describes each shift control for screen readers.
    await expect(
      controls(dialog, nurse2).getByRole("button", { name: "عصر (E)" }),
    ).toHaveAccessibleDescription(/ترجیح: شب\s*مغایر ترجیح/);

    // No staffing bounds are configured: said once, never green.
    const coverage = dialog.getByRole("region", { name: "پوشش نفرات" });
    await expect(coverage).toContainText(
      "تأمین نفرات ارزیابی نشده است؛ حداقل و حداکثر نفرات تعریف نشده است.",
    );
    await expect(
      coverage.locator('[data-staffing="NOT_EVALUATED"]'),
    ).toHaveCount(3);
    await expect(coverage).not.toContainText(/در محدوده|کمبود|مازاد/);
    // The day itself still validates (D40): conflicts are not findings.
    await expect(dialog).toContainText("مغایرتی یافت نشد");
    await snapshot(page, `summary-${test.info().project.name}`);
  });

  test("OFF and shift wishes without an assignment are both awaiting, never a match", async ({
    page,
  }) => {
    const [nurse1, nurse2] = department.nurseNames;
    await page.goto(dayUrl(department, "2026-10-27"));
    const dialog = dayDialog(page);
    // No working shift is not an OFF decision (D99).
    await expect(count(dialog, "matches")).toHaveText(/مطابق ترجیح\s*۰\s*نفر/);
    await expect(count(dialog, "differs")).toHaveText(/۰\s*نفر/);
    await expect(count(dialog, "pending")).toHaveText(
      /ترجیح ثبت‌شده، در انتظار تخصیص\s*۲\s*نفر/,
    );
    await expect(count(dialog, "noPreference")).toHaveText(/۲\s*نفر/);
    // Everyone is unassigned: the overlapping count is shown apart.
    await expect(count(dialog, "unassigned")).toContainText("۴ نفر");
    await expect(row(dialog, nurse1)).toContainText("ترجیح: استراحت");
    await expect(row(dialog, nurse1)).toContainText("در انتظار تخصیص");
    await expect(row(dialog, nurse1)).not.toContainText("مطابق ترجیح");
    await expect(row(dialog, nurse2)).toContainText("ترجیح: عصر");
    await expect(row(dialog, nurse2)).toContainText("در انتظار تخصیص");
  });
});

test.describe("«فقط مغایر ترجیح» filter", () => {
  test("combines with the shift filter and search, has empty states, and never changes assignments", async ({
    page,
  }) => {
    const [nurse1, nurse2, nurse3] = department.nurseNames;
    await page.goto(dayUrl(department, "2026-10-24"));
    const dialog = dayDialog(page);
    const before = await assignmentsOnScreen(dialog);

    await expect(conflictsOnly(dialog)).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await expect(conflictsOnly(dialog)).toHaveText(/۲$/);
    await conflictsOnly(dialog).click();
    await expect(conflictsOnly(dialog)).toHaveAttribute("aria-pressed", "true");
    await expect(rows(dialog)).toHaveCount(2);
    await expect(row(dialog, nurse2)).toBeVisible();
    await expect(row(dialog, nurse3)).toBeVisible();

    // AND with the shift filter.
    await chip(dialog, /^عصر \(E\)/).click();
    await expect(rows(dialog)).toHaveCount(1);
    await expect(row(dialog, nurse2)).toBeVisible();
    await chip(dialog, /^صبح \(M\)/).click();
    await expect(rows(dialog)).toHaveCount(0);
    await expect(dialog.locator("[data-empty-list]")).toContainText(
      "هیچ پرستاری با این فیلتر یا جستجو پیدا نشد.",
    );
    await chip(dialog, /^همه/).click();

    // AND with the name search.
    await dialog
      .getByRole("searchbox", { name: "جستجوی نام" })
      .fill("بسیار طولانی");
    await expect(rows(dialog)).toHaveCount(1);
    await expect(row(dialog, nurse3)).toBeVisible();
    await dialog.getByRole("searchbox", { name: "جستجوی نام" }).fill(nurse1);
    await expect(rows(dialog)).toHaveCount(0);

    // One control clears every filter.
    await dialog.getByRole("button", { name: "نمایش همه پرسنل" }).click();
    await expect(rows(dialog)).toHaveCount(department.memberCount);
    await expect(conflictsOnly(dialog)).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await expect(
      dialog.getByRole("searchbox", { name: "جستجوی نام" }),
    ).toHaveValue("");

    // Filtering wrote nothing.
    expect(await assignmentsOnScreen(dialog)).toEqual(before);
    await page.reload();
    expect(await assignmentsOnScreen(dayDialog(page))).toEqual(before);
  });

  test("empty states: no conflict on the day, and no preference at all", async ({
    page,
  }) => {
    await page.goto(dayUrl(department, "2026-10-27"));
    const dialog = dayDialog(page);
    await conflictsOnly(dialog).click();
    await expect(dialog.locator("[data-empty-list]")).toContainText(
      "در این روز هیچ شیفتی مغایر ترجیحات ثبت‌شده نیست.",
    );
    await snapshot(page, `empty-${test.info().project.name}`);

    // The filter is kept across days.
    await dialog.getByRole("link", { name: /^روز بعد/ }).click();
    await expect(dialog).toHaveAccessibleName("چهارشنبه ۶ آبان ۱۴۰۵");
    await dialog.getByRole("link", { name: /^روز بعد/ }).click();
    await expect(dialog).toHaveAccessibleName("پنجشنبه ۷ آبان ۱۴۰۵");
    await expect(dialog.locator("[data-empty-list]")).toContainText(
      "برای این روز هیچ ترجیحی ثبت نشده است؛ موردی مغایر ترجیح برای نمایش نیست.",
    );
    await expect(count(dialog, "noPreference")).toHaveText(/۴\s*نفر/);
  });

  test("assigning and unassigning under the filter: the edited row stays, the summary follows", async ({
    page,
  }) => {
    test.skip(!isDesktop(page), "desktop flow");
    const [, nurse2, nurse3] = department.nurseNames;
    await page.goto(dayUrl(department, "2026-10-24"));
    const dialog = dayDialog(page);
    await conflictsOnly(dialog).click();

    // Give nurse 2 the wished Night: no longer a conflict, still listed.
    await controls(dialog, nurse2)
      .getByRole("button", { name: "شب (N)" })
      .click();
    await saved(dialog, `شب (N) برای «${nurse2}»`);
    await expectShift(dialog, nurse2, "شب (N)");
    await expect(row(dialog, nurse2)).toContainText("مطابق ترجیح");
    await expect(rows(dialog)).toHaveCount(2);
    await expect(conflictsOnly(dialog)).toHaveText(/۱$/);

    // Clear nurse 3's Night: no longer a conflict, but not a match either:
    // an OFF wish without an assignment is awaiting (D99).
    await controls(dialog, nurse3)
      .getByRole("button", { name: "تعیین‌نشده" })
      .click();
    await saved(dialog, "در فهرست پرسنل می‌ماند");
    await expect(row(dialog, nurse3)).toContainText("در انتظار تخصیص");
    await expect(row(dialog, nurse3)).not.toContainText("مطابق ترجیح");
    await expect(conflictsOnly(dialog)).toHaveText(/۰$/);

    // The summary is re-read with the day after each edit.
    await expect(count(dialog, "matches")).toHaveText(/۲\s*نفر/);
    await expect(count(dialog, "differs")).toHaveText(/۰\s*نفر/);
    await expect(count(dialog, "pending")).toHaveText(/۱\s*نفر/);
    await expect(count(dialog, "unassigned")).toContainText("۱ نفر");
    // N moved from nurse 3 to nurse 2: Night coverage stays one.
    await expect(
      dialog
        .getByRole("region", { name: "پوشش نفرات" })
        .locator('[data-period="N"]'),
    ).toContainText("۱");

    // Re-toggling drops the kept rows: nothing conflicts now.
    await conflictsOnly(dialog).click();
    await conflictsOnly(dialog).click();
    await expect(dialog.locator("[data-empty-list]")).toContainText(
      "در این روز هیچ شیفتی مغایر ترجیحات ثبت‌شده نیست.",
    );

    // Undo still goes through the server.
    await dialog.getByRole("button", { name: "بازگردانی" }).click();
    await saved(dialog, "بازگردانده شد");
    await page.reload();
    await expectShift(dayDialog(page), nurse3, "شب (N)");
    await expectShift(dayDialog(page), nurse2, "شب (N)");
  });

  test("keyboard: toggle with the keyboard, visible focus, shortcuts work on the filtered list", async ({
    page,
  }) => {
    test.skip(!isDesktop(page), "keyboard flow");
    const [, nurse2] = department.nurseNames;
    await page.goto(dayUrl(department, "2026-10-24"));
    const dialog = dayDialog(page);

    // Reach the toggle with Tab from the last shift chip.
    await chip(dialog, /^طولانی \(ME\)/).focus();
    await page.keyboard.press("Tab");
    await expect(conflictsOnly(dialog)).toBeFocused();
    expect(
      await conflictsOnly(dialog).evaluate((el) =>
        el.matches(":focus-visible"),
      ),
    ).toBe(true);
    await page.keyboard.press("Space");
    await expect(conflictsOnly(dialog)).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Enter");
    await expect(conflictsOnly(dialog)).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await page.keyboard.press("Enter");
    await expect(rows(dialog)).toHaveCount(2);

    // The list stays one tab stop; ↓ / ↑ move within the filtered rows.
    await page.keyboard.press("Tab");
    await expect(
      dialog.getByRole("searchbox", { name: "جستجوی نام" }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    const morning = (n: number) =>
      rows(dialog).nth(n).getByRole("button", { name: "صبح (M)" });
    await expect(morning(0)).toBeFocused();
    expect(
      await morning(0).evaluate((el) => el.matches(":focus-visible")),
    ).toBe(true);
    await page.keyboard.press("ArrowDown");
    await expect(morning(1)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    // The last filtered row: focus stays.
    await expect(morning(1)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(morning(0)).toBeFocused();
    await expect(rows(dialog)).toHaveCount(2);

    // N on nurse 2 (the wish): saved, the row stays, the toggle count drops.
    await controls(dialog, nurse2)
      .getByRole("button", { name: "صبح (M)" })
      .focus();
    await page.keyboard.press("n");
    await saved(dialog);
    await expectShift(dialog, nurse2, "شب (N)");
    await expect(conflictsOnly(dialog)).toHaveText(/۱$/);
    await page.keyboard.press("Control+z");
    await saved(dialog, "بازگردانده شد");
    await expectShift(dialog, nurse2, "عصر (E)");
  });
});

test.describe("responsive layout", () => {
  for (const width of [360, 390]) {
    test(`phone ${width}px: full screen, no sideways scrolling, touch-sized controls, long names contained`, async ({
      page,
    }) => {
      test.skip(isDesktop(page), "phone projects");
      await page.setViewportSize({ width, height: 800 });
      const [, nurse2] = department.nurseNames;
      await page.goto(dayUrl(department, "2026-10-24"));
      const dialog = dayDialog(page);
      await expect(dialog).toHaveAccessibleName("شنبه ۲ آبان ۱۴۰۵");
      expect((await dialog.boundingBox())!.width).toBeGreaterThanOrEqual(
        width - 1,
      );
      await noHorizontalOverflow(page);

      // Filters wrap instead of scrolling sideways.
      const group = dialog.getByRole("group", { name: "نمایش پرسنل" });
      const scroll = await group.evaluate(
        (el) => el.scrollWidth - el.clientWidth,
      );
      expect(scroll).toBeLessThanOrEqual(0);
      for (const target of [
        conflictsOnly(dialog),
        chip(dialog, /^صبح \(M\)/),
        controls(dialog, nurse2).getByRole("button", { name: "شب (N)" }),
        controls(dialog, nurse2).getByRole("button", { name: "تعیین‌نشده" }),
      ])
        expect((await target.boundingBox())!.height).toBeGreaterThanOrEqual(44);

      // A very long name is truncated inside its row (full name kept as title).
      const longRow = row(dialog, LONG_NAME);
      await longRow.scrollIntoViewIfNeeded();
      const rowBox = (await longRow.boundingBox())!;
      const name = longRow.getByTitle(LONG_NAME);
      const nameBox = (await name.boundingBox())!;
      expect(nameBox.x).toBeGreaterThanOrEqual(rowBox.x - 1);
      expect(nameBox.x + nameBox.width).toBeLessThanOrEqual(
        rowBox.x + rowBox.width + 1,
      );
      await noHorizontalOverflow(page);

      // The filter works by touch, and assignment still works.
      await conflictsOnly(dialog).tap();
      await expect(rows(dialog)).toHaveCount(2);
      await controls(dialog, nurse2)
        .getByRole("button", { name: "شب (N)" })
        .tap();
      await saved(dialog);
      await expect(row(dialog, nurse2)).toContainText("مطابق ترجیح");
      await noHorizontalOverflow(page);
      await snapshot(page, `phone-${width}-${test.info().project.name}`);
    });
  }

  for (const width of [768, 1280, 1440]) {
    test(`${width}px: no sideways scrolling; summary beside or above the list`, async ({
      page,
    }) => {
      test.skip(!isDesktop(page), "desktop project");
      await page.setViewportSize({ width, height: 900 });
      await page.goto(dayUrl(department, "2026-10-24"));
      const dialog = dayDialog(page);
      await expect(alignment(dialog)).toBeVisible();
      await expect(rows(dialog)).toHaveCount(department.memberCount);
      await noHorizontalOverflow(page);
      const summary = (await alignment(dialog).boundingBox())!;
      const list = (await rows(dialog).first().boundingBox())!;
      if (width >= 1024)
        // Side column (inline start = right in RTL) next to the list.
        expect(summary.x).toBeGreaterThan(list.x + list.width - 1);
      else expect(summary.y).toBeLessThan(list.y);
      await snapshot(page, `desktop-${width}`);
    });
  }
});
