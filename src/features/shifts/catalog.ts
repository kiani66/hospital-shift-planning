import { Bed, Moon, Sun, Sunset, Timer, type LucideIcon } from "lucide-react";

import type { ShiftLabels } from "@/application/shifts/labels";
import {
  SHIFT_TYPES,
  crossesMidnight,
  isWorkingShift,
  type AssignmentCode,
  type BaseShift,
  type ShiftCode,
} from "@/domain/shifts/shift-type";

export type { ShiftLabels };

/**
 * How each shift looks. The one place for shift color tokens and icons:
 * every screen takes them from here; hours come from the domain catalog
 * (`SHIFT_TYPES`) and descriptive names from `shift_types.label`
 * (`ShiftLabels`, loaded once per request by `loadShiftLabels()`). Typed by
 * `ShiftCode`, so a new code does not compile until it has an entry. Colors
 * are the `shift-*` tokens of `globals.css` and are always shown with the
 * code text; the icon only reinforces the code and the name, never replaces
 * them.
 */
export interface ShiftPresentation<C extends string = ShiftCode> {
  readonly code: C;
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

/** The working shifts (`ShiftCode`): what has hours and staffs coverage. */
export const SHIFT_PRESENTATION: Readonly<{
  [C in ShiftCode]: ShiftPresentation<C>;
}> = {
  M: {
    code: "M",
    tokenClass: "bg-shift-m text-shift-m-foreground",
    accentClass: "text-shift-m-foreground",
    dotClass: "bg-shift-m-foreground",
    softClass: "bg-shift-m/45",
    icon: Sun,
  },
  E: {
    code: "E",
    tokenClass: "bg-shift-e text-shift-e-foreground",
    accentClass: "text-shift-e-foreground",
    dotClass: "bg-shift-e-foreground",
    softClass: "bg-shift-e/45",
    icon: Sunset,
  },
  N: {
    code: "N",
    tokenClass: "bg-shift-n text-shift-n-foreground",
    accentClass: "text-shift-n-foreground",
    dotClass: "bg-shift-n-foreground",
    softClass: "bg-shift-n/45",
    icon: Moon,
  },
  ME: {
    code: "ME",
    tokenClass: "bg-shift-me text-shift-me-foreground",
    accentClass: "text-shift-me-foreground",
    dotClass: "bg-shift-me-foreground",
    softClass: "bg-shift-me/45",
    icon: Timer,
  },
};

/**
 * A name with its meaning, for legends and headings: a shift that covers
 * several periods spells them out ("طولانی (صبح + عصر)"), from the labels.
 */
export function shiftFullName(code: AssignmentCode, labels: ShiftLabels) {
  const covers: readonly BaseShift[] = isWorkingShift(code)
    ? SHIFT_TYPES[code].covers
    : [];
  return covers.length > 1
    ? `${labels[code]} (${covers.map((p) => labels[p]).join(" + ")})`
    : labels[code];
}

const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

/** "07:00" → "۰۷:۰۰". */
export const faClock = (time: string) =>
  time.replace(/\d/g, (d) => PERSIAN_DIGITS[Number(d)]!);

/**
 * "۰۷:۰۰ تا ۱۴:۰۰", or "۱۹:۰۰ تا ۰۷:۰۰ روز بعد" for a shift that crosses
 * midnight. A decision without hours (OFF) reads as its label.
 */
export function shiftHoursLabel(
  code: AssignmentCode,
  labels: ShiftLabels,
): string {
  if (!isWorkingShift(code)) return labels[code];
  const shift = SHIFT_TYPES[code];
  const range = `${faClock(shift.start)} تا ${faClock(shift.end)}`;
  return crossesMidnight(shift) ? `${range} روز بعد` : range;
}

/**
 * OFF (rest) is an explicit scheduling decision, not a working shift: it has
 * no hours and no shift color. Neutral tokens and a bed keep it from looking
 * like work. Like every code, code-oriented controls show `OFF` and
 * descriptive text shows its label.
 */
export const OFF_PRESENTATION: ShiftPresentation<"OFF"> = {
  code: "OFF",
  tokenClass: "bg-muted text-muted-foreground",
  accentClass: "text-muted-foreground",
  dotClass: "bg-muted-foreground",
  softClass: "bg-muted",
  icon: Bed,
};

/**
 * The one visual identity of every explicit scheduling decision (code,
 * icon, color): the working shifts plus OFF. A missing assignment is
 * UNDECIDED and has no entry (see `assignmentName`). Preference values are
 * the same codes (a wish, not a decision), so they share these entries.
 */
export const ASSIGNMENT_PRESENTATION: Readonly<{
  [C in AssignmentCode]: ShiftPresentation<C>;
}> = { ...SHIFT_PRESENTATION, OFF: OFF_PRESENTATION };

/** "صبح (M)", "استراحت (OFF)", or "تعیین‌نشده" for a missing decision. */
export const assignmentName = (
  code: AssignmentCode | null,
  labels: ShiftLabels,
): string => (code === null ? "تعیین‌نشده" : `${labels[code]} (${code})`);
