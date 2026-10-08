import { asc } from "drizzle-orm";

import type { DbExecutor } from "../db/database";
import { shiftTypes } from "../db/schema";

/** A `shift_types` row as stored: the code is not yet checked against the domain. */
export interface ShiftTypeLabelRecord {
  readonly code: string;
  readonly label: string;
}

/** Every shift type's code and display label (reference data), in display order. One query. */
export async function listShiftTypeLabels(
  db: DbExecutor,
): Promise<ShiftTypeLabelRecord[]> {
  return db
    .select({ code: shiftTypes.code, label: shiftTypes.label })
    .from(shiftTypes)
    .orderBy(asc(shiftTypes.sortOrder), asc(shiftTypes.code));
}
