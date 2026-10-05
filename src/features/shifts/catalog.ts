import { Bed, Moon, Sun, Sunset, Timer, type LucideIcon } from "lucide-react";

import {
  SHIFT_TYPES,
  crossesMidnight,
  type BaseShift,
  type PreferenceValue,
  type ShiftCode,
} from "@/domain/shifts/shift-type";

/**
 * How each shift looks and reads. The one place for shift names and color
 * tokens: every screen takes them from here; hours come from the domain
 * catalog (`SHIFT_TYPES`). Typed by `ShiftCode`, so a new code does not
 * compile until it has an entry. Colors are the `shift-*` tokens of
 * `globals.css` and are always shown with the code text; the icon only
 * reinforces the code and the name, never replaces them.
 */
export interface ShiftPresentation<C extends string = ShiftCode> {
  readonly code: C;
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
  /** A faint wash of the shift's color, for a tile that also shows the code. */
  readonly softClass: string;
  /** Decorative glyph of the shift (always `aria-hidden`, always beside the code or name). */
  readonly icon: LucideIcon;
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
    softClass: "bg-shift-m/45",
    icon: Sun,
  },
  E: {
    code: "E",
    name: "عصر",
    fullName: "عصر",
    tokenClass: "bg-shift-e text-shift-e-foreground",
    accentClass: "text-shift-e-foreground",
    dotClass: "bg-shift-e-foreground",
    softClass: "bg-shift-e/45",
    icon: Sunset,
  },
  N: {
    code: "N",
    name: "شب",
    fullName: "شب",
    tokenClass: "bg-shift-n text-shift-n-foreground",
    accentClass: "text-shift-n-foreground",
    dotClass: "bg-shift-n-foreground",
    softClass: "bg-shift-n/45",
    icon: Moon,
  },
  ME: {
    code: "ME",
    name: "طولانی",
    fullName: "طولانی (صبح + عصر)",
    tokenClass: "bg-shift-me text-shift-me-foreground",
    accentClass: "text-shift-me-foreground",
    dotClass: "bg-shift-me-foreground",
    softClass: "bg-shift-me/45",
    icon: Timer,
  },
};

/**
 * Every code a day can be shown with: the assignable shifts plus OFF (rest),
 * which today exists only as a preference value (D35). A presentation type,
 * not a domain one: the domain decides what may be assigned or preferred,
 * this only decides how each code looks.
 */
export type ShiftDisplayCode = ShiftCode | "OFF";

/** OFF (rest): the neutral `shift-off` token, a bed, and «استراحت». */
export const OFF_PRESENTATION: ShiftPresentation<"OFF"> = {
  code: "OFF",
  name: "استراحت",
  fullName: "استراحت",
  tokenClass: "bg-shift-off text-shift-off-foreground",
  accentClass: "text-shift-off-foreground",
  dotClass: "bg-shift-off-foreground",
  softClass: "bg-shift-off/45",
  icon: Bed,
};

/** The one visual identity of every displayable code (code, name, icon, color). */
export const SHIFT_DISPLAY: Readonly<
  Record<ShiftDisplayCode, ShiftPresentation<ShiftDisplayCode>>
> = { ...SHIFT_PRESENTATION, OFF: OFF_PRESENTATION };

/** Every preference value has a display entry (compile-time check). */
export const preferencePresentation = (
  value: PreferenceValue,
): ShiftPresentation<ShiftDisplayCode> => SHIFT_DISPLAY[value];

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
