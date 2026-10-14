import { expect, test, type Locator, type Page } from "@playwright/test";

import { addDays, type IsoDate } from "../../src/domain/shared/dates";
import { shiftMonths } from "../../src/features/calendar/date-picker";
import {
  faDigits,
  jalaliMonthLabel,
  toJalali,
} from "../../src/features/calendar/jalali";
import {
  formatJalaliInput,
  parseJalaliInput,
} from "../../src/features/calendar/jalali-input";
import { signInAndWait } from "./support/auth";
import { provisionPersonnel } from "./support/personnel";
import { readPersonMutationState } from "./support/personnel-mutations";

let fixture: Awaited<ReturnType<typeof provisionPersonnel>>;
test.beforeEach(async () => {
  fixture = await provisionPersonnel();
});

const START = "تاریخ شروع (شمسی)";
const END = "تاریخ پایان عضویت جدید (شمسی، اختیاری)";

/** The Add Membership dialog for the outsider (a member of the other department only). */
async function openAddMembership(page: Page) {
  await signInAndWait(page, fixture.people.admin.email);
  await page.goto(`/admin/personnel/${fixture.people.outsider.id}`);
  await page.getByRole("button", { name: "افزودن عضویت", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "افزودن عضویت" });
  await dialog.getByLabel("بخش", { exact: true }).selectOption(fixture.own.id);
  return dialog;
}

const calendarOf = (page: Page) =>
  page.getByRole("dialog", { name: "تقویم شمسی" });
const day = (calendar: Locator, date: IsoDate) =>
  calendar.locator(`[data-date="${date}"]`);
const monthName = (date: IsoDate) => {
  const { year, month } = toJalali(date);
  return jalaliMonthLabel({ year, month });
};

async function ownMemberships() {
  const state = await readPersonMutationState(
    fixture,
    fixture.people.outsider.id,
  );
  return state.history.memberships
    .filter((m) => m.departmentId === fixture.own.id)
    .map((m) => [m.startedOn, m.endedOn]);
}

test("start defaults to today; the calendar opens from the field or the icon, above the modal and unclipped", async ({
  page,
}) => {
  const dialog = await openAddMembership(page);
  const start = dialog.getByLabel(START);
  await expect(start).toHaveValue(formatJalaliInput(fixture.today));
  await expect(dialog.getByLabel(END)).toHaveValue("");

  await start.click();
  const calendar = calendarOf(page);
  await expect(calendar).toBeVisible();
  await expect(start).toHaveAttribute("aria-expanded", "true");
  await expect(start).toBeFocused();
  await expect(
    calendar.getByRole("grid", { name: monthName(fixture.today) }),
  ).toBeVisible();
  // Today is both the selected day and today (dot + aria-current).
  const today = day(calendar, fixture.today);
  await expect(today).toHaveAttribute("aria-current", "date");
  await expect(today.locator("xpath=..")).toHaveAttribute(
    "aria-selected",
    "true",
  );

  // Rendered in the top layer, inside the viewport, and nothing covers it.
  expect(await calendar.evaluate((el) => el.matches(":popover-open"))).toBe(
    true,
  );
  const box = (await calendar.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  for (const control of [
    calendar.getByRole("button", { name: "ماه قبل" }),
    calendar.getByRole("button", { name: "امروز", exact: true }),
  ]) {
    const onTop = await control.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(
        r.left + r.width / 2,
        r.top + r.height / 2,
      );
      return !!hit && el.contains(hit);
    });
    expect(onTop).toBe(true);
  }

  // A click outside closes only the calendar; the icon toggles it again.
  await dialog.getByRole("heading", { name: "افزودن عضویت" }).click();
  await expect(calendar).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "انتخاب از تقویم" }).first().click();
  await expect(calendar).toBeVisible();
  await expect(day(calendar, fixture.today)).toBeFocused();
});

test("months and years navigate with buttons and selectors; a picked day fills the field", async ({
  page,
}) => {
  const dialog = await openAddMembership(page);
  const start = dialog.getByLabel(START);
  await start.click();
  const calendar = calendarOf(page);
  await calendar.getByRole("button", { name: "ماه بعد" }).click();
  const nextMonth = shiftMonths(fixture.today, 1)!;
  await expect(
    calendar.getByRole("grid", { name: monthName(nextMonth) }),
  ).toBeVisible();
  await calendar.getByRole("button", { name: "ماه قبل" }).click();
  await calendar.getByRole("button", { name: "ماه قبل" }).click();
  await expect(
    calendar.getByRole("grid", {
      name: monthName(shiftMonths(fixture.today, -1)!),
    }),
  ).toBeVisible();

  const { year } = toJalali(fixture.today);
  await calendar
    .getByLabel("سال", { exact: true })
    .selectOption(String(year + 1));
  await calendar.getByLabel("ماه", { exact: true }).selectOption("12");
  await expect(
    calendar.getByRole("grid", { name: `اسفند ${faDigits(year + 1)}` }),
  ).toBeVisible();
  await day(calendar, parseJalaliInput(`${year + 1}/12/01`)!).click();
  await expect(calendar).toHaveCount(0);
  await expect(start).toBeFocused();
  await expect(start).toHaveValue(`${faDigits(year + 1)}/۱۲/۰۱`);
});

