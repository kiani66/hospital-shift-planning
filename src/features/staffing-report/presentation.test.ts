import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { StaffingReport } from "@/application/staffing-report/queries";
import { isoDate } from "@/domain/shared/dates";
import { unwrap } from "@/domain/shared/result";
import { summarizeStaffing } from "@/domain/staffing-report/summary";
import { formatJalaliRange } from "@/features/calendar/jalali";

import {
  staffingParams,
  staffingHref,
  visibleStaffingRows,
  staffingDays,
  staffingGap,
  staffingMonthState,
  showStaffingDraft,
} from "./presentation";
import { StaffingReportView } from "./report-view";

const id = "00000000-0000-4000-8000-000000000001";
const period = { start: isoDate("2026-12-31"), end: isoDate("2027-01-02") };
const report: StaffingReport = {
  ...unwrap(
    summarizeStaffing({
      period,
      roster: [{ userId: id, role: "HEAD_NURSE" }],
      assignments: [{ nurseId: id, date: period.start, shift: "ME" }],
      ruleSet: {
        normal: {
          M: { min: 0, max: 0 },
          E: { min: 1, max: null },
          N: { min: 2, max: 3 },
        },
        holiday: {},
        exceptions: [
          {
            date: period.start,
            period: "N",
            bounds: { min: 3, max: 3 },
            note: null,
          },
        ],
      },
      officialHolidays: new Set(),
    }),
  ),
  schedule: {
    id,
    departmentId: id,
    label: "برنامه کوتاه",
    status: "PLANNING",
    revision: 0,
  },
  requestedSource: "DEFAULT",
  provenance: {
    source: "WORKING_COPY",
    isProvisional: true,
    approvedVersion: null,
    revisionId: null,
  },
  ruleSet: {
    versionId: id,
    ruleSetId: id,
    versionNo: 2,
    scope: "DEPARTMENT_OVERRIDE",
    departmentId: id,
    effectiveFrom: period.start,
    status: "RETIRED",
  },
};
const state = staffingParams.parse({ month: "1405-10", schedule: id });
const render = (changes = {}, data = report) =>
  renderToStaticMarkup(
    createElement(StaffingReportView, {
      report: data,
      code: "icu",
      state: { ...state, ...changes },
    }),
  );

