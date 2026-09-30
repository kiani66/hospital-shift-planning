import {
  SHIFT_CODES,
  SHIFT_TYPES,
  type BaseShift,
  type ShiftCode,
} from "./shift-type";

/** How many assignments of each type (M, E, N, ME) there are. */
export type ShiftCounts = Readonly<Record<ShiftCode, number>>;

/** How many nurses staff each coverage period (M, E, N); ME counts toward M and E. */
export type CoverageCounts = Readonly<Record<BaseShift, number>>;

export const emptyShiftCounts = (): Record<ShiftCode, number> => ({
  M: 0,
  E: 0,
  N: 0,
  ME: 0,
});

export function countByShift(shifts: Iterable<ShiftCode>): ShiftCounts {
  const counts = emptyShiftCounts();
  for (const shift of shifts) counts[shift] += 1;
  return counts;
}

/**
 * Operational coverage from assignment counts: each assignment adds one to
 * every period its shift `covers`. Staffing rules count this, never codes.
 */
export function coverageOf(counts: ShiftCounts): CoverageCounts {
  const coverage = { M: 0, E: 0, N: 0 };
  for (const code of SHIFT_CODES)
    for (const period of SHIFT_TYPES[code].covers)
      coverage[period] += counts[code];
  return coverage;
}

/** The shift codes that staff a coverage period (M: M and ME). */
export const shiftsCovering = (period: BaseShift): ShiftCode[] =>
  SHIFT_CODES.filter((code) => SHIFT_TYPES[code].covers.includes(period));
