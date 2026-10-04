import {
  SHIFT_CODES,
  SHIFT_TYPES,
  isNightShift,
  shiftDurationMinutes,
  type ShiftCode,
} from "./shift-type";

/**
 * Totals of a set of assignments, from the shift catalog (D42): the hours
 * are each shift's catalog duration, so changing an hour in `SHIFT_TYPES`
 * changes every total. A shift is counted whole on its assignment date (a
 * Night that ends the next morning, or the next month, counts on the day it
 * starts). Planning figures only: not attendance or payroll (D77).
 */
export interface ShiftTotals {
  readonly shiftCount: number;
  readonly minutes: number;
  readonly nightCount: number;
  readonly byCode: Readonly<Record<ShiftCode, number>>;
}

export function summarizeShifts(codes: Iterable<ShiftCode>): ShiftTotals {
  const byCode = Object.fromEntries(SHIFT_CODES.map((c) => [c, 0])) as Record<
    ShiftCode,
    number
  >;
  let shiftCount = 0;
  let minutes = 0;
  let nightCount = 0;
  for (const code of codes) {
    shiftCount++;
    byCode[code]++;
    minutes += shiftDurationMinutes(SHIFT_TYPES[code]);
    if (isNightShift(code)) nightCount++;
  }
  return { shiftCount, minutes, nightCount, byCode };
}
