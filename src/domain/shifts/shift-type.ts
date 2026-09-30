/** Base shifts a day can be staffed with. */
export type BaseShift = "M" | "E" | "N";

export const SHIFT_CODES = ["M", "E", "N", "ME"] as const;

/** Assignable shift codes. `ME` (long shift) is Morning + Evening. */
export type ShiftCode = (typeof SHIFT_CODES)[number];

/**
 * The operational coverage periods of a day, in order. Each is staffed by the
 * base shift of the same code and by every shift that `covers` it, so staffing
 * is counted per period, never per assignment code (ME counts toward M and E).
 */
export const COVERAGE_PERIODS = [
  "M",
  "E",
  "N",
] as const satisfies readonly BaseShift[];

/** A wall-clock time of day, `HH:MM` on a 24-hour clock. */
export type ClockTime = string;

export interface ShiftType {
  readonly code: ShiftCode;
  /** Base shifts this code staffs (ME counts toward both M and E). */
  readonly covers: readonly BaseShift[];
  /** Triggers the night-rest rule for the following day. */
  readonly isNight: boolean;
  /** Start of the shift on its assignment date. */
  readonly start: ClockTime;
  /** End of the shift; at or before `start` means the next day (see `crossesMidnight`). */
  readonly end: ClockTime;
}

/**
 * The shift catalog: codes, coverage semantics and business-default hours.
 * The single source for shift hours; rules and screens derive from it, so
 * changing an hour here needs no other change. Display names and colors are
 * presentation (`features/shifts/catalog.ts`).
 */
export const SHIFT_TYPES: Readonly<Record<ShiftCode, ShiftType>> = {
  M: { code: "M", covers: ["M"], isNight: false, start: "07:00", end: "14:00" },
  E: { code: "E", covers: ["E"], isNight: false, start: "14:00", end: "19:00" },
  N: { code: "N", covers: ["N"], isNight: true, start: "19:00", end: "07:00" },
  ME: {
    code: "ME",
    covers: ["M", "E"],
    isNight: false,
    start: "07:00",
    end: "19:00",
  },
};

const CLOCK_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MINUTES_PER_DAY = 24 * 60;

/** Minutes since midnight of an `HH:MM` time; throws on anything else. */
export function clockMinutes(time: ClockTime): number {
  const match = CLOCK_TIME.exec(time);
  if (!match) throw new RangeError(`Invalid clock time: ${time}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

/** The shift ends on the day after its assignment date (e.g. N, 19:00–07:00). */
export const crossesMidnight = (shift: ShiftType): boolean =>
  clockMinutes(shift.end) <= clockMinutes(shift.start);

/** Length of the shift in minutes (the basis for future working-hour totals). */
export const shiftDurationMinutes = (shift: ShiftType): number =>
  clockMinutes(shift.end) -
  clockMinutes(shift.start) +
  (crossesMidnight(shift) ? MINUTES_PER_DAY : 0);

export const isShiftCode = (value: unknown): value is ShiftCode =>
  typeof value === "string" &&
  (SHIFT_CODES as readonly string[]).includes(value);

export const isNightShift = (code: ShiftCode): boolean =>
  SHIFT_TYPES[code].isNight;

export const PREFERENCE_VALUES = [...SHIFT_CODES, "OFF"] as const;

/** A nurse's wish for one day: a shift, or OFF (leave / unavailable). */
export type PreferenceValue = (typeof PREFERENCE_VALUES)[number];

export const isPreferenceValue = (value: unknown): value is PreferenceValue =>
  typeof value === "string" &&
  (PREFERENCE_VALUES as readonly string[]).includes(value);
