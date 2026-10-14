import { afterEach, describe, expect, it } from "vitest";

import { isoDate, type IsoDate } from "@/domain/shared/dates";

import {
  clampDate,
  DATE_MESSAGES,
  isOutOfRange,
  jalaliMonthLength,
  monthInRange,
  moveFocus,
  pickerMonth,
  pickerYears,
  sameDayIn,
  shiftMonths,
  validateDateText,
} from "./date-picker";
import { formatJalaliInput, parseJalaliInput } from "./jalali-input";

/** A Jalali day as its ISO date (the picker's value). */
const j = (text: string): IsoDate => {
  const date = parseJalaliInput(text);
  if (!date) throw new Error(`invalid Jalali test date ${text}`);
  return date;
};
const show = (date: IsoDate | null) => date && formatJalaliInput(date);

describe("Jalali month arithmetic", () => {
  it("knows leap Esfand and the 31/30-day halves of the year", () => {
    expect(jalaliMonthLength({ year: 1403, month: 12 })).toBe(30);
    expect(jalaliMonthLength({ year: 1404, month: 12 })).toBe(29);
    expect(jalaliMonthLength({ year: 1399, month: 12 })).toBe(30);
    expect(jalaliMonthLength({ year: 1405, month: 6 })).toBe(31);
    expect(jalaliMonthLength({ year: 1405, month: 7 })).toBe(30);
  });

  it("keeps the day of month, or the last day when the target month is shorter", () => {
    expect(show(sameDayIn(j("1405/06/31"), { year: 1405, month: 7 }))).toBe(
      "۱۴۰۵/۰۷/۳۰",
    );
    expect(show(shiftMonths(j("1403/12/30"), 12))).toBe("۱۴۰۴/۱۲/۲۹");
    expect(show(shiftMonths(j("1404/01/31"), -1))).toBe("۱۴۰۳/۱۲/۳۰");
    expect(show(shiftMonths(j("1405/01/31"), -1))).toBe("۱۴۰۴/۱۲/۲۹");
    expect(show(shiftMonths(j("1405/11/15"), 3))).toBe("۱۴۰۶/۰۲/۱۵");
  });

  it("stops at the supported years", () => {
    expect(shiftMonths(j("1500/12/01"), 1)).toBeNull();
    expect(shiftMonths(j("1300/01/01"), -1)).toBeNull();
    expect(clampDate(isoDate("1900-01-01"), {})).toBe(j("1300/01/01"));
  });
});

describe("bounds", () => {
  const bounds = { minDate: j("1405/07/10"), maxDate: j("1405/08/20") };

  it("checks and clamps inclusive min and max", () => {
    expect(isOutOfRange(j("1405/07/10"), bounds)).toBe(false);
    expect(isOutOfRange(j("1405/07/09"), bounds)).toBe(true);
    expect(isOutOfRange(j("1405/08/21"), bounds)).toBe(true);
    expect(isOutOfRange(j("1300/01/01"), {})).toBe(false);
    expect(clampDate(j("1405/01/01"), bounds)).toBe(bounds.minDate);
    expect(clampDate(j("1406/01/01"), bounds)).toBe(bounds.maxDate);
  });

  it("offers only months and years with an allowed day", () => {
    expect(monthInRange({ year: 1405, month: 6 }, bounds)).toBe(false);
    expect(monthInRange({ year: 1405, month: 7 }, bounds)).toBe(true);
    expect(monthInRange({ year: 1405, month: 8 }, bounds)).toBe(true);
    expect(monthInRange({ year: 1405, month: 9 }, bounds)).toBe(false);
    expect(pickerYears(bounds)).toEqual([1405]);
    expect(pickerYears({}).at(0)).toBe(1300);
    expect(pickerYears({}).at(-1)).toBe(1500);
  });
});

