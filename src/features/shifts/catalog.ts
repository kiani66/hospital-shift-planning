import {
  SHIFT_TYPES,
  crossesMidnight,
  type BaseShift,
  type ShiftCode,
} from "@/domain/shifts/shift-type";

/**
 * How each shift looks and reads. The one place for shift names and color
 * tokens: every screen takes them from here; hours come from the domain
 * catalog (`SHIFT_TYPES`). Typed by `ShiftCode`, so a new code does not
 * compile until it has an entry. Colors are the `shift-*` tokens of
 * `globals.css` and are always shown with the code text.
 */
export interface ShiftPresentation {
  readonly code: ShiftCode;
  /** Short Persian name, e.g. "صبح". */
  readonly name: string;
  /** Name with its meaning, for legends and headings. */
  readonly fullName: string;
  /** Background + text token classes (literal, so Tailwind generates them). */
  readonly tokenClass: string;
  /** Text color only: for a code or count on a neutral surface (calm, dense views). */
  readonly accentClass: string;
  /** A small marker in the shift's color, always next to the code text. */
  readonly dotClass: string;
}

export const SHIFT_PRESENTATION: Readonly<
  Record<ShiftCode, ShiftPresentation>
> = {
  M: {
    code: "M",
    name: "صبح",
    fullName: "صبح",
    tokenClass: "bg-shift-m text-shift-m-foreground",
    accentClass: "text-shift-m-foreground",
    dotClass: "bg-shift-m-foreground",
  },
  E: {
    code: "E",
    name: "عصر",
    fullName: "عصر",
    tokenClass: "bg-shift-e text-shift-e-foreground",
    accentClass: "text-shift-e-foreground",
    dotClass: "bg-shift-e-foreground",
  },
  N: {
    code: "N",
    name: "شب",
    fullName: "شب",
    tokenClass: "bg-shift-n text-shift-n-foreground",
    accentClass: "text-shift-n-foreground",
    dotClass: "bg-shift-n-foreground",
  },
  ME: {
    code: "ME",
    name: "طولانی",
    fullName: "طولانی (صبح + عصر)",
    tokenClass: "bg-shift-me text-shift-me-foreground",
    accentClass: "text-shift-me-foreground",
    dotClass: "bg-shift-me-foreground",
  },
};

/** Names of the coverage periods (what staffing is counted against). */
export const COVERAGE_PERIOD_NAMES: Readonly<Record<BaseShift, string>> = {
  M: "صبح",
  E: "عصر",
  N: "شب",
};

const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

/** "07:00" → "۰۷:۰۰". */
export const faClock = (time: string) =>
  time.replace(/\d/g, (d) => PERSIAN_DIGITS[Number(d)]!);

/** "۰۷:۰۰ تا ۱۴:۰۰", or "۱۹:۰۰ تا ۰۷:۰۰ روز بعد" for a shift that crosses midnight. */
export function shiftHoursLabel(code: ShiftCode): string {
  const shift = SHIFT_TYPES[code];
  const range = `${faClock(shift.start)} تا ${faClock(shift.end)}`;
  return crossesMidnight(shift) ? `${range} روز بعد` : range;
}
