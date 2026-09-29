/** Base shifts a day can be staffed with. */
export type BaseShift = "M" | "E" | "N";

export const SHIFT_CODES = ["M", "E", "N", "ME"] as const;

/** Assignable shift codes. `ME` (long shift) is Morning + Evening. */
export type ShiftCode = (typeof SHIFT_CODES)[number];

export interface ShiftType {
  readonly code: ShiftCode;
  /** Base shifts this code staffs (ME counts toward both M and E). */
  readonly covers: readonly BaseShift[];
  /** Triggers the night-rest rule for the following day. */
  readonly isNight: boolean;
}

export const SHIFT_TYPES: Readonly<Record<ShiftCode, ShiftType>> = {
  M: { code: "M", covers: ["M"], isNight: false },
  E: { code: "E", covers: ["E"], isNight: false },
  N: { code: "N", covers: ["N"], isNight: true },
  ME: { code: "ME", covers: ["M", "E"], isNight: false },
};

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
