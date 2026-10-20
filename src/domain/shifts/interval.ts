import { addDays, type IsoDate } from "../shared/dates";
import {
  crossesMidnight,
  isWorkingShift,
  SHIFT_TYPES,
  type AssignmentCode,
} from "./shift-type";

/** Half-open working interval: touching endpoints do not overlap. */
export interface WorkingInterval {
  readonly start: number;
  readonly end: number;
}

/** Calendar days stay ISO strings; the adapter resolves wall times to instants. */
export function assignmentInterval(
  date: IsoDate,
  code: AssignmentCode,
  instantAt: (date: IsoDate, time: string) => number,
): WorkingInterval | null {
  if (!isWorkingShift(code)) return null;
  const shift = SHIFT_TYPES[code];
  return {
    start: instantAt(date, shift.start),
    end: instantAt(crossesMidnight(shift) ? addDays(date, 1) : date, shift.end),
  };
}

export const intervalsOverlap = (a: WorkingInterval, b: WorkingInterval) =>
  a.start < b.end && b.start < a.end;

/** Active shifts take priority; otherwise the earliest actual start wins. */
export function currentOrNextShift<T extends WorkingInterval>(
  shifts: readonly T[],
  now: number,
): { shift: T; active: boolean } | null {
  const active = shifts
    .filter((s) => s.start <= now && now < s.end)
    .sort((a, b) => a.start - b.start)[0];
  if (active) return { shift: active, active: true };
  const next = shifts
    .filter((s) => s.start > now)
    .sort((a, b) => a.start - b.start)[0];
  return next ? { shift: next, active: false } : null;
}

/** Round up so an upcoming shift never reads "0 minutes" before starting. */
export const countdownMinutes = (start: number, now: number): number =>
  Math.max(0, Math.ceil((start - now) / 60_000));
