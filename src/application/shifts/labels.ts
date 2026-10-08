import {
  ASSIGNMENT_CODES,
  type AssignmentCode,
} from "../../domain/shifts/shift-type";
import { getDb } from "../../infrastructure/db/client";
import type { DbExecutor } from "../../infrastructure/db/database";
import {
  listShiftTypeLabels,
  type ShiftTypeLabelRecord,
} from "../../infrastructure/repositories/shift-types";

/**
 * The descriptive name of each explicit scheduling decision, from
 * `shift_types.label`. Keyed by the domain's codes: the codes and every rule
 * stay compile-time constants; only the human-readable names are data.
 */
export type ShiftLabels = Readonly<Record<AssignmentCode, string>>;

/** `shift_types` is missing a label the domain requires. */
export class ShiftReferenceDataError extends Error {
  override readonly name = "ShiftReferenceDataError";
}

/**
 * Maps exactly the domain's codes (M, E, N, ME, OFF). A missing or blank
 * label for one of them throws; rows with any other code are ignored, so a
 * row in the table never becomes a valid shift or assignment code.
 */
export function toShiftLabels(
  rows: readonly ShiftTypeLabelRecord[],
): ShiftLabels {
  const byCode = new Map(rows.map((r) => [r.code, r.label.trim()]));
  const entries = ASSIGNMENT_CODES.map((code) => {
    const label = byCode.get(code);
    if (!label)
      throw new ShiftReferenceDataError(
        `shift_types has no label for required code ${code}`,
      );
    return [code, label] as const;
  });
  return Object.freeze(Object.fromEntries(entries)) as ShiftLabels;
}

/** Loads the labels with one query. */
export async function getShiftLabels(db: DbExecutor): Promise<ShiftLabels> {
  return toShiftLabels(await listShiftTypeLabels(db));
}

/**
 * Reference data, the same for every user: needs no actor, so the sign-in
 * page can read it too. UI callers go through the per-request cached
 * `loadShiftLabels()` adapter.
 */
export const readShiftLabels = (): Promise<ShiftLabels> =>
  getShiftLabels(getDb());
