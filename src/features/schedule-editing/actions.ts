"use server";

import { refresh } from "next/cache";

import { setAssignments } from "@/application/schedules/edit-assignments";
import type { AssignmentChange } from "@/domain/schedule/assignment-editing";
import { requireRequestContext } from "@/features/auth/guards";

import { editFailure, type EditFailure } from "./presentation";

export type AssignmentEditResult =
  | {
      readonly ok: true;
      readonly revision: number;
      readonly changes: readonly AssignmentChange[];
    }
  | ({ readonly ok: false } & EditFailure);

/**
 * Thin adapter: load the trusted actor, call the use case, translate the
 * result. The browser sends a schedule id, the revision it saw and the cells
 * to change; the use case validates them (Zod), authorizes against the
 * schedule's own department and decides everything else.
 *
 * Every outcome refreshes the page in the same response: after a success the
 * month (health of every day, including the neighbours a night-rest change
 * affects) and the day are re-read from the database; after a conflict or a
 * lock the user sees the current state instead of a stale one.
 */
export async function setAssignmentsAction(
  input: unknown,
): Promise<AssignmentEditResult> {
  const ctx = await requireRequestContext();
  const result = await setAssignments(ctx, input);
  refresh();
  return result.ok
    ? { ok: true, revision: result.data.revision, changes: result.data.changes }
    : { ok: false, ...editFailure(result.error) };
}
