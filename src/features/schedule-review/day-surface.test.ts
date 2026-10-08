import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { DayReview, ReviewCoverage } from "@/application/schedules/review";
import { summarizePreferenceAlignment } from "@/domain/preferences/preference-alignment";
import { isoDate } from "@/domain/shared/dates";

import { CoverageSummary } from "./day-detail";
import {
  PreferenceAlignmentSummary,
  PreferenceContext,
} from "./preference-alignment";
import { SHIFT_LABELS } from "../../../tests/support/shift-labels";

/** Visible text of server-rendered markup (tags dropped, spaces collapsed). */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const render = (element: Parameters<typeof renderToStaticMarkup>[0]) =>
  renderToStaticMarkup(element);

const nurse = (userId: string) => ({
  userId,
  displayName: userId,
  role: "NURSE" as const,
  preference: null,
});

type CoverageInput = Omit<ReviewCoverage, "gap" | "source"> &
  Partial<Pick<ReviewCoverage, "source">>;

const day = (input: CoverageInput[]): DayReview => ({
  date: isoDate("2026-10-24"),
  validation: {
    date: isoDate("2026-10-24"),
    decisions: 3,
    undecided: 0,
    shortages: 0,
    overstaffing: 0,
    ruleViolations: 0,
    state: "READY",
    ready: true,
    shifts: { M: 1, E: 2, N: 0, ME: 0 },
    coverage: { M: 1, E: 2, N: 0 },
    buckets: [],
    holiday: null,
  },
  holiday: null,
  shifts: [
    { code: "M", nurses: [nurse("a")] },
    { code: "E", nurses: [nurse("b"), nurse("c")] },
    { code: "N", nurses: [] },
    { code: "ME", nurses: [] },
  ],
  coverage: input.map((c) => ({
    ...c,
    source: c.source ?? "NORMAL",
    gap:
      c.status === "BELOW_MINIMUM"
        ? c.bounds!.min! - c.covered
        : c.status === "ABOVE_MAXIMUM"
          ? c.covered - c.bounds!.max!
          : 0,
  })),
  findings: [],
  relatedFindings: [],
  off: [],
  unassigned: [],
  roster: [],
  edit: { allowed: true },
});

describe("CoverageSummary", () => {
  it("states once that staffing was not evaluated when no bounds are configured", () => {
    const html = render(
      createElement(CoverageSummary, {
        shiftLabels: SHIFT_LABELS,
        day: day([
          { period: "M", covered: 1, bounds: null, status: "NOT_CONFIGURED" },
          { period: "E", covered: 2, bounds: null, status: "NOT_CONFIGURED" },
          { period: "N", covered: 0, bounds: null, status: "NOT_CONFIGURED" },
        ]),
      }),
    );
    expect(text(html).match(/ارزیابی نشده است/g)).toHaveLength(1);
    expect(text(html)).not.toMatch(/در محدوده|کمبود|مازاد|حداقل \d/);
    // No green "valid" or "success" tone may suggest adequate staffing.
    expect(html).not.toMatch(/health-valid|status-success/);
  });

  it("shows current staffing, the pinned minimum / maximum and shortage / excess", () => {
    const html = render(
      createElement(CoverageSummary, {
        shiftLabels: SHIFT_LABELS,
        day: day([
          {
            period: "M",
            covered: 1,
            bounds: { min: 3, max: 5 },
            status: "BELOW_MINIMUM",
          },
          {
            period: "E",
            covered: 2,
            bounds: { max: 1 },
            status: "ABOVE_MAXIMUM",
          },
          { period: "N", covered: 0, bounds: null, status: "NOT_CONFIGURED" },
        ]),
      }),
    );
    const t = text(html);
    expect(t).toContain("حداقل ۳ · حداکثر ۵");
    expect(t).toContain("کمبود ۲ نفر");
    expect(t).toContain("حداقل تعریف نشده · حداکثر ۱");
    expect(t).toContain("مازاد ۱ نفر");
    // The unconfigured period says so; the day-level note is not shown.
    expect(html).toMatch(/data-period="N" data-staffing="NOT_EVALUATED"/);
    expect(t).not.toContain("تأمین نفرات ارزیابی نشده است");
    expect(html).not.toMatch(/health-valid|status-success/);
  });

  it("keeps a period within bounds neutral (no green, no check)", () => {
    const html = render(
      createElement(CoverageSummary, {
        shiftLabels: SHIFT_LABELS,
        day: day([
          {
            period: "M",
            covered: 1,
            bounds: { min: 1, max: 2 },
            status: "WITHIN_BOUNDS",
          },
          {
            period: "E",
            covered: 2,
            bounds: { min: 1, max: 2 },
            status: "WITHIN_BOUNDS",
          },
          {
            period: "N",
            covered: 0,
            bounds: { min: 0 },
            status: "WITHIN_BOUNDS",
          },
        ]),
      }),
    );
    expect(text(html).match(/در محدوده قوانین/g)).toHaveLength(3);
    expect(html).not.toMatch(/health-valid|status-success|lucide-check/);
  });
});

