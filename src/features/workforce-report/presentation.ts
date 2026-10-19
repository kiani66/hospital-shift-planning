import type { Route } from "next";
import { z } from "zod";

import type { WorkforceReportRow } from "@/application/workforce-report/queries";
import {
  normalizeDisplayName,
  normalizeIdentifierText,
} from "@/domain/identity/normalize";

export const SORT_LABELS = {
  name: "نام",
  minutes: "ساعات برنامه‌ریزی‌شده",
  shifts: "تعداد شیفت کاری",
  night: "تعداد شب (N)",
  undecided: "روزهای تعیین‌نشده",
} as const;

export const workforceParams = z.object({
  month: z.string().optional(),
  schedule: z.uuid().optional(),
  source: z.enum(["DEFAULT", "REVISION_DRAFT"]).default("DEFAULT"),
  q: z.string().max(200).default(""),
  sort: z
    .enum(["name", "minutes", "shifts", "night", "undecided"])
    .default("name"),
  order: z.enum(["asc", "desc"]).default("asc"),
  person: z.uuid().optional(),
});
export type WorkforceParams = z.infer<typeof workforceParams>;

export { SOURCE_LABELS } from "@/features/reporting/shared";

/** URL state is shared by search, sorting, source switching and detail. */
export function workforceHref(
  code: string,
  state: Partial<WorkforceParams>,
): Route {
  const query = new URLSearchParams();
  for (const key of [
    "month",
    "schedule",
    "source",
    "q",
    "sort",
    "order",
    "person",
  ] as const) {
    const value = state[key];
    if (value) query.set(key, value);
  }
  return `/departments/${encodeURIComponent(code)}/workforce?${query}` as Route;
}

const searchText = (value: string) =>
  normalizeDisplayName(normalizeIdentifierText(value)).toLocaleLowerCase("fa");
const names = new Intl.Collator("fa");

/** Presentation only: numeric comparisons use the domain engine's integer totals. */
export function visibleWorkforceRows(
  rows: readonly WorkforceReportRow[],
  state: Pick<WorkforceParams, "q" | "sort" | "order">,
): WorkforceReportRow[] {
  const query = searchText(state.q);
  const value = (row: WorkforceReportRow) => {
    switch (state.sort) {
      case "minutes":
        return row.scheduledMinutes;
      case "shifts":
        return row.workingShiftCount;
      case "night":
        return row.counts.N;
      case "undecided":
        return row.counts.UNDECIDED;
      case "name":
        return 0;
    }
  };
  return rows
    .filter((row) =>
      searchText(`${row.displayName} ${row.personnelNumber ?? ""}`).includes(
        query,
      ),
    )
    .sort((a, b) => {
      const comparison =
        state.sort === "name"
          ? names.compare(
              normalizeDisplayName(a.displayName),
              normalizeDisplayName(b.displayName),
            )
          : value(a) - value(b);
      return (
        comparison * (state.order === "desc" ? -1 : 1) ||
        names.compare(a.displayName, b.displayName) ||
        a.userId.localeCompare(b.userId)
      );
    });
}

/** Whole-roster cards must never depend on the search results. */
export function workforceTotals(rows: readonly WorkforceReportRow[]) {
  return rows.reduce(
    (totals, row) => ({
      people: totals.people + 1,
      shifts: totals.shifts + row.workingShiftCount,
      minutes: totals.minutes + row.scheduledMinutes,
      undecided: totals.undecided + row.counts.UNDECIDED,
      recorded: totals.recorded + row.reportingDayCount - row.counts.UNDECIDED,
    }),
    { people: 0, shifts: 0, minutes: 0, undecided: 0, recorded: 0 },
  );
}