describe("keyboard movement", () => {
  // 1405/07/11 is Saturday 2026-10-03.
  const day = j("1405/07/11");

  it("moves by day in the right-to-left grid, by week vertically", () => {
    expect(show(moveFocus(day, "ArrowLeft"))).toBe("۱۴۰۵/۰۷/۱۲");
    expect(show(moveFocus(day, "ArrowRight"))).toBe("۱۴۰۵/۰۷/۱۰");
    expect(show(moveFocus(day, "ArrowDown"))).toBe("۱۴۰۵/۰۷/۱۸");
    expect(show(moveFocus(day, "ArrowUp"))).toBe("۱۴۰۵/۰۷/۰۴");
  });

  it("flips the horizontal arrows in a left-to-right layout", () => {
    expect(show(moveFocus(day, "ArrowRight", { ltr: true }))).toBe(
      "۱۴۰۵/۰۷/۱۲",
    );
    expect(show(moveFocus(day, "ArrowLeft", { ltr: true }))).toBe("۱۴۰۵/۰۷/۱۰");
  });

  it("goes to the Saturday and Friday of the week with Home and End", () => {
    const wednesday = j("1405/07/15");
    expect(show(moveFocus(wednesday, "Home"))).toBe("۱۴۰۵/۰۷/۱۱");
    expect(show(moveFocus(wednesday, "End"))).toBe("۱۴۰۵/۰۷/۱۷");
  });

  it("changes month and, with Shift, year with PageUp and PageDown", () => {
    expect(show(moveFocus(day, "PageDown"))).toBe("۱۴۰۵/۰۸/۱۱");
    expect(show(moveFocus(day, "PageUp"))).toBe("۱۴۰۵/۰۶/۱۱");
    expect(show(moveFocus(day, "PageDown", { shiftKey: true }))).toBe(
      "۱۴۰۶/۰۷/۱۱",
    );
    expect(show(moveFocus(day, "PageUp", { shiftKey: true }))).toBe(
      "۱۴۰۴/۰۷/۱۱",
    );
  });

  it("crosses month and year boundaries", () => {
    expect(show(moveFocus(j("1405/07/30"), "ArrowLeft"))).toBe("۱۴۰۵/۰۸/۰۱");
    expect(show(moveFocus(j("1403/12/30"), "ArrowLeft"))).toBe("۱۴۰۴/۰۱/۰۱");
    expect(show(moveFocus(j("1404/01/01"), "ArrowRight"))).toBe("۱۴۰۳/۱۲/۳۰");
  });

  it("never leaves the allowed range and ignores other keys", () => {
    const bounds = { minDate: j("1405/07/10"), maxDate: j("1405/07/20") };
    expect(show(moveFocus(day, "ArrowUp", bounds))).toBe("۱۴۰۵/۰۷/۱۰");
    expect(show(moveFocus(day, "PageDown", bounds))).toBe("۱۴۰۵/۰۷/۲۰");
    expect(moveFocus(day, "Enter")).toBeNull();
    expect(moveFocus(day, "a")).toBeNull();
  });
});

describe("visible month", () => {
  it("lays out a Saturday-first month with selected, today and disabled days", () => {
    const month = pickerMonth(j("1405/07/11"), {
      selected: j("1405/07/20"),
      today: j("1405/07/22"),
      minDate: j("1405/07/05"),
    });
    expect(month.label).toBe("مهر ۱۴۰۵");
    expect(month.weekdays[0]).toEqual({ long: "شنبه", short: "ش" });
    expect(month.weekdays[6]!.long).toBe("جمعه");
    const days = month.weeks.flat().filter((d) => d !== null);
    expect(days).toHaveLength(30);
    expect(days[0]!.label).toBe("۱");
    // 1 Mehr 1405 is a Wednesday: four empty cells before it.
    expect(month.weeks[0]!.slice(0, 4)).toEqual([null, null, null, null]);
    expect(days.filter((d) => d.selected).map((d) => d.label)).toEqual(["۲۰"]);
    expect(days.filter((d) => d.today).map((d) => d.label)).toEqual(["۲۲"]);
    expect(days.filter((d) => d.focused).map((d) => d.label)).toEqual(["۱۱"]);
    expect(days.filter((d) => d.disabled).map((d) => d.label)).toEqual([
      "۱",
      "۲",
      "۳",
      "۴",
    ]);
    expect(days.find((d) => d.label === "۱۱")!.name).toBe("شنبه ۱۱ مهر ۱۴۰۵");
    expect(month.canGoPrevious).toBe(false);
    expect(month.canGoNext).toBe(true);
  });

  it("shows 30 days in a leap Esfand and 29 otherwise", () => {
    const count = (date: IsoDate) =>
      pickerMonth(date, { selected: null, today: null })
        .weeks.flat()
        .filter((d) => d !== null).length;
    expect(count(j("1403/12/01"))).toBe(30);
    expect(count(j("1404/12/01"))).toBe(29);
  });

  it("disables navigation at the last supported month", () => {
    const month = pickerMonth(j("1500/12/10"), { selected: null, today: null });
    expect(month.canGoNext).toBe(false);
    expect(month.canGoPrevious).toBe(true);
  });
});

