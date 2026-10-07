import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CoverageCandidates } from "@/application/schedules/coverage-candidates";
import type { DayReview } from "@/application/schedules/review";
import { isoDate } from "@/domain/shared/dates";
import { toDiagnostic } from "@/domain/rules/diagnostic";
import { CandidateList } from "./candidate-list";
import { ShortageCandidates } from "./shortage-candidates";
import { candidateDayLabel, candidatePreferenceLabel } from "./presentation";

vi.mock("./actions", () => ({ readCoverageCandidatesAction: vi.fn() }));
const date = isoDate("2026-10-25");
const id = "00000000-0000-4000-8000-000000000001";
const base = {
  scheduleId: id,
  revision: 1,
  date,
  shift: "M" as const,
  coverage: {
    period: "M" as const,
    covered: 0,
    bounds: { min: 1 },
    status: "BELOW_MINIMUM" as const,
    gap: 1,
  },
};
const person = {
  userId: id,
  displayName: "سارا نمونه",
  personnelNumber: "P-42",
  dayStatus: "UNASSIGNED" as const,
  preference: "NONE" as const,
  requiresOffReplacement: false,
};
const data: Extract<CoverageCandidates, { status: "SHORTAGE" }> = {
  ...base,
  status: "SHORTAGE",
  canAssign: true,
  assignDenial: null,
  available: [person],
  notAllowed: [],
};
const render = (value: CoverageCandidates) =>
  renderToStaticMarkup(createElement(CandidateList, { data: value }));

describe("D111 candidate presentation", () => {
  it("keeps backend order and only two groups; shows identity without UUIDs or write controls", () => {
    const html = render({
      ...data,
      available: [
        { ...person, userId: "z", displayName: "اول" },
        { ...person, userId: "a", displayName: "دوم" },
      ],
    });
    expect(html.indexOf("اول")).toBeLessThan(html.indexOf("دوم"));
    expect(html).toContain('aria-label="قابل انتخاب"');
    expect(html).toContain('aria-label="غیرمجاز"');
    expect(html).toContain("P-42");
    expect(html).not.toMatch(
      /00000000|<button|<form|UUID|درصد|امتیاز|بهترین|ساعت/,
    );
  });
  it("distinguishes OFF decisions from a soft OFF preference", () => {
    const html = render({
      ...data,
      available: [
        {
          ...person,
          dayStatus: "OFF_ASSIGNMENT",
          preference: "OFF_PREFERENCE",
          requiresOffReplacement: true,
        },
      ],
    });
    expect(html).toContain(candidateDayLabel.OFF_ASSIGNMENT);
    expect(html).toContain(candidatePreferenceLabel.OFF_PREFERENCE);
    expect(html).not.toContain("<button");
  });
  it("omits missing personnel numbers and describes every preference", () => {
    const html = render({
      ...data,
      available: Object.keys(candidatePreferenceLabel).map((preference) => ({
        ...person,
        personnelNumber: null,
        preference: preference as typeof person.preference,
      })),
    });
    expect(html).not.toContain("شماره پرسنلی");
    for (const label of Object.values(candidatePreferenceLabel))
      expect(html).toContain(label);
  });
  it("shows the existing human-readable hard-rule finding without ids or ISO dates", () => {
    const diagnostic = toDiagnostic(
      {
        rule: "NIGHT_REST",
        nurseId: id,
        nightDate: isoDate("2026-10-24"),
        date,
        shift: "M",
        severity: "error",
      },
      { start: isoDate("2026-10-23"), end: isoDate("2026-11-21") },
    );
    const html = render({
      ...data,
      available: [],
      notAllowed: [
        {
          ...person,
          findings: [
            {
              ...diagnostic,
              nurses: [{ userId: id, displayName: person.displayName }],
            },
          ],
        },
      ],
    });
    expect(html).toContain("سارا نمونه");
    expect(html).toContain("استراحت");
    expect(html).toContain("تخصیص فرضی این شیفت");
    expect(html).not.toMatch(/00000000|2026-10|NIGHT_REST|href=/);
  });
  it("handles empty Available and Not Allowed", () => {
    const html = render({ ...data, available: [] });
    expect(html).toContain("فرد قابل انتخابی");
    expect(html).toContain("فرد غیرمجازی");
  });
  it("NO_SHORTAGE shows no candidate groups", () => {
    const html = render({ ...base, status: "NO_SHORTAGE" });
    expect(html).toContain('role="status"');
    expect(html).toContain("تکمیل شد");
    expect(html).not.toContain("قابل انتخاب");
  });
  it("only exposes BELOW_MINIMUM M/E/N entry points", () => {
    const day = {
      date,
      coverage: [
        {
          ...base.coverage,
          source: "NORMAL",
          period: "M",
          status: "BELOW_MINIMUM",
        },
        {
          ...base.coverage,
          source: "NORMAL",
          period: "E",
          status: "WITHIN_BOUNDS",
        },
        {
          ...base.coverage,
          source: "NORMAL",
          period: "N",
          status: "NOT_CONFIGURED",
        },
      ] as DayReview["coverage"],
    };
    const html = renderToStaticMarkup(
      createElement(ShortageCandidates, {
        scheduleId: id,
        date: day.date,
        coverage: day.coverage,
        period: { start: date, end: date },
        revision: 1,
      }),
    );
    expect(html).toContain("(M)");
    expect(html).not.toMatch(/\(E\)|\(N\)|\(ME\)/);
    expect(
      renderToStaticMarkup(
        createElement(ShortageCandidates, {
          scheduleId: id,
          date: day.date,
          coverage: [],
          period: { start: date, end: date },
          revision: 1,
        }),
      ),
    ).toBe("");
  });
});
