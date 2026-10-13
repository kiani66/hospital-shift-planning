import { err, ok, type Result } from "../shared/result";
import type { AssignmentCode } from "./shift-type";

/**
 * The day codes of the department's Excel schedules mapped to scheduling
 * decisions (D118). Prepared for a future schedule import; nothing imports
 * schedules yet. Only verified codes are listed: a code missing here is
 * reported, never guessed, and `H` is leave, never OFF.
 */
export const SPREADSHEET_DAY_CODES: Readonly<Record<string, AssignmentCode>> = {
  M: "M",
  E: "E",
  N: "N",
  ME: "ME",
  OFF: "OFF",
  H: "H",
};

export type SpreadsheetDayCode =
  /** A recorded decision. */
  | { readonly kind: "DECISION"; readonly code: AssignmentCode }
  /** An empty cell: UNDECIDED (no row), never OFF (D100). */
  | { readonly kind: "EMPTY" };

/**
 * Reads one cell. Surrounding whitespace and letter case are ignored
 * (`" h "` is H); anything else unknown is an error carrying the raw value,
 * so an importer can report the cell instead of inventing a decision.
 */
export function parseSpreadsheetDayCode(
  raw: string,
): Result<SpreadsheetDayCode, { readonly unknownCode: string }> {
  const value = raw.trim().toUpperCase();
  if (value === "") return ok({ kind: "EMPTY" });
  const code = Object.hasOwn(SPREADSHEET_DAY_CODES, value)
    ? SPREADSHEET_DAY_CODES[value]
    : undefined;
  return code
    ? ok({ kind: "DECISION", code })
    : err({ unknownCode: raw.trim() });
}
