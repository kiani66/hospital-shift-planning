import {
  isWorkingShift,
  type AssignmentCode,
} from "@/domain/shifts/shift-type";
import { shiftFullName, type ShiftLabels } from "@/features/shifts/catalog";

/**
 * The day editor's keyboard model. Keys are matched by physical position
 * (`KeyboardEvent.code`), so they work the same on a Persian or English
 * keyboard layout. Shortcuts act only when focus is on a nurse's shift
 * control (never while typing in the search box or using the range form),
 * and never with Ctrl/Alt/Meta, except Ctrl/Cmd+Z for undo, so browser and
 * screen-reader shortcuts keep working. Every shortcut has a visible
 * button that does the same.
 */
export type EditorKeyCommand =
  | { readonly type: "SET"; readonly shift: AssignmentCode }
  | { readonly type: "CLEAR" }
  /** Move to the same control of the previous (-1) or next (+1) nurse. */
  | { readonly type: "ROW"; readonly delta: -1 | 1 }
  /** Move between a nurse's controls in reading order (RTL: left is forward). */
  | { readonly type: "COLUMN"; readonly delta: -1 | 1 }
  | { readonly type: "DAY"; readonly direction: "previous" | "next" }
  | { readonly type: "UNDO" };

export interface KeyLike {
  readonly code: string;
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

const SHIFT_KEYS: Readonly<Record<string, AssignmentCode>> = {
  KeyM: "M",
  KeyE: "E",
  KeyN: "N",
  KeyO: "OFF",
  // L for "long" (طولانی): ME is one assignment, not M then E.
  KeyL: "ME",
};

export function editorKeyCommand(event: KeyLike): EditorKeyCommand | null {
  if (event.altKey) return null;
  if (event.ctrlKey || event.metaKey)
    return event.code === "KeyZ" && !event.shiftKey ? { type: "UNDO" } : null;
  if (event.shiftKey) return null;

  const shift = SHIFT_KEYS[event.code];
  if (shift) return { type: "SET", shift };
  switch (event.code) {
    case "Delete":
    case "Backspace":
      return { type: "CLEAR" };
    case "ArrowDown":
      return { type: "ROW", delta: 1 };
    case "ArrowUp":
      return { type: "ROW", delta: -1 };
    case "ArrowLeft":
      return { type: "COLUMN", delta: 1 };
    case "ArrowRight":
      return { type: "COLUMN", delta: -1 };
    case "BracketLeft":
      return { type: "DAY", direction: "previous" };
    case "BracketRight":
      return { type: "DAY", direction: "next" };
    default:
      return null;
  }
}

/** The shortcut list shown to the user (keys as printed on the keyboard). */
export const shortcutHelp = (
  labels: ShiftLabels,
): readonly { keys: string; action: string }[] => [
  ...Object.entries(SHIFT_KEYS).map(([code, shift]) => ({
    keys: code.slice("Key".length),
    action: isWorkingShift(shift)
      ? `شیفت ${shiftFullName(shift, labels)}`
      : labels[shift],
  })),
  { keys: "Delete / Backspace", action: "تعیین‌نشده (پاک کردن)" },
  { keys: "↑ / ↓", action: "پرستار قبلی / بعدی" },
  { keys: "← / →", action: "گزینه بعدی / قبلی همان پرستار" },
  { keys: "[ / ]", action: "روز قبل / روز بعد" },
  { keys: "Ctrl+Z", action: "بازگردانی آخرین تغییر" },
];
