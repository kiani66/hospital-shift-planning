import { countByShift, coverageOf } from "../shifts/coverage";
import type { AssignmentCode, BaseShift } from "../shifts/shift-type";
import { summarizeShifts } from "../shifts/working-time";
import {
  EXCEL_TEMPLATE_DAY_COLUMNS,
  EXCEL_UNDECIDED_VALUE,
  KEEP_CELL,
  type DailyStatistic,
  type ExportCellValue,
  type PersonStatistic,
  type SummaryCellValue,
} from "./template-mapping";

/**
 * The printed statistics of an export (D124), from the exported decisions
 * only. The template's own figures are static values from the month it was
 * saved in, so every mapped statistic cell is rewritten: with a figure the
 * system calculates the way the app does, with `?` while a day it depends on
 * is undecided, or blank (CLEAR) when the system cannot calculate it.
 */

/** One person's decisions by day of the period (1-based). */
export type DayDecisions = ReadonlyMap<number, AssignmentCode>;

const periodCodes = (dayCount: number, decisions: DayDecisions) =>
  Array.from({ length: dayCount }, (_, i) => decisions.get(i + 1) ?? null);

/**
 * A per-person statistic over the period. Totals follow the app's own
 * (`summarizeShifts`, D42): a shift is one shift whatever its length, and
 * leave (H) is counted apart from shifts and rest.
 */
export function personStatistic(
  statistic: PersonStatistic,
  dayCount: number,
  decisions: DayDecisions,
): ExportCellValue {
  if (statistic === "CLEAR") return null;
  const codes = periodCodes(dayCount, decisions);
  if (codes.includes(null)) return EXCEL_UNDECIDED_VALUE;
  const totals = summarizeShifts(codes);
  return statistic === "SHIFT_COUNT" ? totals.shiftCount : totals.leaveCount;
}

const PERIOD_OF: Readonly<
  Record<Exclude<DailyStatistic, "CLEAR" | "MANUAL">, BaseShift>
> = {
  COVERAGE_M: "M",
  COVERAGE_E: "E",
  COVERAGE_N: "N",
};

/**
 * The 31 values of a daily summary row: per day, the nursing coverage of one
 * period over `staffing` (the roster without secretaries, D119), counted as
 * the app counts staffing (`coverageOf`: ME toward M and E). A day on which
 * a counted person is undecided is `?`; days past the period are blank.
 * A MANUAL row keeps the period's days (`KEEP_CELL`) and blanks the rest.
 */
export function dailyStatistic(
  statistic: DailyStatistic,
  dayCount: number,
  staffing: readonly DayDecisions[],
): SummaryCellValue[] {
  return Array.from({ length: EXCEL_TEMPLATE_DAY_COLUMNS }, (_, i) => {
    if (statistic === "CLEAR" || i >= dayCount) return null;
    if (statistic === "MANUAL") return KEEP_CELL;
    const codes = staffing.map((decisions) => decisions.get(i + 1) ?? null);
    if (codes.includes(null)) return EXCEL_UNDECIDED_VALUE;
    return coverageOf(countByShift(codes))[PERIOD_OF[statistic]];
  });
}