describe("typed text validation", () => {
  it.each([
    "1405/07/11",
    "۱۴۰۵/۰۷/۱۱",
    "١٤٠٥/٠٧/١١",
    "1405-7-11",
    " ۱۴۰۵/7/۱۱ ",
  ])("accepts %s in Persian, Arabic or Latin digits", (text) => {
    expect(validateDateText(text, {})).toEqual({
      ok: true,
      value: isoDate("2026-10-03"),
    });
  });

  it("allows an empty optional field and requires a required one", () => {
    expect(validateDateText("  ", {})).toEqual({ ok: true, value: null });
    expect(validateDateText("", { required: true })).toEqual({
      ok: false,
      message: DATE_MESSAGES.required,
    });
  });

  it.each([
    ["1405/13/01", DATE_MESSAGES.format],
    ["1405/00/10", DATE_MESSAGES.format],
    ["1405/07/00", DATE_MESSAGES.format],
    ["14050711", DATE_MESSAGES.format],
    ["abc", DATE_MESSAGES.format],
    ["2026-10-03", DATE_MESSAGES.years],
    ["1299/12/29", DATE_MESSAGES.years],
    ["1405/07/31", "مهر ۱۴۰۵ فقط ۳۰ روز دارد."],
    ["1404/12/30", "اسفند ۱۴۰۴ فقط ۲۹ روز دارد."],
    ["۱۴۰۵/۰۱/۳۲", "فروردین ۱۴۰۵ فقط ۳۱ روز دارد."],
  ])("rejects %s with a Persian message", (text, message) => {
    expect(validateDateText(text, {})).toEqual({ ok: false, message });
  });

  it("accepts 30 Esfand only in a leap year", () => {
    expect(validateDateText("1403/12/30", {}).ok).toBe(true);
    expect(validateDateText("1399/12/30", {}).ok).toBe(true);
    expect(validateDateText("1400/12/30", {}).ok).toBe(false);
  });

  it("reports days outside the bounds, both bounds inclusive", () => {
    const bounds = { minDate: j("1405/07/11"), maxDate: j("1405/08/01") };
    expect(validateDateText("1405/07/11", bounds).ok).toBe(true);
    expect(validateDateText("1405/08/01", bounds).ok).toBe(true);
    expect(validateDateText("1405/07/10", bounds)).toEqual({
      ok: false,
      message: "تاریخ نمی‌تواند قبل از ۱۱ مهر ۱۴۰۵ باشد.",
    });
    expect(validateDateText("1405/08/02", bounds)).toEqual({
      ok: false,
      message: "تاریخ نمی‌تواند بعد از ۱ آبان ۱۴۰۵ باشد.",
    });
  });
});

describe("timezone independence", () => {
  const original = process.env.TZ;
  afterEach(() => {
    process.env.TZ = original;
  });

  it.each([
    "Asia/Tehran",
    "America/Los_Angeles",
    "Pacific/Kiritimati",
    "Pacific/Pago_Pago",
  ])("converts the same day in %s", (zone) => {
    process.env.TZ = zone;
    expect(validateDateText("1405/01/01", {})).toEqual({
      ok: true,
      value: isoDate("2026-03-21"),
    });
    expect(formatJalaliInput(isoDate("2026-03-20"))).toBe("۱۴۰۴/۱۲/۲۹");
    const month = pickerMonth(isoDate("2026-10-03"), {
      selected: isoDate("2026-10-03"),
      today: null,
    });
    expect(month.label).toBe("مهر ۱۴۰۵");
    expect(month.weeks.flat().find((d) => d?.selected)?.label).toBe("۱۱");
  });
});
