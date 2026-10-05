import { describe, expect, it } from "vitest";

import type { ReviewDay, ReviewFinding } from "@/application/schedules/review";
import { toDiagnostic } from "@/domain/rules/diagnostic";
import type { Violation } from "@/domain/rules/violation";
import { DAY_HEALTH_STATES } from "@/domain/schedule/day-health";
import { isoDate } from "@/domain/shared/dates";

import {
  ALIGNMENT_ADVISORY_NOTE,
  ALIGNMENT_LABELS,
  HEALTH_PRESENTATION,
  RULE_TITLES,
  STAFFING_NOT_EVALUATED,
  VALID_CAVEAT,
  alignmentPartitionNote,
  staffingBoundsLabel,
  staffingIndicator,
  staffingIndicatorLabel,
  dayCellLabel,
  findingFacts,
  findingMessage,
  findingResolution,
  findingSeverityLabel,
  initials,
  preferenceLabel,
  staffingStatusLabel,
} from "./presentation";

const period = { start: isoDate("2026-10-23"), end: isoDate("2026-11-21") };
const ISO_OR_CODE =
  /\d{4}-\d{2}-\d{2}|NIGHT_REST|DUPLICATE|OUTSIDE_PERIOD|STAFFING|BELOW_MINIMUM|ABOVE_MAXIMUM/;

const finding = (violation: Violation, name = "سارا نمونه"): ReviewFinding => {
  const diagnostic = toDiagnostic(violation, period);
  return {
    ...diagnostic,
    nurses: diagnostic.nurseIds.map((userId) => ({
      userId,
      displayName: name,
    })),
  };
};

const reviewDay = (overrides: Partial<ReviewDay> = {}): ReviewDay => ({
  date: isoDate("2026-10-25"),
  health: "VALID",
  shifts: { M: 1, E: 0, N: 0, ME: 0 },
  coverage: { M: 1, E: 0, N: 0 },
  findings: { blocking: 0, other: 0 },
  holiday: null,
  ...overrides,
});

describe("health presentation", () => {
  it("has a label, a description and a health tone for every state", () => {
    for (const state of DAY_HEALTH_STATES) {
      const p = HEALTH_PRESENTATION[state];
      expect(p.label).toMatch(/^[؀-ۿ]/);
      expect(p.description).toMatch(/^[؀-ۿ]/);
      // Semantic tokens, never a literal palette color.
      expect(p.cellClass).not.toMatch(
        /(red|green|amber|emerald|yellow|blue|orange)-\d/,
      );
    }
    expect(HEALTH_PRESENTATION.VALID.tone).toBe("valid");
    expect(HEALTH_PRESENTATION.NEEDS_ATTENTION.cellClass).toMatch(
      /health-attention/,
    );
  });

  it("keeps VALID quiet in the calendar: only attention is tinted (D53)", () => {
    expect(HEALTH_PRESENTATION.VALID.cellClass).toBe("");
    expect(HEALTH_PRESENTATION.UNPLANNED.cellClass).not.toMatch(/shadow|ring/);
    expect(HEALTH_PRESENTATION.NEEDS_ATTENTION.cellClass).toMatch(/shadow/);
  });

  it("words VALID as the result of a check, not a quality of the day (D51)", () => {
    const valid = HEALTH_PRESENTATION.VALID;
    expect(valid.label).toBe("بدون مغایرت");
    // Nothing implying a fully staffed, complete, approved, flawless or ready day.
    for (const text of [valid.label, valid.description, VALID_CAVEAT]) {
      expect(text).not.toMatch(
        /کامل|تکمیل|تأیید|تایید|آماده|نهایی|مناسب|تأمین‌شده|پر شده|ایراد|درست|صحیح/,
      );
    }
    expect(valid.description).toMatch(/^مغایرتی یافت نشد/);
    expect(valid.description).toContain("قوانین پیاده‌سازی‌شده فعلی");
    expect(valid.description).toContain(
      "تصمیم‌های روز و حداقل پوشش نفرات نیز بررسی می‌شود",
    );
    expect(VALID_CAVEAT).toContain(
      "تصمیم‌های روز و حداقل پوشش نفرات نیز بررسی می‌شود",
    );
  });

  it("never words a day without findings as needing attention", () => {
    for (const state of ["VALID", "UNPLANNED"] as const)
      expect(HEALTH_PRESENTATION[state].description).not.toContain(
        "نیاز به بررسی",
      );
  });

  it("names a day cell with its date, health, findings and holiday", () => {
    expect(dayCellLabel(reviewDay())).toBe("یکشنبه ۳ آبان ۱۴۰۵، بدون مغایرت");
    expect(
      dayCellLabel(
        reviewDay({
          health: "NEEDS_ATTENTION",
          findings: { blocking: 1, other: 1 },
          holiday: { date: isoDate("2026-10-25"), name: "تعطیل نمونه" },
        }),
      ),
    ).toBe(
      "یکشنبه ۳ آبان ۱۴۰۵، نیاز به بررسی (۲ مورد)، تعطیل رسمی: تعطیل نمونه",
    );
  });
});

