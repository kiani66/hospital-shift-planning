import { describe, expect, it } from "vitest";

import { eachDay, isoDate } from "@/domain/shared/dates";
import { PREFERENCE_VALUES } from "@/domain/shifts/shift-type";
import { formatJalaliDate } from "@/features/calendar/jalali";
import { ASSIGNMENT_PRESENTATION } from "@/features/shifts/catalog";

import {
  CLOSED_HEADLINE,
  LOCK_REASONS,
  NO_PREFERENCE,
  closedMonthHeadline,
  countPreferences,
  groupDays,
  initiallyOpenGroup,
  isRetryableSaveError,
  myPreferenceText,
  preferenceOption,
  preferenceOptions,
  preferencesHref,
  saveErrorMessage,
} from "./presentation";
import {
  RENAMED_SHIFT_LABELS,
  SHIFT_LABELS,
} from "../../../tests/support/shift-labels";

const aban = eachDay(isoDate("2026-10-23"), isoDate("2026-11-21")).map(
  (date) => ({ date }),
);

const PREFERENCE_OPTIONS = preferenceOptions(SHIFT_LABELS);

describe("preference options", () => {
  it("offers exactly the persisted preference values, one choice each, from the shared shift display", () => {
    expect(PREFERENCE_OPTIONS.map((o) => o.value)).toEqual([
      ...PREFERENCE_VALUES,
    ]);
    for (const o of PREFERENCE_OPTIONS) {
      expect(o.code).toBe(o.value);
      expect(o.short).toBe(SHIFT_LABELS[o.value]);
      expect(o.className).toBe(ASSIGNMENT_PRESENTATION[o.value].tokenClass);
      expect(o.icon).toBe(ASSIGNMENT_PRESENTATION[o.value].icon);
    }
    // "No preference" is the absence of a value, never a sixth option.
    expect(PREFERENCE_OPTIONS.map((o) => o.short)).not.toContain(NO_PREFERENCE);
    expect(preferenceOption("ME", SHIFT_LABELS).label).toBe(
      "طولانی (صبح + عصر)",
    );
    // Names follow the labels; the value stays the stable code.
    const renamed = preferenceOption("OFF", RENAMED_SHIFT_LABELS);
    expect(renamed.value).toBe("OFF");
    expect(renamed.code).toBe("OFF");
    expect(renamed.short).toBe("مرخصی‌روز");
  });

  it("says «ترجیح من» once, with the short Persian name only", () => {
    expect(
      PREFERENCE_VALUES.map((v) => myPreferenceText(v, SHIFT_LABELS)),
    ).toEqual([
      "ترجیح من: صبح",
      "ترجیح من: عصر",
      "ترجیح من: شب",
      "ترجیح من: طولانی",
      "ترجیح من: استراحت",
    ]);
    expect(myPreferenceText(null, SHIFT_LABELS)).toBe("بدون ترجیح");
  });

  it("never words a preference as an assignment", () => {
    const text = JSON.stringify([
      PREFERENCE_OPTIONS.map((o) => [o.code, o.short, o.label]),
      LOCK_REASONS,
    ]);
    expect(text).not.toMatch(/تأیید|قطعی|تخصیص|منصوب/);
  });
});

