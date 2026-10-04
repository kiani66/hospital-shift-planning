import { describe, expect, it } from "vitest";

import type { MyShiftEntry } from "@/application/my-shifts/queries";
import type { ShiftPublication } from "@/domain/schedule/publication";
import { isoDate } from "@/domain/shared/dates";
import { SHIFT_CODES } from "@/domain/shifts/shift-type";

import {
  CHANGE_PENDING,
  PUBLICATION_PRESENTATION,
  dayCellLabel,
  formatHours,
  myShiftsHref,
  shiftDurationLabel,
} from "./presentation";

const STATES: readonly ShiftPublication[] = [
  "NOT_PUBLISHED",
  "TEMPORARY",
  "AWAITING_APPROVAL",
  "OFFICIAL",
];

const entry = (overrides: Partial<MyShiftEntry> = {}): MyShiftEntry => ({
  scheduleId: "s",
  shift: "N",
  publication: "TEMPORARY",
  changePending: false,
  requestable: false,
  ...overrides,
});

describe("publication presentation", () => {
  it("gives every state its own icon, tone and Persian wording", () => {
    const icons = new Set(STATES.map((s) => PUBLICATION_PRESENTATION[s].icon));
    const tones = new Set(STATES.map((s) => PUBLICATION_PRESENTATION[s].tone));
    expect(icons.size).toBe(STATES.length);
    expect(tones.size).toBe(STATES.length);
    for (const s of STATES) {
      const p = PUBLICATION_PRESENTATION[s];
      for (const text of [p.label, p.headline, p.description])
        expect(text).toMatch(/^[؀-ۿ]/);
    }
  });

  it("is green and settled only when approved", () => {
    expect(PUBLICATION_PRESENTATION.OFFICIAL.tone).toBe("success");
    expect(PUBLICATION_PRESENTATION.OFFICIAL.unapproved).toBe(false);
    for (const s of STATES.filter((s) => s !== "OFFICIAL")) {
      expect(PUBLICATION_PRESENTATION[s].tone).not.toBe("success");
      expect(PUBLICATION_PRESENTATION[s].unapproved).toBe(true);
    }
  });

  it("warns in words that unapproved shifts may change", () => {
    for (const s of ["TEMPORARY", "AWAITING_APPROVAL"] as const) {
      const p = PUBLICATION_PRESENTATION[s];
      expect(`${p.headline} ${p.description}`).toMatch(/تغییر/);
      expect(p.headline).not.toMatch(/رسمی و تأییدشده/);
    }
    expect(PUBLICATION_PRESENTATION.TEMPORARY.headline).toMatch(/موقت/);
  });
});

describe("formatHours", () => {
  it.each([
    [0, "۰ ساعت"],
    [420, "۷ ساعت"],
    [450, "۷ ساعت و ۳۰ دقیقه"],
    [180 * 60, "۱۸۰ ساعت"],
  ])("%i minutes → %s", (minutes, text) => {
    expect(formatHours(minutes)).toBe(text);
  });

  it("labels every catalog shift with its duration", () => {
    expect(SHIFT_CODES.map(shiftDurationLabel)).toEqual([
      "۷ ساعت",
      "۵ ساعت",
      "۱۲ ساعت",
      "۱۲ ساعت",
    ]);
  });
});

describe("dayCellLabel", () => {
  const date = isoDate("2026-10-26"); // دوشنبه ۴ آبان ۱۴۰۵

  it("names the date, the shift with its code and how settled it is", () => {
    expect(
      dayCellLabel({ date, entries: [entry()], changePending: false }),
    ).toBe("دوشنبه ۴ آبان ۱۴۰۵: شب (N)، موقت");
  });

  it("says when there is no shift, and marks the selected day", () => {
    expect(
      dayCellLabel(
        { date, entries: [], changePending: false },
        { selected: true },
      ),
    ).toBe("دوشنبه ۴ آبان ۱۴۰۵: بدون شیفت (روز انتخاب‌شده)");
  });

  it("flags a pending revision change in words", () => {
    expect(
      dayCellLabel({
        date,
        entries: [entry({ publication: "OFFICIAL", changePending: true })],
        changePending: false,
      }),
    ).toBe(
      `دوشنبه ۴ آبان ۱۴۰۵: شب (N)، تأییدشده (رسمی)، ${CHANGE_PENDING.label}`,
    );
    expect(dayCellLabel({ date, entries: [], changePending: true })).toBe(
      `دوشنبه ۴ آبان ۱۴۰۵: بدون شیفت؛ ${CHANGE_PENDING.label}`,
    );
  });

  it("lists one entry per schedule when two departments overlap", () => {
    expect(
      dayCellLabel({
        date,
        entries: [entry({ shift: "M" }), entry({ publication: "OFFICIAL" })],
        changePending: false,
      }),
    ).toBe("دوشنبه ۴ آبان ۱۴۰۵: صبح (M)، موقت؛ شب (N)، تأییدشده (رسمی)");
  });
});

describe("myShiftsHref", () => {
  it("keeps the month and adds the day when given", () => {
    expect(myShiftsHref("1405-08")).toBe("/my-shifts?month=1405-08");
    expect(myShiftsHref("1405-08", isoDate("2026-10-26"))).toBe(
      "/my-shifts?month=1405-08&day=2026-10-26",
    );
  });
});
