import { describe, expect, it } from "vitest";

import { isoDate } from "@/domain/shared/dates";

import {
  applicationEntryText,
  historyEntryText,
  applyErrorMessage,
  applyRefusalText,
  boundsText,
  dayTypeSummary,
  effectiveFromText,
  parseContentForm,
  ruleSetErrorMessage,
  RULE_SET_STATE_LABELS,
  scopeLabel,
  versionLabel,
} from "./presentation";

const form = (entries: [string, string][]) => {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
};
const normal: [string, string][] = [
  ["normal.M.min", "۳"],
  ["normal.M.max", "6"],
  ["normal.E.min", "3"],
  ["normal.E.max", "6"],
  ["normal.N.min", "3"],
  ["normal.N.max", ""],
];

describe("rule-set wording", () => {
  it("names scopes, versions, states and bounds in Persian", () => {
    expect(scopeLabel(null)).toBe("پیش‌فرض بیمارستان");
    expect(scopeLabel("بخش NICU")).toBe("قوانین ویژه — بخش NICU");
    expect(versionLabel(3)).toBe("نسخه ۳");
    expect(RULE_SET_STATE_LABELS.EFFECTIVE).toBe("جاری");
    expect(boundsText({ min: 3, max: 6 })).toBe("۳ تا ۶ نفر");
    expect(boundsText({ min: 1, max: null })).toBe("دست‌کم ۱ نفر");
    expect(boundsText({ min: 2, max: 2 })).toBe("دقیقاً ۲ نفر");
    expect(
      dayTypeSummary({ M: { min: 3, max: 6 }, N: { min: 2, max: null } }),
    ).toBe("صبح ۳ تا ۶ نفر · شب دست‌کم ۲ نفر");
  });

  it("says when a version takes effect", () => {
    expect(
      effectiveFromText({ effectiveFrom: null, legacyBaseline: true }),
    ).toBe("از ابتدا (قانون پیشین سامانه)");
    expect(
      effectiveFromText({
        effectiveFrom: isoDate("2026-10-23"),
        legacyBaseline: false,
      }),
    ).toBe("از ۱ آبان ۱۴۰۵");
    expect(
      effectiveFromText({ effectiveFrom: null, legacyBaseline: false }),
    ).toBe("هنوز منتشر نشده");
  });
});

describe("parseContentForm", () => {
  it("reads Persian or Latin digits, an empty maximum and enabled holiday bounds", () => {
    const result = parseContentForm(
      form([
        ...normal,
        ["holiday.E.enabled", "on"],
        ["holiday.E.min", "2"],
        ["holiday.E.max", "4"],
        ["holiday.M.min", "9"], // not enabled: ignored
        ["exception.date", "۱۴۰۵/۰۸/۱۵"],
        ["exception.period", "N"],
        ["exception.min", "4"],
        ["exception.max", ""],
        ["exception.note", "  "],
      ]),
    );
    expect(result).toEqual({
      ok: true,
      value: {
        normal: {
          M: { min: 3, max: 6 },
          E: { min: 3, max: 6 },
          N: { min: 3, max: null },
        },
        holiday: { E: { min: 2, max: 4 } },
        exceptions: [
          {
            date: "2026-11-06",
            period: "N",
            bounds: { min: 4, max: null },
            note: null,
          },
        ],
      },
    });
  });

  it.each([
    [[["normal.M.min", ""]], "حداقل نفرات صبح"],
    [[["normal.M.min", "x"]], "حداقل نفرات صبح"],
    [
      [...normal, ["holiday.N.enabled", "on"], ["holiday.N.min", ""]],
      "روز تعطیل",
    ],
    [
      [
        ...normal,
        ["exception.date", "1405/13/01"],
        ["exception.period", "M"],
        ["exception.min", "1"],
      ],
      "تاریخ استثنای ردیف ۱",
    ],
    [
      [
        ...normal,
        ["exception.date", "1405/08/01"],
        ["exception.period", "X"],
        ["exception.min", "1"],
      ],
      "نوبت استثنا",
    ],
    [
      [
        ...normal,
        ["exception.date", "1405/08/01"],
        ["exception.period", "M"],
        ["exception.min", ""],
      ],
      "استثنای ردیف ۱",
    ],
  ] as [[string, string][], string][])(
    "explains an invalid entry %#",
    (entries, words) => {
      const result = parseContentForm(form(entries));
      expect(result.ok).toBe(false);
      expect(!result.ok && result.message).toContain(words);
    },
  );
});

describe("ruleSetErrorMessage", () => {
  it.each([
    [{ code: "CONFLICT", reason: "RULE_SET_PUBLISH_CONFLICT" }, "تداخل"],
    [{ code: "CONFLICT", reason: "RULE_SET_DRAFT_EXISTS" }, "پیش‌نویس باز"],
    [{ code: "CONFLICT" }, "هم‌زمان"],
    [{ code: "VALIDATION", reason: "EFFECTIVE_FROM_IN_PAST" }, "پیش از امروز"],
    [{ code: "VALIDATION" }, "۰ تا ۹۹"],
    [
      { code: "INVALID_STATE", reason: "RETIRE_EFFECTIVE_HOSPITAL_DEFAULT" },
      "نسخه تازه‌ای منتشر کنید",
    ],
    [{ code: "INVALID_STATE" }, "قابل تغییر نیست"],
    [{ code: "FORBIDDEN" }, "فقط مدیر بیمارستان"],
    [{ code: "NOT_FOUND" }, "پیدا نشد"],
    [{ code: "INTERNAL" }, "غیرمنتظره"],
  ] as const)("%o", (error, words) => {
    expect(ruleSetErrorMessage({ message: "x", ...error })).toContain(words);
  });
});

