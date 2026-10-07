import type { IsoDate } from "../shared/dates";
import { COVERAGE_PERIODS, type BaseShift } from "../shifts/shift-type";
import type { StaffingBounds, StaffingRequirement } from "../rules/staffing";
import type { CoverageBounds, RuleSetContent } from "./model";

/** Where a day's bounds for one bucket came from, inside the pinned version. */
export type RequirementSource = "EXCEPTION" | "HOLIDAY" | "NORMAL";

/** The resolved bounds of one bucket on one day, with their source. */
export interface ResolvedBounds extends CoverageBounds {
  readonly source: RequirementSource;
}

/**
 * The bounds of every bucket on `date` inside one version (D106): a
 * specific-date exception, else the HOLIDAY bounds when the day is an
 * official holiday and the version defines them for that bucket, else the
 * NORMAL bounds. Scope (Department Override vs Hospital Default) was already
 * decided when the version was pinned.
 */
export function resolveDay(
  content: RuleSetContent,
  date: IsoDate,
  isHoliday: boolean,
): Readonly<Record<BaseShift, ResolvedBounds>> {
  const resolve = (period: BaseShift): ResolvedBounds => {
    const exception = content.exceptions.find(
      (e) => e.date === date && e.period === period,
    );
    if (exception) return { ...exception.bounds, source: "EXCEPTION" };
    const holiday = isHoliday ? content.holiday[period] : undefined;
    if (holiday) return { ...holiday, source: "HOLIDAY" };
    return { ...content.normal[period], source: "NORMAL" };
  };
  return { M: resolve("M"), E: resolve("E"), N: resolve("N") };
}

/** The validator's bounds: an empty maximum is simply not set. */
export const toStaffingBounds = (bounds: CoverageBounds): StaffingBounds =>
  bounds.max === null
    ? { min: bounds.min }
    : { min: bounds.min, max: bounds.max };

/**
 * The staffing requirement of every given day under one version, as the
 * validator consumes it. Every day gets every bucket: a version is complete.
 */
export function resolveRequirements(
  content: RuleSetContent,
  dates: readonly IsoDate[],
  holidays: ReadonlySet<IsoDate>,
): ReadonlyMap<IsoDate, StaffingRequirement> {
  return new Map(
    dates.map((date) => {
      const day = resolveDay(content, date, holidays.has(date));
      return [
        date,
        Object.fromEntries(
          COVERAGE_PERIODS.map((p) => [p, toStaffingBounds(day[p])]),
        ) as StaffingRequirement,
      ];
    }),
  );
}
