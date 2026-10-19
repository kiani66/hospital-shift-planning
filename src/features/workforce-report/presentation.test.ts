import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { WorkforceReport } from "@/application/workforce-report/queries";
import { isoDate } from "@/domain/shared/dates";
import { unwrap } from "@/domain/shared/result";
import { summarizeWorkforce } from "@/domain/workforce-report/summary";

import { SHIFT_LABELS } from "../../../tests/support/shift-labels";
import {
  SOURCE_LABELS,
  visibleWorkforceRows,
  workforceHref,
  workforceParams,
  workforceTotals,
} from "./presentation";
import { WorkforceReportView } from "./report-view";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
const first = "00000000-0000-4000-8000-000000000001";
const second = "00000000-0000-4000-8000-000000000002";
const summary = unwrap(
  summarizeWorkforce({
    period: { start: isoDate("2026-10-23"), end: isoDate("2026-10-25") },
    roster: [
      { userId: first, role: "HEAD_NURSE" },
      { userId: second, role: "SECRETARY" },
    ],
    assignments: [
      { nurseId: first, date: isoDate("2026-10-23"), shift: "N" },
      { nurseId: first, date: isoDate("2026-10-24"), shift: "OFF" },
      { nurseId: second, date: isoDate("2026-10-23"), shift: "H" },
    ],
  }),
);
const report: WorkforceReport = {
  ...summary,
  schedule: {
    id: first,
    departmentId: second,
    label: "برنامه کوتاه",
    status: "DRAFT",
    revision: 0,
  },
  requestedSource: "DEFAULT",
  provenance: {
    source: "WORKING_COPY",
    isProvisional: true,
    approvedVersion: null,
    revisionId: null,
  },
  rows: summary.rows.map((row, i) => ({
    ...row,
    displayName: i === 0 ? "کیانا نمونه" : "سارا نمونه",
    personnelNumber: i === 0 ? "0012" : null,
    isActive: i === 0,
  })),
};
const state = workforceParams.parse({ month: "1405-08", schedule: first });
const render = (changes: Partial<typeof state> = {}, data = report) =>
  renderToStaticMarkup(
    createElement(WorkforceReportView, {
      report: data,
      code: "icu",
      state: { ...state, ...changes },
      labels: SHIFT_LABELS,
    }),
  );

describe("workforce report presentation", () => {
  it("normalizes Arabic name forms and Persian digits without losing leading zeros", () => {
    expect(
      visibleWorkforceRows(report.rows, { ...state, q: "كيانا" }).map(
        (r) => r.userId,
      ),
    ).toEqual([first]);
    expect(
      visibleWorkforceRows(report.rows, { ...state, q: "۰۰۱۲" }).map(
        (r) => r.userId,
      ),
    ).toEqual([first]);
    expect(report.rows[0]!.personnelNumber).toBe("0012");
  });
  it.each(["minutes", "shifts", "night", "undecided"] as const)(
    "sorts %s numerically and deterministically in both directions",
    (sort) => {
      const rows = [
        report.rows[0]!,
        {
          ...report.rows[1]!,
          scheduledMinutes: 1200,
          workingShiftCount: 10,
          counts: { ...report.rows[1]!.counts, N: 10, UNDECIDED: 10 },
        },
      ];
      expect(
        visibleWorkforceRows(rows, { ...state, sort, order: "asc" }).map(
          (r) => r.userId,
        ),
      ).toEqual([first, second]);
      expect(
        visibleWorkforceRows(rows, { ...state, sort, order: "desc" }).map(
          (r) => r.userId,
        ),
      ).toEqual([second, first]);
      expect(rows[0]!.userId).toBe(first);
    },
  );
  it("uses name then identity to break numeric ties consistently", () => {
    const rows = report.rows.map((r) => ({
      ...r,
      displayName: "یک نام",
      scheduledMinutes: 0,
    }));
    expect(
      visibleWorkforceRows([...rows].reverse(), {
        ...state,
        sort: "minutes",
        order: "desc",
      }).map((r) => r.userId),
    ).toEqual([first, second]);
  });
  it("keeps cards on the whole roster while filtering the table", () => {
    expect(workforceTotals(report.rows)).toEqual({
      people: 2,
      shifts: 1,
      minutes: 720,
      undecided: 3,
      recorded: 3,
    });
    const html = render({ q: "نام ناشناخته" });
    expect(html).toContain("۱۲ ساعت");
    expect(html).toContain("نتیجه‌ای پیدا نشد");
    expect(html).toContain("۰ از ۲ نفر");
  });
  it("renders snapshot roles, inactive people, leading-zero numbers and all decision columns", () => {
    const html = render();
    for (const text of [
      "سرپرستار",
      "منشی",
      "غیرفعال",
      "0012",
      "M",
      "E",
      "N",
      "ME",
      "OFF",
      "H",
      "UNDECIDED",
      "بازه واقعی گزارش",
      "گزارش موقت برنامه",
      "گزارش ناقص است",
    ])
      expect(html).toContain(text);
    expect(html).toContain("overflow-x-auto");
    expect(html).toContain("کارت‌های پرسنل");
  });
  it("distinguishes a roster without decisions from an empty roster", () => {
    const undecided = {
      ...report,
      rows: report.rows.map((r) => ({
        ...r,
        workingShiftCount: 0,
        scheduledMinutes: 0,
        counts: { ...r.counts, UNDECIDED: 3 },
      })),
    };
    expect(render({}, undecided)).toContain("هنوز هیچ تصمیمی ثبت نشده است");
    expect(render({}, { ...report, rows: [] })).toContain(
      "فهرست این برنامه عضو ندارد",
    );
  });
  it("uses explicit text labels for all sources", () => {
    expect(Object.values(SOURCE_LABELS)).toEqual([
      "نسخه رسمی تأییدشده",
      "گزارش موقت برنامه",
      "پیش‌نویس اصلاحات — تأییدنشده",
    ]);
    const approved: WorkforceReport = {
      ...report,
      provenance: {
        source: "APPROVED_VERSION",
        isProvisional: false,
        revisionId: null,
        approvedVersion: {
          id: first,
          versionNo: 2,
          approvedAt: new Date("2026-10-18T08:00:00Z"),
        },
      },
    };
    const html = render({}, approved);
    expect(html).toContain("نسخه رسمی تأییدشده");
    expect(html).toContain("تأیید در");
    expect(html).not.toContain("این داده‌ها تأییدنشده‌اند");
  });
  it("preserves explicit source, search and ordering in encoded detail links", () => {
    const href = workforceHref("icu", {
      ...state,
      source: "REVISION_DRAFT",
      q: "نام & شماره",
      sort: "minutes",
      order: "desc",
      person: second,
    });
    const params = new URL(href, "http://local").searchParams;
    expect(Object.fromEntries(params)).toEqual({
      month: "1405-08",
      schedule: first,
      source: "REVISION_DRAFT",
      q: "نام & شماره",
      sort: "minutes",
      order: "desc",
      person: second,
    });
  });
  it.each([
    { source: "working" },
    { schedule: "bad" },
    { person: "bad" },
    { sort: "arbitrary" },
    { source: ["DEFAULT", "REVISION_DRAFT"] },
  ])("rejects malformed report state %j", (input) => {
    expect(workforceParams.safeParse(input).success).toBe(false);
  });
});