describe("CoverageSummary: pilot 3–6 and the source of the bounds (D106)", () => {
  it.each([
    [2, "BELOW_MINIMUM", "کمبود ۱ نفر"],
    [3, "WITHIN_BOUNDS", "در محدوده قوانین"],
    [6, "WITHIN_BOUNDS", "در محدوده قوانین"],
    [7, "ABOVE_MAXIMUM", "مازاد ۱ نفر"],
  ] as const)("%i nurses: %s", (covered, status, words) => {
    const t = text(
      render(
        createElement(CoverageSummary, {
          shiftLabels: SHIFT_LABELS,
          day: day(
            (["M", "E", "N"] as const).map((period) => ({
              period,
              covered,
              bounds: { min: 3, max: 6 },
              status,
            })),
          ),
        }),
      ),
    );
    expect(t.match(new RegExp(words, "g"))).toHaveLength(3);
    expect(t).toContain("حداقل ۳ · حداکثر ۶");
  });

  it("says when a holiday rule or a date exception supplied the bounds", () => {
    const t = text(
      render(
        createElement(CoverageSummary, {
          shiftLabels: SHIFT_LABELS,
          day: day([
            {
              period: "M",
              covered: 3,
              bounds: { min: 3 },
              status: "WITHIN_BOUNDS",
              source: "EXCEPTION",
            },
            {
              period: "E",
              covered: 3,
              bounds: { min: 3 },
              status: "WITHIN_BOUNDS",
              source: "HOLIDAY",
            },
            {
              period: "N",
              covered: 3,
              bounds: { min: 3 },
              status: "WITHIN_BOUNDS",
            },
          ]),
        }),
      ),
    );
    expect(t).toContain("استثنای این تاریخ");
    expect(t).toContain("قانون روز تعطیل");
    expect(t).toContain("بدون حداکثر");
  });
});

describe("PreferenceContext", () => {
  const ctx = (
    preference: Parameters<typeof PreferenceContext>[0]["preference"],
    shift: Parameters<typeof PreferenceContext>[0]["shift"],
    hideMissing?: boolean,
  ) =>
    render(
      createElement(PreferenceContext, {
        shiftLabels: SHIFT_LABELS,
        preference,
        shift,
        hideMissing,
      }),
    );

  it("tells an explicit rest wish apart from no preference", () => {
    // OFF without an assignment decision is awaiting, never a match (D99).
    const off = ctx("OFF", null);
    expect(text(off)).toBe("ترجیح: استراحت در انتظار تخصیص");
    expect(off).not.toContain("lucide-circle-check");
    expect(off).toContain('data-preference="OFF"');
    expect(off).toContain("lucide-bed");

    const none = ctx(null, null);
    expect(text(none)).toBe("ترجیحی ثبت نشده");
    expect(none).toContain('data-preference="NONE"');
    expect(none).toContain("border-dashed");
  });

  it("marks matching, conflicting and pending assignments with icon and words", () => {
    expect(text(ctx("N", "N"))).toBe("ترجیح: شب مطابق ترجیح");
    expect(ctx("N", "N")).toContain("lucide-circle-check");
    expect(text(ctx("N", "M"))).toBe("ترجیح: شب مغایر ترجیح");
    expect(ctx("N", "M")).toContain("lucide-equal-not");
    expect(text(ctx("OFF", "E"))).toBe("ترجیح: استراحت مغایر ترجیح");
    expect(text(ctx("E", null))).toBe("ترجیح: عصر در انتظار تخصیص");
    expect(ctx("E", null)).toContain("lucide-circle-dashed");
  });

  it("renders nothing for a missing preference when asked (read-only lists)", () => {
    expect(ctx(null, "M", true)).toBe("");
    expect(text(ctx("M", "M", true))).toBe("ترجیح: صبح مطابق ترجیح");
  });
});

describe("PreferenceAlignmentSummary", () => {
  it("shows the four fit counts, the overlapping unassigned count apart, and the advisory note", () => {
    const alignment = summarizePreferenceAlignment([
      { preference: "M", shift: "M" },
      { preference: "OFF", shift: null },
      { preference: "N", shift: "E" },
      { preference: "E", shift: null },
      { preference: null, shift: null },
    ]);
    const html = render(
      createElement(PreferenceAlignmentSummary, { alignment }),
    );
    const t = text(html);
    expect(t).toContain("انطباق با ترجیحات");
    const count = (name: string) =>
      text(
        html.match(
          new RegExp(`data-alignment="${name}"[^>]*>(.*?)</(div|dl)>`),
        )![1]!,
      );
    // OFF without an assignment is pending, like E without one.
    expect(count("matches")).toBe("مطابق ترجیح ۱ نفر");
    expect(count("differs")).toBe("مغایر ترجیح ۱ نفر");
    expect(count("pending")).toBe("ترجیح ثبت‌شده، در انتظار تخصیص ۲ نفر");
    expect(count("noPreference")).toBe("ترجیحی ثبت نشده ۱ نفر");
    expect(t).toContain("هر نفر فقط در یکی از این چهار دسته است (جمع: ۵ نفر).");
    expect(count("unassigned")).toBe(
      "تعیین‌نشده در این روز: ۳ نفر جدا شمرده می‌شود و با دسته‌های بالا هم‌پوشانی دارد.",
    );
    expect(t).toContain("مغایرت با ترجیح جلوی نهایی‌سازی برنامه را نمی‌گیرد");
  });
});
