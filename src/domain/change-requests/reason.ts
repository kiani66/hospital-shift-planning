import { ValidationError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";

/**
 * Change reasons are structured master data (reportable), referenced by a
 * stable code. A reason is never deleted once used; it is deactivated, and
 * an inactive reason cannot be chosen for new requests or adjustments.
 */
export const REASON_SCOPES = ["REQUEST", "ADJUSTMENT", "BOTH"] as const;

/** Where a reason may be chosen: nurse requests, Head Nurse adjustments, or both. */
export type ReasonScope = (typeof REASON_SCOPES)[number];

export type ReasonUsage = Exclude<ReasonScope, "BOTH">;

/** "Other": always needs an explanatory note. */
export const OTHER_REASON_CODE = "OTHER";

/** Upper bound of a request, rejection or adjustment note (plain text). */
export const CHANGE_NOTE_MAX_LENGTH = 500;

export interface ChangeReason {
  readonly code: string;
  readonly scope: ReasonScope;
  readonly requiresNote: boolean;
  readonly isActive: boolean;
}

export interface CheckedReason {
  readonly reasonCode: string;
  /** Trimmed; null when empty. */
  readonly note: string | null;
}

/** A trimmed note, null when blank; too long is a VALIDATION error on `field`. */
export function normalizeNote(
  note: string | null | undefined,
  field = "note",
): Result<string | null, ValidationError> {
  const trimmed = note?.trim() ?? "";
  if (trimmed.length > CHANGE_NOTE_MAX_LENGTH)
    return err(
      new ValidationError(
        `The note may have at most ${CHANGE_NOTE_MAX_LENGTH} characters`,
        field,
      ),
    );
  return ok(trimmed === "" ? null : trimmed);
}

/**
 * Checks the chosen reason (null when the code is unknown) and its note:
 * the reason must exist, be active and be allowed for `usage`; "Other" and
 * any reason marked `requiresNote` need a non-blank note.
 */
export function checkReason(input: {
  readonly reason: ChangeReason | null;
  readonly usage: ReasonUsage;
  readonly note: string | null | undefined;
}): Result<CheckedReason, ValidationError> {
  const { reason, usage } = input;
  if (
    !reason ||
    !reason.isActive ||
    (reason.scope !== "BOTH" && reason.scope !== usage)
  )
    return err(
      new ValidationError(
        "The reason is unknown or not available",
        "reasonCode",
      ),
    );
  const note = normalizeNote(input.note);
  if (!note.ok) return note;
  if ((reason.requiresNote || reason.code === OTHER_REASON_CODE) && !note.value)
    return err(new ValidationError("This reason needs an explanation", "note"));
  return ok({ reasonCode: reason.code, note: note.value });
}
