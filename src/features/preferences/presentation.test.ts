import { describe, expect, it } from "vitest";

import { eachDay, isoDate } from "@/domain/shared/dates";
import { PREFERENCE_VALUES } from "@/domain/shifts/shift-type";
import {
  formatJalaliDate,
  formatJalaliRange,
} from "@/features/calendar/jalali";

import {
  LOCK_REASONS,
  PREFERENCE_OPTIONS,
  groupIntoWeeks,
  preferenceOption,
  saveErrorMessage,
  scheduleLockMessage,
} from "./presentation";

const aban = eachDay(isoDate("2026-10-23"), isoDate("2026-11-21")).map(
  (date) => ({ date }),
);

describe("preference options", () => {
  it("offers exactly the persisted preference values, each with code text", () => {
    expect(PREFERENCE_OPTIONS.map((o) => o.value)).toEqual([
      ...PREFERENCE_VALUES,
    ]);
    for (const o of PREFERENCE_OPTIONS) {
      expect(o.code).toBe(o.value);
      expect(o.short).not.toBe("");
      expect(o.className).toMatch(/^bg-shift-/);
    }
    expect(preferenceOption("ME").label).toContain("صبح + عصر");
  });

  it("never words a preference as an assignment", () => {
    const text = JSON.stringify([PREFERENCE_OPTIONS, LOCK_REASONS]);
    expect(text).not.toMatch(/تأیید|قطعی|تخصیص|منصوب/);
  });
});

describe("groupIntoWeeks (Jalali via the Phase 4 adapter)", () => {
  const weeks = groupIntoWeeks(aban, isoDate("2026-10-24"));

  it("starts weeks on Saturday", () => {
    // 1 Aban 1405 is a Friday: a one-day first week, then Saturday-first weeks.
    expect(weeks.map((w) => w.days.length)).toEqual([1, 7, 7, 7, 7, 1]);
    expect(weeks.slice(1).every((w) => w.days[0]!.weekday === "شنبه")).toBe(
      true,
    );
    expect(weeks.flatMap((w) => w.days)).toHaveLength(30);
  });

  it("labels days and weeks with the existing Jalali formatter", () => {
    const first = weeks[1]!.days[0]!;
    expect(first).toMatchObject({
      weekday: "شنبه",
      dayNumber: "۲",
      monthName: "آبان",
      fullLabel: formatJalaliDate(isoDate("2026-10-24"), { weekday: true }),
      isToday: true,
    });
    expect(first.fullLabel).toBe("شنبه ۲ آبان ۱۴۰۵");
    expect(weeks[1]!.label).toBe(
      formatJalaliRange(isoDate("2026-10-24"), isoDate("2026-10-30")),
    );
    expect(weeks[0]!.days[0]!.isToday).toBe(false);
    expect(weeks[0]!.label).toBe("۱ آبان ۱۴۰۵");
  });
});

describe("messages", () => {
  it("explains a fully locked schedule once, preferring the most common reason", () => {
    expect(scheduleLockMessage([null, "WINDOW_CLOSED"])).toBeNull();
    expect(scheduleLockMessage([])).toBeNull();
    expect(scheduleLockMessage(["WINDOW_CLOSED", "WINDOW_CLOSED"])).toContain(
      "بسته شده",
    );
    expect(
      scheduleLockMessage(["NOT_MEMBER", "NOT_MEMBER", "DATE_NOT_IN_WINDOW"]),
    ).toBe(LOCK_REASONS.NOT_MEMBER);
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