describe("Apply wording (D107, D109)", () => {
  it.each([
    ["APPLY_RULE_SET_WHILE_SUBMITTED", "پس گرفتن ارسال"],
    ["APPLY_RULE_SET_REQUIRES_REVISION", "شروع بازنگری"],
    ["RULE_SET_ALREADY_PINNED", "همین نسخه"],
    ["SOMETHING_ELSE", "ممکن نیست"],
  ])("explains %s", (reason, words) => {
    expect(applyRefusalText(reason)).toContain(words);
  });

  it.each([
    [{ code: "CONFLICT", reason: "RULE_SET_PIN_CHANGED" }, "قوانین این برنامه"],
    [{ code: "CONFLICT" }, "پیش‌نمایش تازه"],
    [
      { code: "INVALID_STATE", reason: "APPLY_RULE_SET_REQUIRES_REVISION" },
      "شروع بازنگری",
    ],
    [{ code: "VALIDATION" }, "تأیید صریح"],
    [{ code: "FORBIDDEN" }, "سوپروایزر این بخش یا مدیر بیمارستان"],
    [{ code: "NOT_FOUND" }, "پیدا نشد"],
    [{ code: "INTERNAL" }, "غیرمنتظره"],
  ] as const)("words a refused Apply %o", (error, words) => {
    expect(applyErrorMessage({ message: "x", ...error })).toContain(words);
  });
});

describe("history wording (D110)", () => {
  const entry = {
    at: new Date(),
    actorId: "a",
    versionId: "v",
    versionNo: 2,
    departmentId: null,
    effectiveFrom: null,
    retiredReason: null,
    replacedByVersionNo: null,
    note: null,
  };
  it.each([
    [{ kind: "DRAFT_CREATED" }, "پیش‌نویس نسخه ۲ پیش‌فرض بیمارستان ساخته شد."],
    [{ kind: "DRAFT_UPDATED" }, "پیش‌نویس نسخه ۲ پیش‌فرض بیمارستان ویرایش شد."],
    [{ kind: "DRAFT_DISCARDED" }, "پیش‌نویس نسخه ۲ پیش‌فرض بیمارستان حذف شد."],
    [
      { kind: "PUBLISHED", effectiveFrom: isoDate("2026-10-23") },
      "نسخه ۲ پیش‌فرض بیمارستان منتشر شد؛ اجرا از ۱ آبان ۱۴۰۵.",
    ],
    [{ kind: "PUBLISHED" }, "نسخه ۲ پیش‌فرض بیمارستان منتشر شد."],
    [
      { kind: "RETIRED", retiredReason: "REPLACED", replacedByVersionNo: 3 },
      "نسخه ۲ پیش‌فرض بیمارستان با انتشار نسخه ۳ جایگزین و بازنشسته شد.",
    ],
    [
      { kind: "RETIRED", retiredReason: "REPLACED" },
      "نسخه ۲ پیش‌فرض بیمارستان با انتشار نسخه دیگر جایگزین و بازنشسته شد.",
    ],
    [
      { kind: "RETIRED", retiredReason: "WITHDRAWN", note: "پایان آزمایش" },
      "نسخه ۲ پیش‌فرض بیمارستان کنار گذاشته شد (پایان آزمایش).",
    ],
    [
      { kind: "RETIRED", retiredReason: "WITHDRAWN" },
      "نسخه ۲ پیش‌فرض بیمارستان کنار گذاشته شد.",
    ],
  ] as const)("%o", (overrides, text) => {
    expect(
      historyEntryText({ ...entry, ...overrides }, "پیش‌فرض بیمارستان"),
    ).toBe(text);
  });

  it("words an Apply with its impact, the zero shift changes and the revision", () => {
    const counts = (coverageProblems: number, readyDays: number) => ({
      undecided: 0,
      undecidedDays: 0,
      coverageProblems,
      shortages: coverageProblems,
      overstaffing: 0,
      shortBy: 0,
      excessBy: 0,
      ruleViolations: 0,
      readyDays,
      totalDays: 30,
    });
    const base = {
      id: "x",
      at: new Date(),
      actorId: "a",
      scheduleId: "s",
      fromVersionId: "f",
      toVersionId: "t",
      rollback: false,
      revisionId: null,
      before: counts(2, 28),
      after: counts(7, 23),
      addedRevisionDates: [],
    };
    const names = { scheduleLabel: "آبان ۱۴۰۵", from: "نسخه ۳", to: "نسخه ۴" };
    expect(applicationEntryText(base, names)).toBe(
      "قوانین «آبان ۱۴۰۵» از نسخه ۳ به نسخه ۴ تغییر کرد. مشکلات پوشش: ۲ ← ۷؛ روزهای آماده: ۲۸ ← ۲۳. شیفت‌های تغییرکرده: ۰.",
    );
    expect(
      applicationEntryText(
        {
          ...base,
          rollback: true,
          revisionId: "r",
          addedRevisionDates: [isoDate("2026-11-01")],
        },
        names,
      ),
    ).toContain("(بازگشت به نسخه پیشین)");
    expect(
      applicationEntryText(
        { ...base, revisionId: "r", before: null, after: null },
        names,
      ),
    ).toBe(
      "قوانین «آبان ۱۴۰۵» از نسخه ۳ به نسخه ۴ تغییر کرد. شیفت‌های تغییرکرده: ۰. در بازنگری.",
    );
  });
});
