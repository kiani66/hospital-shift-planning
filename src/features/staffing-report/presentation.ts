import type { Route } from "next";
import { z } from "zod";

import type { StaffingReport } from "@/application/staffing-report/queries";
import type { DatePeriod } from "@/domain/shared/period";
import type { StaffingBucketRecord } from "@/domain/staffing-report/summary";
import { faNumber } from "@/features/calendar/jalali";

export const STATUS_LABELS = {
  ALL: "همه",
  SHORTAGE: "کمبود",
  EXCESS: "مازاد",
  WITHIN_BOUNDS: "در محدوده",
} as const;
export const ORIGIN_LABELS = {
  EXCEPTION: "استثنای تاریخ",
  HOLIDAY: "تعطیل رسمی",
  NORMAL: "روز عادی",
} as const;
export const BUCKET_LABELS = { M: "صبح", E: "عصر", N: "شب" } as const;

export const staffingParams = z.object({
  month: z.string().optional(),
  schedule: z.uuid().optional(),
  source: z.enum(["DEFAULT", "REVISION_DRAFT"]).default("DEFAULT"),
  status: z.enum(["ALL", "SHORTAGE", "EXCESS", "WITHIN_BOUNDS"]).default("ALL"),
  bucket: z.enum(["ALL", "M", "E", "N"]).default("ALL"),
});
export type StaffingParams = z.infer<typeof staffingParams>;

export function staffingHref(
  code: string,
  state: Partial<StaffingParams>,
): Route {
  const query = new URLSearchParams();
  for (const key of [
    "month",
    "schedule",
    "source",
    "status",
    "bucket",
  ] as const) {
    if (state[key]) query.set(key, state[key]);
  }
  return `/departments/${encodeURIComponent(code)}/staffing?${query}` as Route;
}

/** Presentation-only subset: domain counts/totals and input order stay untouched. */
export function visibleStaffingRows(
  rows: readonly StaffingBucketRecord[],
  state: Pick<StaffingParams, "status" | "bucket">,
) {
  return rows.filter(
    (row) =>
      (state.status === "ALL" || row.status === state.status) &&
      (state.bucket === "ALL" || row.period === state.bucket),
  );
}

export function staffingDays(rows: readonly StaffingBucketRecord[]) {
  const days = new Map<StaffingBucketRecord["date"], StaffingBucketRecord[]>();
  for (const row of rows) {
    const day = days.get(row.date) ?? [];
    day.push(row);
    days.set(row.date, day);
  }
  return [...days].map(([date, buckets]) => ({ date, buckets }));
}

export function staffingGap(row: StaffingBucketRecord): string {
  return row.status === "WITHIN_BOUNDS"
    ? "بدون کمبود یا مازاد"
    : `${STATUS_LABELS[row.status]} ${faNumber(row.gap)} نفر-نوبت`;
}

/** Keep an explicit selection across month navigation only while it overlaps. */
export function staffingMonthState(
  state: StaffingParams,
  month: string,
  target: DatePeriod,
  selected?: { id: string; period: DatePeriod },
) {
  return {
    ...state,
    month,
    schedule:
      selected &&
      selected.period.start <= target.end &&
      selected.period.end >= target.start
        ? selected.id
        : undefined,
  };
}

/** Advisory navigation only; getStaffingReport rechecks eligibility in its snapshot. */
export function showStaffingDraft(
  report: StaffingReport | null,
  available: boolean,
) {
  return !!(
    available &&
    report?.provenance.approvedVersion &&
    ["REVISING", "SUBMITTED", "RETURNED"].includes(report.schedule.status)
  );
}