describe("finding messages", () => {
  it("explains a night-rest violation in plain Persian", () => {
    const f = finding({
      rule: "NIGHT_REST",
      severity: "error",
      nurseId: "u1",
      nightDate: isoDate("2026-10-24"),
      date: isoDate("2026-10-25"),
      shift: "M",
    });
    expect(findingMessage(f)).toBe(
      "«سارا نمونه» در شنبه ۲ آبان ۱۴۰۵ شیفت شب دارد و روز بعد (یکشنبه ۳ آبان ۱۴۰۵) شیفت صبح برایش ثبت شده است؛ پس از شیفت شب، روز بعد باید استراحت باشد.",
    );
    expect(findingSeverityLabel(f)).toBe("مانع نهایی‌سازی");
  });

  it.each([
    ["DUPLICATE_ASSIGNMENT", "بیش از یک شیفت"],
    ["OUTSIDE_PERIOD", "خارج از دوره"],
  ] as const)("explains %s without codes or ISO dates", (rule, text) => {
    const f = finding({
      rule,
      severity: "error",
      nurseId: "u1",
      date: isoDate("2026-10-25"),
    });
    expect(findingMessage(f)).toContain(text);
    expect(findingMessage(f)).toContain("«سارا نمونه»");
    expect(findingMessage(f)).not.toMatch(ISO_OR_CODE);
    expect(RULE_TITLES[rule]).toMatch(/^[؀-ۿ]/);
  });

  it("splits a night-rest finding into the night and the next day's shift", () => {
    const f = finding({
      rule: "NIGHT_REST",
      severity: "error",
      nurseId: "u1",
      nightDate: isoDate("2026-10-24"),
      date: isoDate("2026-10-25"),
      shift: "ME",
    });
    expect(findingFacts(f)).toEqual([
      {
        role: "شب",
        date: "2026-10-24",
        dateLabel: "شنبه ۲ آبان ۱۴۰۵",
        shift: "N",
      },
      {
        role: "روز بعد",
        date: "2026-10-25",
        dateLabel: "یکشنبه ۳ آبان ۱۴۰۵",
        shift: "ME",
      },
    ]);
    expect(findingResolution(f)).toBe(
      "برای رفع: شیفت طولانی روز بعد را بردارید یا شیفت شب روز قبل را تغییر دهید.",
    );
  });

  it.each(["DUPLICATE_ASSIGNMENT", "OUTSIDE_PERIOD"] as const)(
    "gives %s one fact and a resolution, without codes or ISO dates",
    (rule) => {
      const f = finding({
        rule,
        severity: "error",
        nurseId: "u1",
        date: isoDate("2026-10-25"),
      });
      expect(findingFacts(f)).toHaveLength(1);
      expect(findingFacts(f)[0]!.dateLabel).toBe("یکشنبه ۳ آبان ۱۴۰۵");
      expect(findingResolution(f)).toMatch(/^برای رفع: /);
      expect(findingResolution(f)).not.toMatch(ISO_OR_CODE);
    },
  );

  it("labels non-blocking findings as warnings", () => {
    const f = {
      ...finding({
        rule: "OUTSIDE_PERIOD",
        severity: "error",
        nurseId: "u1",
        date: isoDate("2026-10-25"),
      }),
      blocking: false,
    };
    expect(findingSeverityLabel(f)).toBe("هشدار");
  });
});

describe("staffing findings (warnings)", () => {
  it.each([
    ["BELOW_MINIMUM", 1, { min: 3 }, "کمتر از حداقل (۳ نفر)", "افزایش"],
    ["ABOVE_MAXIMUM", 6, { max: 4 }, "بیشتر از حداکثر (۴ نفر)", "کاهش"],
  ] as const)(
    "words %s per coverage period, without names, codes or ISO dates",
    (status, covered, bounds, words, fix) => {
      const f = finding({
        rule: "STAFFING",
        severity: "warning",
        date: isoDate("2026-10-25"),
        period: "E",
        covered,
        status,
        bounds,
      });
      expect(f.nurses).toEqual([]);
      expect(f.scope).toBe("SHIFT");
      expect(findingMessage(f)).toContain("نوبت عصر");
      expect(findingMessage(f)).toContain(words);
      expect(findingMessage(f)).not.toMatch(ISO_OR_CODE);
      expect(findingSeverityLabel(f)).toBe("هشدار");
      expect(findingFacts(f)).toEqual([
        {
          role: "نوبت",
          date: "2026-10-25",
          dateLabel: "یکشنبه ۳ آبان ۱۴۰۵",
          shift: "E",
        },
      ]);
      expect(findingResolution(f)).toContain(fix);
      expect(findingResolution(f)).not.toMatch(ISO_OR_CODE);
      expect(RULE_TITLES.STAFFING).toBe("تأمین نفرات");
    },
  );
});

