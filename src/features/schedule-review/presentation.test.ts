import { describe, expect, it } from "vitest";

import type { ReviewDay, ReviewFinding } from "@/application/schedules/review";
import { toDiagnostic } from "@/domain/rules/diagnostic";
import type { Violation } from "@/domain/rules/violation";
import { DAY_HEALTH_STATES } from "@/domain/schedule/day-health";
import { isoDate } from "@/domain/shared/dates";

import {
  HEALTH_PRESENTATION,
  RULE_TITLES,
  dayCellLabel,
  findingMessage,
  findingSeverityLabel,
  initials,
  preferenceLabel,
  staffingStatusLabel,
} from "./presentation";

const period = { start: isoDate("2026-10-23"), end: isoDate("2026-11-21") };
const ISO_OR_CODE = /\d{4}-\d{2}-\d{2}|NIGHT_REST|DUPLICATE|OUTSIDE_PERIOD/;

const finding = (violation: Violation, name = "سارا نمونه"): ReviewFinding => ({
  ...toDiagnostic(violation, period),
  nurses: [{ userId: violation.nurseId, displayName: name }],
});

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
  it("has a label, a description and health-* tokens for every state", () => {
    for (const state of DAY_HEALTH_STATES) {
      const p = HEALTH_PRESENTATION[state];
      expect(p.label).toMatch(/^[؀-ۿ]/);
      expect(p.description).toMatch(/^[؀-ۿ]/);
      // Semantic tokens, never a literal palette color.
      expect(`${p.badgeClass} ${p.cellClass}`).toMatch(/health-/);
      expect(`${p.badgeClass} ${p.cellClass}`).not.toMatch(
        /(red|green|amber|emerald|yellow|blue|orange)-\d/,
      );
    }
  });

  it("names a day cell with its date, health, findings and holiday", () => {
    expect(dayCellLabel(reviewDay())).toBe("یکشنبه ۳ آبان ۱۴۰۵، بدون ایراد");
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
