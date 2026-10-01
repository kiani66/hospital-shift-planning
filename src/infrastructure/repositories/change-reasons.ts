import { asc, eq } from "drizzle-orm";

import type {
  ChangeReason,
  ReasonScope,
} from "../../domain/change-requests/reason";
import type { DbExecutor } from "../db/database";
import { changeReasons } from "../db/schema";

/** A reason with its display label (master data, migration 0007). */
export interface ChangeReasonRecord extends ChangeReason {
  readonly label: string;
  readonly sortOrder: number;
}

const columns = {
  code: changeReasons.code,
  label: changeReasons.label,
  scope: changeReasons.scope,
  requiresNote: changeReasons.requiresNote,
  isActive: changeReasons.isActive,
  sortOrder: changeReasons.sortOrder,
};

/** Every reason, active or not (history still shows retired ones), in display order. */
export async function listChangeReasons(
  db: DbExecutor,
): Promise<ChangeReasonRecord[]> {
  return db
    .select(columns)
    .from(changeReasons)
    .orderBy(asc(changeReasons.sortOrder), asc(changeReasons.code));
}

export async function findChangeReason(
  db: DbExecutor,
  code: string,
): Promise<ChangeReasonRecord | null> {
  const [row] = await db
    .select(columns)
    .from(changeReasons)
    .where(eq(changeReasons.code, code));
  return row ?? null;
}

/** Reasons that may be chosen now for `usage` (active, matching scope). */
export const selectableReasons = (
  reasons: readonly ChangeReasonRecord[],
  usage: Exclude<ReasonScope, "BOTH">,
): ChangeReasonRecord[] =>
  reasons.filter(
    (r) => r.isActive && (r.scope === "BOTH" || r.scope === usage),
  );