describe("groupDays: real Jalali date ranges, never week numbers", () => {
  const groups = groupDays(aban, isoDate("2026-10-24"));

  it("follows Saturday-first weeks cut to the schedule's days", () => {
    // 1 Aban 1405 is a Friday: a one-day first group, then Saturday-first ones.
    expect(groups.map((g) => g.days.length)).toEqual([1, 7, 7, 7, 7, 1]);
    expect(groups.slice(1).every((g) => g.days[0]!.weekday === "شنبه")).toBe(
      true,
    );
    expect(groups.flatMap((g) => g.days)).toHaveLength(30);
  });

  it("labels each group by its dates, without the year or a week number", () => {
    expect(groups.map((g) => g.label)).toEqual([
      "۱ آبان",
      "۲ تا ۸ آبان",
      "۹ تا ۱۵ آبان",
      "۱۶ تا ۲۲ آبان",
      "۲۳ تا ۲۹ آبان",
      "۳۰ آبان",
    ]);
    expect(groups.map((g) => g.label).join()).not.toMatch(/هفته/);
    expect(groups.map((g) => g.key)).toEqual(
      groups.map((g) => g.days[0]!.day.date),
    );
  });

  it("labels the days with the existing Jalali formatter", () => {
    const first = groups[1]!.days[0]!;
    expect(first).toMatchObject({
      weekday: "شنبه",
      dayNumber: "۲",
      monthName: "آبان",
      fullLabel: formatJalaliDate(isoDate("2026-10-24"), { weekday: true }),
      isToday: true,
    });
    expect(first.fullLabel).toBe("شنبه ۲ آبان ۱۴۰۵");
    expect(groups[0]!.days[0]!.isToday).toBe(false);
  });

  it("opens the group with today, else the first group", () => {
    expect(initiallyOpenGroup(groups)).toBe("2026-10-24");
    expect(groups[1]!.containsToday).toBe(true);
    const later = groupDays(aban, isoDate("2026-11-16"));
    expect(initiallyOpenGroup(later)).toBe("2026-11-14");
    const future = groupDays(aban, isoDate("2026-10-05"));
    expect(future.some((g) => g.containsToday)).toBe(false);
    expect(initiallyOpenGroup(future)).toBe("2026-10-23");
    expect(initiallyOpenGroup(groupDays([], isoDate("2026-10-05")))).toBeNull();
  });

  it("names ranges across two months by both month names", () => {
    const straddling = eachDay(
      isoDate("2026-10-20"),
      isoDate("2026-10-27"),
    ).map((date) => ({ date }));
    expect(
      groupDays(straddling, isoDate("2026-10-01")).map((g) => g.label),
    ).toEqual(["۲۸ مهر تا ۱ آبان", "۲ تا ۵ آبان"]);
  });
});

describe("countPreferences", () => {
  it("counts every value and the days without a preference", () => {
    expect(
      countPreferences([
        "M",
        "M",
        "E",
        "N",
        "ME",
        "OFF",
        "OFF",
        null,
        null,
        null,
      ]),
    ).toEqual({
      byValue: { M: 2, E: 1, N: 1, ME: 1, OFF: 2 },
      none: 3,
      days: 10,
    });
    expect(countPreferences([null, null])).toEqual({
      byValue: { M: 0, E: 0, N: 0, ME: 0, OFF: 0 },
      none: 2,
      days: 2,
    });
  });
});

describe("links", () => {
  it("navigates by ?month= and keeps an optional schedule", () => {
    expect(preferencesHref({ year: 1405, month: 9 })).toBe(
      "/preferences?month=1405-09",
    );
    expect(preferencesHref({ year: 1405, month: 8 }, "abc")).toBe(
      "/preferences?month=1405-08&schedule=abc",
    );
  });
});

describe("messages", () => {
  it("explains a fully locked month once, preferring the most common reason", () => {
    expect(closedMonthHeadline([null, "WINDOW_CLOSED"])).toBeNull();
    expect(closedMonthHeadline([])).toBeNull();
    expect(closedMonthHeadline(["WINDOW_CLOSED", "WINDOW_CLOSED"])).toBe(
      CLOSED_HEADLINE,
    );
    expect(CLOSED_HEADLINE).toBe("مهلت ثبت ترجیحات این ماه به پایان رسیده است");
    expect(
      closedMonthHeadline(["NOT_MEMBER", "NOT_MEMBER", "DATE_NOT_IN_WINDOW"]),
    ).toBe(LOCK_REASONS.NOT_MEMBER);
  });

  it("offers a retry only when sending again can help", () => {
    expect(isRetryableSaveError({ code: "INTERNAL", message: "" })).toBe(true);
    expect(isRetryableSaveError({ code: "CONFLICT", message: "" })).toBe(true);
    for (const code of ["FORBIDDEN", "NOT_FOUND", "VALIDATION"] as const)
      expect(isRetryableSaveError({ code, message: "" })).toBe(false);
  });

  it.each([
    [{ code: "FORBIDDEN", reason: "WINDOW_CLOSED" }, "بسته شد"],
    [{ code: "FORBIDDEN", reason: "DATE_NOT_IN_WINDOW" }, "قابل ویرایش نیست"],
    [{ code: "FORBIDDEN", reason: "ACTOR_INACTIVE" }, "اجازه"],
    [{ code: "NOT_FOUND" }, "در دسترس نیست"],
    [{ code: "CONFLICT" }, "هم‌زمان"],
    [{ code: "VALIDATION" }, "معتبر نیست"],
    [{ code: "INTERNAL" }, "دوباره تلاش کنید"],
  ] as const)("maps %o to Persian", (error, text) => {
    const message = saveErrorMessage({ message: "raw", ...error });
    expect(message).toContain(text);
    expect(message).not.toContain("raw");
  });
});