describe("staffing, preferences and avatars", () => {
  it.each([
    ["NOT_CONFIGURED", null, "حداقل و حداکثر نفرات تعریف نشده است"],
    ["BELOW_MINIMUM", { min: 4 }, "کمتر از حداقل (۴ نفر)"],
    ["ABOVE_MAXIMUM", { max: 6 }, "بیشتر از حداکثر (۶ نفر)"],
    ["WITHIN_BOUNDS", { min: 1 }, "در محدوده تعریف‌شده"],
  ] as const)("staffing %s reads %j", (status, bounds, text) => {
    expect(staffingStatusLabel(status, bounds)).toBe(text);
  });

  it("words preferences as wishes", () => {
    expect(preferenceLabel("N")).toBe("ترجیح: شب");
    expect(preferenceLabel("ME")).toBe("ترجیح: طولانی");
    expect(preferenceLabel("OFF")).toBe("ترجیح: استراحت");
  });

  it("builds initials for the avatar fallback", () => {
    expect(initials("سارا نمونه")).toBe("س‌ن");
    expect(initials("  مریم  ")).toBe("م");
  });
});

describe("staffing coverage presentation (reads staffingStatus, D44)", () => {
  it.each([
    [{ covered: 2, bounds: null, status: "NOT_CONFIGURED" }, "ارزیابی نشده"],
    [
      { covered: 1, bounds: { min: 3, max: 5 }, status: "BELOW_MINIMUM" },
      "کمبود ۲ نفر",
    ],
    [
      { covered: 7, bounds: { min: 3, max: 5 }, status: "ABOVE_MAXIMUM" },
      "مازاد ۲ نفر",
    ],
    [
      { covered: 4, bounds: { min: 3, max: 5 }, status: "WITHIN_BOUNDS" },
      "در محدوده تعریف‌شده",
    ],
  ] as const)("%o → %s", (coverage, text) => {
    expect(staffingIndicatorLabel(staffingIndicator(coverage))).toBe(text);
  });

  it("shows configured bounds and says when one is not set, never inventing a number", () => {
    expect(staffingBoundsLabel({ min: 3, max: 5 })).toBe("حداقل ۳ · حداکثر ۵");
    expect(staffingBoundsLabel({ min: 2 })).toBe("حداقل ۲ · حداکثر تعریف نشده");
    expect(staffingBoundsLabel({ max: 4 })).toBe("حداقل تعریف نشده · حداکثر ۴");
    expect(staffingBoundsLabel(null)).toBe(
      "حداقل تعریف نشده · حداکثر تعریف نشده",
    );
  });

  it("states that staffing was not evaluated, and nothing implies adequacy", () => {
    expect(STAFFING_NOT_EVALUATED).toContain("ارزیابی نشده");
    expect(STAFFING_NOT_EVALUATED).toContain(
      "حداقل و حداکثر نفرات تعریف نشده است",
    );
    for (const text of [
      STAFFING_NOT_EVALUATED,
      staffingIndicatorLabel({ kind: "WITHIN" }),
    ])
      expect(text).not.toMatch(/کافی|کامل|تأیید|مناسب|درست|صحیح/);
  });
});

describe("preference alignment wording", () => {
  it("uses the approved labels", () => {
    expect(ALIGNMENT_LABELS).toEqual({
      title: "انطباق با ترجیحات",
      matches: "مطابق ترجیح",
      differs: "مغایر ترجیح",
      pending: "ترجیح ثبت‌شده، در انتظار تخصیص",
      noPreference: "ترجیحی ثبت نشده",
      unassigned: "تعیین‌نشده در این روز",
    });
  });

  it("says the fit counts partition the roster, and that preferences are advisory", () => {
    expect(alignmentPartitionNote(12)).toBe(
      "هر نفر فقط در یکی از این چهار دسته است (جمع: ۱۲ نفر).",
    );
    expect(ALIGNMENT_ADVISORY_NOTE).toContain("الزامی نیستند");
    expect(ALIGNMENT_ADVISORY_NOTE).toContain(
      "جلوی نهایی‌سازی برنامه را نمی‌گیرد",
    );
    // «مانع نهایی‌سازی» stays the label of a blocking finding only.
    expect(ALIGNMENT_ADVISORY_NOTE).not.toContain(
      findingSeverityLabel({ blocking: true } as ReviewFinding),
    );
  });
});