describe("staffing report presentation", () => {
  it("defaults to all rows from DEFAULT and rejects invalid or repeated values", () => {
    expect(staffingParams.parse({})).toEqual({
      source: "DEFAULT",
      status: "ALL",
      bucket: "ALL",
    });
    for (const bad of [
      { source: "APPROVED_VERSION" },
      { source: ["DEFAULT", "REVISION_DRAFT"] },
      { schedule: "bad" },
      { status: "bad" },
      { bucket: "ME" },
    ])
      expect(staffingParams.safeParse(bad).success).toBe(false);
  });
  it("preserves the exact schedule/source/filter URL state and escapes department codes", () => {
    const url = new URL(
      staffingHref("a/b", {
        ...state,
        source: "REVISION_DRAFT",
        status: "SHORTAGE",
        bucket: "N",
      }),
      "https://test.invalid",
    );
    expect(url.pathname).toBe("/departments/a%2Fb/staffing");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      ...state,
      source: "REVISION_DRAFT",
      status: "SHORTAGE",
      bucket: "N",
    });
  });
  it("filters without mutation, reordering or recalculation and groups all three buckets by date", () => {
    const before = structuredClone(report.rows);
    expect(visibleStaffingRows(report.rows, state)).toEqual(report.rows);
    const rows = visibleStaffingRows(report.rows, {
      status: "SHORTAGE",
      bucket: "N",
    });
    expect(rows).toEqual([report.rows[2], report.rows[5], report.rows[8]]);
    expect(
      staffingDays(report.rows).map((d) => d.buckets.map((r) => r.period)),
    ).toEqual([
      ["M", "E", "N"],
      ["M", "E", "N"],
      ["M", "E", "N"],
    ]);
    expect(staffingDays(rows)).toHaveLength(3);
    expect(report.rows).toEqual(before);
  });
  it("keeps problem buckets, distinct dates and person-period gaps separate under every filter", () => {
    const cards = (html: string) =>
      html.match(/<dl aria-label="خلاصه کل بازه گزارش"[\s\S]*?<\/dl>/)![0];
    const original = cards(render());
    for (const status of ["SHORTAGE", "EXCESS", "WITHIN_BOUNDS"] as const)
      expect(cards(render({ status }))).toBe(original);
    expect(original).toContain("نوبت‌های دارای کمبود");
    expect(original).toContain("روزهای دارای کمبود");
    expect(original).toContain("جمع کمبود نفر-نوبت");
    expect(staffingGap(report.rows[0]!)).toBe("مازاد ۱ نفر-نوبت");
    expect(staffingGap(report.rows[1]!)).toBe("بدون کمبود یا مازاد");
    expect(staffingGap(report.rows[2]!)).toBe("کمبود ۳ نفر-نوبت");
  });
  it("renders all dates, origins, unlimited maximum, explanations and an honest undecided warning", () => {
    const html = render();
    expect(html).toContain(formatJalaliRange(period.start, period.end));
    expect(html.match(/data-staffing-row=/g)).toHaveLength(9);
    expect(html.match(/data-staffing-card=/g)).toHaveLength(9);
    for (const text of [
      "بدون حداکثر",
      "استثنای تاریخ",
      "روز عادی",
      "شیفت ME در پوشش صبح و عصر محاسبه می‌شود؛ منشی در پوشش پرستاری محاسبه نمی‌شود.",
      "تصمیم‌های برنامه کامل نیست؛ پوشش بر اساس تصمیم‌های ثبت‌شده محاسبه شده است.",
      "اختصاصی بخش",
      "بازنشسته",
      "گزارش موقت برنامه",
    ])
      expect(html).toContain(text);
    expect(html).not.toContain("برنامه آماده نهایی‌سازی است");
    expect(render({}, { ...report, undecidedNurseDays: 0 })).not.toContain(
      "تصمیم‌های برنامه کامل نیست",
    );
  });
  it("labels each selected source without visually substituting another snapshot", () => {
    const approvedVersion = {
      id,
      versionNo: 4,
      approvedAt: new Date("2026-12-31T12:00:00Z"),
    };
    const official: StaffingReport = {
      ...report,
      provenance: {
        source: "APPROVED_VERSION",
        isProvisional: false,
        approvedVersion,
        revisionId: null,
      },
    };
    expect(render({}, official)).toContain("نسخه رسمی تأییدشده");
    expect(render({}, official)).not.toContain("این داده‌ها تأییدنشده‌اند");
    const draft: StaffingReport = {
      ...official,
      schedule: { ...official.schedule, status: "REVISING" },
      provenance: {
        source: "REVISION_DRAFT",
        isProvisional: true,
        approvedVersion,
        revisionId: id,
      },
    };
    expect(render({}, draft)).toContain("پیش‌نویس اصلاحات — تأییدنشده");
    expect(render({}, draft)).toContain("نسخه رسمی مبنا");
    expect(showStaffingDraft(draft, true)).toBe(true);
    expect(showStaffingDraft(draft, false)).toBe(false);
    expect(showStaffingDraft(official, true)).toBe(false);
    expect(showStaffingDraft(report, true)).toBe(false);
    expect(showStaffingDraft(null, true)).toBe(false);
  });
  it("preserves a cross-month selection/source, but clears a schedule outside the new month", () => {
    const selected = { id, period };
    const draft = { ...state, source: "REVISION_DRAFT" as const };
    expect(
      staffingMonthState(draft, "1405-11", period, selected),
    ).toMatchObject({
      schedule: id,
      source: "REVISION_DRAFT",
      month: "1405-11",
    });
    expect(
      staffingMonthState(
        draft,
        "1405-12",
        { start: isoDate("2027-03-01"), end: isoDate("2027-03-20") },
        selected,
      ).schedule,
    ).toBeUndefined();
  });
  it("offers an empty-filter reset which keeps the selected source and schedule", () => {
    const html = render({
      status: "EXCESS",
      bucket: "N",
      source: "REVISION_DRAFT",
    });
    expect(html).toContain("نوبتی با این فیلتر وجود ندارد");
    expect(html).toContain("source=REVISION_DRAFT");
    expect(html).toContain(`schedule=${id}`);
    expect(html).not.toContain("data-staffing-row=");
  });
});
