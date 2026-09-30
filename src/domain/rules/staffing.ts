import type { BaseShift } from "../shifts/shift-type";

/**
 * Staffing capacity boundary (Phase 7a). The numbers are a business decision
 * not yet made: no minimum or maximum exists anywhere, so every period reads
 * NOT_CONFIGURED. A later phase supplies requirements (per department, and
 * possibly per weekday or holiday) and adds the staffing validators that
 * report violations; the review screens already show the status per period.
 */
export interface StaffingBounds {
  /** Fewest nurses the coverage period needs. */
  readonly min?: number;
  /** Most nurses the coverage period should have. */
  readonly max?: number;
}

/** One day's requirement per coverage period; a missing period is not configured. */
export type StaffingRequirement = Readonly<
  Partial<Record<BaseShift, StaffingBounds>>
>;

export type StaffingStatus =
  "NOT_CONFIGURED" | "BELOW_MINIMUM" | "WITHIN_BOUNDS" | "ABOVE_MAXIMUM";

/** Compares a period's operational coverage (not its shift codes) with its bounds. */
export function staffingStatus(
  covered: number,
  bounds: StaffingBounds | undefined,
): StaffingStatus {
  if (bounds?.min === undefined && bounds?.max === undefined)
    return "NOT_CONFIGURED";
  if (bounds.min !== undefined && covered < bounds.min) return "BELOW_MINIMUM";
  if (bounds.max !== undefined && covered > bounds.max) return "ABOVE_MAXIMUM";
  return "WITHIN_BOUNDS";
}
