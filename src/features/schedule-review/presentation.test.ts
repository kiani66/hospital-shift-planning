import { describe, expect, it } from "vitest";

import type { ReviewDay, ReviewFinding } from "@/application/schedules/review";
import { toDiagnostic } from "@/domain/rules/diagnostic";
import type { Violation } from "@/domain/rules/violation";
import { DAY_STATES } from "@/domain/rules/validation-summary";
import { isoDate } from "@/domain/shared/dates";

import {
  ALIGNMENT_ADVISORY_NOTE,
  ALIGNMENT_LABELS,
  CATEGORY_LABELS,
  DAY_FILTER_LABELS,
  DAY_FILTERS,
  DAY_STATE_PRESENTATION,
  RULE_TITLES,
  STAFFING_NOT_EVALUATED,
  dayCountsLabel,
  findingCategoryLabel,
  isDayFilter,
  matchesDayFilter,
  staffingRangeLabel,
  validationSummaryText,
  type MonthValidationCounts,
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
  decisions: 3,
  undecided: 0,
  shortages: 0,
  overstaffing: 0,
  ruleViolations: 0,
  state: "READY",
  ready: true,
  shifts: { M: 1, E: 0, N: 0, ME: 0 },
  coverage: { M: 1, E: 0, N: 0 },
  buckets: [],
  holiday: null,
  ...overrides,
});

const counts = (overrides: Partial<MonthValidationCounts> = {}) => ({
  undecided: 0,
  undecidedDays: 0,
  coverageProblems: 0,
  shortages: 0,
  overstaffing: 0,
  ruleViolations: 0,
  readyDays: 30,
  totalDays: 30,
  ready: true,
  ...overrides,
});

describe("day state presentation (D103)", () => {
  it("has a label, a description and a semantic tone for every state", () => {
    for (const state of DAY_STATES) {
      const p = DAY_STATE_PRESENTATION[state];
      expect(p.label).toMatch(/^[؀-ۿ]/);
      expect(p.description).toMatch(/^[؀-ۿ]/);
      // Semantic tokens, never a literal palette color.
      expect(p.cellClass).not.toMatch(
        /(red|green|amber|emerald|yellow|blue|orange)-\d/,
      );
    }
    expect(DAY_STATE_PRESENTATION.READY.tone).toBe("valid");
    expect(DAY_STATE_PRESENTATION.COVERAGE.cellClass).toMatch(
      /health-attention/,
    );
    expect(DAY_STATE_PRESENTATION.RULE_VIOLATION.tone).toBe("destructive");
  });

  it("keeps READY quiet and only problems tinted and outlined (D53)", () => {
    expect(DAY_STATE_PRESENTATION.READY.cellClass).toBe("");
    for (const state of ["NOT_STARTED", "UNDECIDED"] as const)
      expect(DAY_STATE_PRESENTATION[state].cellClass).not.toMatch(
        /shadow|ring/,
      );
    for (const state of ["COVERAGE", "RULE_VIOLATION"] as const)
      expect(DAY_STATE_PRESENTATION[state].cellClass).toMatch(/shadow/);
  });

  it("never calls an undecided day a conflict or violation (D102)", () => {
    for (const state of ["NOT_STARTED", "UNDECIDED"] as const) {
      const p = DAY_STATE_PRESENTATION[state];
      for (const text of [p.label, p.description])
        expect(text).not.toMatch(/مغایرت|نقض|تعارض/);
    }
    expect(CATEGORY_LABELS.undecided).toBe("تصمیم تعیین‌نشده");
  });

  it("words READY as ready for finalization, now that completeness and coverage are checked", () => {
    expect(DAY_STATE_PRESENTATION.READY.label).toBe("آماده");
    expect(DAY_STATE_PRESENTATION.READY.description).toContain(
      "آماده نهایی‌سازی",
    );
    expect(DAY_STATE_PRESENTATION.NOT_STARTED.label).toBe("شروع‌نشده");
  });

  it("names a day cell with its date, state, every category and holiday", () => {
    expect(dayCellLabel(reviewDay())).toBe("یکشنبه ۳ آبان ۱۴۰۵، آماده");
    expect(
      dayCellLabel(
        reviewDay({
          state: "RULE_VIOLATION",
          ready: false,
          undecided: 2,
          shortages: 1,
          overstaffing: 1,
          ruleViolations: 1,
          holiday: { date: isoDate("2026-10-25"), name: "تعطیل نمونه" },
        }),
      ),
    ).toBe(
      "یکشنبه ۳ آبان ۱۴۰۵، نقض قانون (۱ نقض قانون، ۱ کمبود نیرو، ۱ مازاد نیرو، ۲ تصمیم تعیین‌نشده)، تعطیل رسمی: تعطیل نمونه",
    );
  });

  it("lists only the non-zero categories", () => {
    expect(dayCountsLabel(reviewDay({ undecided: 4 }))).toBe(
      "۴ تصمیم تعیین‌نشده",
    );
    expect(dayCountsLabel(reviewDay())).toBe("");
  });
});