test("keyboard: ArrowDown opens, arrows/Page keys move, Enter picks, Escape closes only the calendar", async ({
  page,
}) => {
  const dialog = await openAddMembership(page);
  const start = dialog.getByLabel(START);
  await start.focus();
  await expect(calendarOf(page)).toHaveCount(0);
  await page.keyboard.press("ArrowDown");
  const calendar = calendarOf(page);
  await expect(day(calendar, fixture.today)).toBeFocused();

  // RTL grid: ArrowLeft is the next day, ArrowDown the next week.
  await page.keyboard.press("ArrowLeft");
  await expect(day(calendar, addDays(fixture.today, 1))).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowDown");
  await expect(day(calendar, addDays(fixture.today, 7))).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("PageDown");
  const nextMonth = shiftMonths(fixture.today, 1)!;
  await expect(day(calendar, nextMonth)).toBeFocused();
  await expect(
    calendar.getByRole("grid", { name: monthName(nextMonth) }),
  ).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(calendar).toHaveCount(0);
  await expect(start).toBeFocused();
  await expect(start).toHaveValue(formatJalaliInput(nextMonth));

  // Escape closes the calendar and returns focus; the membership dialog stays.
  await page.keyboard.press("ArrowDown");
  await expect(day(calendar, nextMonth)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(calendar).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(start).toBeFocused();
  await expect(start).toHaveValue(formatJalaliInput(nextMonth));
  // A second Escape closes the dialog as before.
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
});

test("keyboard: ArrowDown moves into a calendar already opened by a click", async ({
  page,
}) => {
  const dialog = await openAddMembership(page);
  const start = dialog.getByLabel(START);
  await start.click();
  const calendar = calendarOf(page);
  await expect(calendar).toBeVisible();
  await expect(start).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(day(calendar, fixture.today)).toBeFocused();
  // Tab leaves the grid for the footer; focus outside the field closes it.
  await page.keyboard.press("Tab");
  await expect(
    calendar.getByRole("button", { name: "امروز", exact: true }),
  ).toBeFocused();
  await dialog.getByLabel("نقش عضویت", { exact: true }).focus();
  await expect(calendar).toHaveCount(0);
});

test("typed dates accept Persian and Latin digits and report invalid days and the required start in Persian", async ({
  page,
}) => {
  const dialog = await openAddMembership(page);
  const start = dialog.getByLabel(START);
  const end = dialog.getByLabel(END);

  await end.fill("1404/12/30");
  await end.press("Tab");
  await expect(end).toHaveAttribute("aria-invalid", "true");
  await expect(dialog.getByText("اسفند ۱۴۰۴ فقط ۲۹ روز دارد.")).toBeVisible();

  await end.fill("abc");
  await end.blur();
  await expect(
    dialog.getByText("تاریخ شمسی معتبر با قالب سال/ماه/روز وارد کنید."),
  ).toBeVisible();

  // Latin digits with dashes are normalized to the Persian display format.
  const later = addDays(fixture.today, 40);
  const { year, month, day: d } = toJalali(later);
  await end.fill(`${year}-${month}-${d}`);
  await end.blur();
  await expect(end).toHaveValue(formatJalaliInput(later));
  await expect(end).toHaveAttribute("aria-invalid", "false");

  await start.fill("");
  await start.blur();
  await expect(dialog.getByText("تاریخ شمسی را وارد کنید.")).toBeVisible();
  await expect(start).toHaveAttribute("aria-invalid", "true");
  await start.fill(formatJalaliInput(addDays(fixture.today, 2)));
  await start.blur();
  await expect(start).toHaveAttribute("aria-invalid", "false");
});

test("the end date cannot precede the start, also when the start changes after the end was picked", async ({
  page,
}) => {
  const dialog = await openAddMembership(page);
  const start = dialog.getByLabel(START);
  const end = dialog.getByLabel(END);
  const startDate = addDays(fixture.today, 10);
  await start.fill(formatJalaliInput(startDate));
  await start.blur();

  // Days before the start are disabled in the end calendar.
  await end.click();
  const calendar = calendarOf(page);
  await calendar
    .getByLabel("ماه", { exact: true })
    .selectOption(String(toJalali(startDate).month));
  await calendar
    .getByLabel("سال", { exact: true })
    .selectOption(String(toJalali(startDate).year));
  const before = day(calendar, addDays(startDate, -1));
  if ((await before.count()) > 0) {
    await expect(before).toHaveAttribute("aria-disabled", "true");
    await before.click({ force: true });
    await expect(calendar).toBeVisible();
    await expect(end).toHaveValue("");
  }
  const endDate = addDays(startDate, 5);
  await calendar
    .getByLabel("ماه", { exact: true })
    .selectOption(String(toJalali(endDate).month));
  await calendar
    .getByLabel("سال", { exact: true })
    .selectOption(String(toJalali(endDate).year));
  await day(calendar, endDate).click();
  await expect(end).toHaveValue(formatJalaliInput(endDate));
  await expect(end).toHaveAttribute("aria-invalid", "false");

  // Moving the start past the chosen end flags the end at once, and back clears it.
  await start.fill(formatJalaliInput(addDays(endDate, 1)));
  await expect(end).toHaveAttribute("aria-invalid", "true");
  await expect(
    dialog.getByText(/تاریخ نمی‌تواند قبل از .* باشد\./),
  ).toBeVisible();
  await start.fill(formatJalaliInput(startDate));
  await expect(end).toHaveAttribute("aria-invalid", "false");

  // A typed end before the start is still refused by the server rule.
  await end.fill(formatJalaliInput(addDays(startDate, -3)));
  await dialog.getByRole("button", { name: "ثبت عضویت" }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(end).toHaveAttribute("aria-invalid", "true");
  expect(await ownMemberships()).toEqual([]);
});

test("picked dates are stored exactly; clearing the optional end makes the membership open-ended", async ({
  page,
}) => {
  const dialog = await openAddMembership(page);
  const start = dialog.getByLabel(START);
  const end = dialog.getByLabel(END);

  const startDate = addDays(fixture.today, 3);
  await start.click();
  let calendar = calendarOf(page);
  await calendar
    .getByLabel("ماه", { exact: true })
    .selectOption(String(toJalali(startDate).month));
  await calendar
    .getByLabel("سال", { exact: true })
    .selectOption(String(toJalali(startDate).year));
  await day(calendar, startDate).click();

  const endDate = addDays(startDate, 30);
  await end.click();
  calendar = calendarOf(page);
  await calendar
    .getByLabel("ماه", { exact: true })
    .selectOption(String(toJalali(endDate).month));
  await calendar
    .getByLabel("سال", { exact: true })
    .selectOption(String(toJalali(endDate).year));
  await day(calendar, endDate).click();
  await expect(end).toHaveValue(formatJalaliInput(endDate));
  // The optional end can be cleared from the calendar (open-ended).
  await end.click();
  await calendarOf(page)
    .getByRole("button", { name: "پاک کردن تاریخ" })
    .click();
  await expect(end).toHaveValue("");
  // The required start offers no clear button.
  await start.click();
  await expect(
    calendarOf(page).getByRole("button", { name: "پاک کردن تاریخ" }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");

  await dialog.getByRole("button", { name: "ثبت عضویت" }).click();
  await expect(dialog).not.toBeVisible();
  expect(await ownMemberships()).toEqual([[startDate, null]]);
});

test.describe("far from Tehran", () => {
  // The browser's own timezone must not shift picked days.
  test.use({ timezoneId: "Pacific/Kiritimati" });

  test("the picked day is the stored day", async ({ page }) => {
    const dialog = await openAddMembership(page);
    const start = dialog.getByLabel(START);
    await expect(start).toHaveValue(formatJalaliInput(fixture.today));
    await start.click();
    const calendar = calendarOf(page);
    const target = addDays(fixture.today, 1);
    await calendar
      .getByLabel("ماه", { exact: true })
      .selectOption(String(toJalali(target).month));
    await calendar
      .getByLabel("سال", { exact: true })
      .selectOption(String(toJalali(target).year));
    await expect(day(calendar, fixture.today)).toHaveAttribute(
      "aria-current",
      "date",
    );
    await day(calendar, target).click();
    const endDate = addDays(target, 7);
    await dialog.getByLabel(END).fill(formatJalaliInput(endDate));
    await dialog.getByRole("button", { name: "ثبت عضویت" }).click();
    await expect(dialog).not.toBeVisible();
    expect(await ownMemberships()).toEqual([[target, endDate]]);
  });
});