describe("monthly summary (D104)", () => {
  it("explains a blocked schedule per category, never as lumped conflicts", () => {
    const text = validationSummaryText(
      counts({
        ready: false,
        undecided: 486,
        undecidedDays: 22,
        coverageProblems: 24,
        shortages: 20,
        overstaffing: 4,
        ruleViolations: 7,
        readyDays: 8,
      }),
    );
    expect(text).toEqual({
      title: "برنامه هنوز آماده نهایی‌سازی نیست.",
      lines: [
        "۴۸۶ تصمیم تعیین‌نشده در ۲۲ روز",
        "۲۴ مشکل پوشش (۲۰ کمبود نیرو، ۴ مازاد نیرو)",
        "۷ نقض قانون",
        "۸ روز از ۳۰ روز آماده",
      ],
    });
    expect(text.lines.join(" ")).not.toMatch(/مغایرت/);
  });

  it("omits clean categories and names only shortages when there is no excess", () => {
    expect(
      validationSummaryText(
        counts({
          ready: false,
          coverageProblems: 2,
          shortages: 2,
          readyDays: 28,
        }),
      ).lines,
    ).toEqual(["۲ مشکل پوشش (۲ کمبود نیرو)", "۲۸ روز از ۳۰ روز آماده"]);
    expect(
      validationSummaryText(
        counts({ ready: false, coverageProblems: 1, overstaffing: 1 }),
      ).lines[0],
    ).toBe("۱ مشکل پوشش (۱ مازاد نیرو)");
  });

  it("confirms every category when the schedule is ready", () => {
    expect(validationSummaryText(counts())).toEqual({
      title: "برنامه آماده نهایی‌سازی است.",
      lines: [
        "همه ۳۰ روز آماده است",
        "تصمیم تعیین‌نشده‌ای نمانده است",
        "پوشش نفرات در محدوده قوانین است",
        "قانون مسدودکننده‌ای نقض نشده است",
      ],
    });
  });
});

describe("calendar filters (D104)", () => {
  it.each([
    ["undecided", { undecided: 1 }],
    ["coverage", { shortages: 1 }],
    ["coverage", { overstaffing: 1 }],
    ["shortage", { shortages: 1 }],
    ["overstaffing", { overstaffing: 1 }],
    ["violations", { ruleViolations: 1 }],
    ["ready", {}],
  ] as const)("%s marks a day with %o", (filter, day) => {
    const marked = reviewDay({ ...day, ready: Object.keys(day).length === 0 });
    expect(matchesDayFilter(filter, marked)).toBe(true);
    expect(matchesDayFilter(filter, reviewDay({ ready: false }))).toBe(false);
  });

  it("accepts only known filters and labels each one", () => {
    expect(isDayFilter("shortage")).toBe(true);
    expect(isDayFilter("conflicts")).toBe(false);
    expect(isDayFilter(undefined)).toBe(false);
    for (const f of DAY_FILTERS) expect(DAY_FILTER_LABELS[f]).toMatch(/^[؀-ۿ]/);
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

describe("coverage findings (D102: both bounds are hard rules)", () => {
  it.each([
    [
      "BELOW_MINIMUM",
      1,
      { min: 3 },
      "حداقل ۳ نفر لازم است (کمبود ۲ نفر)",
      "افزایش",
      "کمبود نیرو",
    ],
    [
      "ABOVE_MAXIMUM",
      6,
      { max: 4 },
      "حداکثر ۴ نفر مجاز است (مازاد ۲ نفر)",
      "کاهش",
      "مازاد نیرو",
    ],
  ] as const)(
    "words %s per coverage period, without names, codes or ISO dates",
    (status, covered, bounds, words, fix, category) => {
      const f = finding({
        rule: "STAFFING",
        severity: "error",
        date: isoDate("2026-10-25"),
        period: "E",
        covered,
        status,
        bounds,
      });
      expect(f.nurses).toEqual([]);
      expect(f.scope).toBe("SHIFT");
      expect(findingMessage(f)).toContain("پوشش عصر");
      expect(findingMessage(f)).toContain(words);
      expect(findingMessage(f)).not.toMatch(ISO_OR_CODE);
      expect(findingSeverityLabel(f)).toBe("مانع نهایی‌سازی");
      expect(findingCategoryLabel(f)).toBe(category);
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
      expect(RULE_TITLES.STAFFING).toBe("پوشش نفرات");
    },
  );
});

describe("staffing, preferences and avatars", () => {
  it.each([
    ["NOT_CONFIGURED", null, "حداقل و حداکثر نفرات تعریف نشده است"],
    ["BELOW_MINIMUM", { min: 4 }, "کمتر از حداقل (۴ نفر)"],
    ["ABOVE_MAXIMUM", { max: 6 }, "بیشتر از حداکثر (۶ نفر)"],
    ["WITHIN_BOUNDS", { min: 1 }, "در محدوده قوانین"],
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
      "در محدوده قوانین",
    ],
  ] as const)("%o → %s", (coverage, text) => {
    expect(staffingIndicatorLabel(staffingIndicator(coverage))).toBe(text);
  });

  it("shows the pinned bounds and says when there is no maximum, never inventing a number", () => {
    expect(staffingBoundsLabel({ min: 3, max: 6 })).toBe("حداقل ۳ · حداکثر ۶");
    expect(staffingBoundsLabel({ min: 1 })).toBe("حداقل ۱ · بدون حداکثر");
    expect(staffingBoundsLabel({ max: 4 })).toBe("حداقل تعریف نشده · حداکثر ۴");
    expect(staffingBoundsLabel(null)).toBe("حداقل تعریف نشده · بدون حداکثر");
    expect(staffingRangeLabel({ min: 3, max: 6 })).toBe("۳–۶");
    expect(staffingRangeLabel({ min: 1 })).toBe("۱+");
    expect(staffingRangeLabel(null)).toBe("—");
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
