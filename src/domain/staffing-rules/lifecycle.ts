import { compareIsoDates, type IsoDate } from "../shared/dates";
import { InvalidStateError, ValidationError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import type { RuleSetVersionHead } from "./model";

/**
 * Stored lifecycle of a version (D105): DRAFT → PUBLISHED → RETIRED, plus
 * discarding a never-published DRAFT. Nothing ever returns to DRAFT and no
 * PUBLISHED or RETIRED version is edited in place.
 */

const SUBJECT = "the rule set version";

/** `InvalidStateError.attempted` values of refused lifecycle operations. */
export const RULE_SET_REFUSALS = {
  EDIT: "EDIT_RULE_SET",
  DISCARD: "DISCARD_RULE_SET",
  PUBLISH: "PUBLISH_RULE_SET",
  RETIRE: "RETIRE_RULE_SET",
  /** A Hospital Default version that is already effective cannot be withdrawn. */
  RETIRE_EFFECTIVE_HOSPITAL_DEFAULT: "RETIRE_EFFECTIVE_HOSPITAL_DEFAULT",
} as const;

/** `ValidationError.reason` when a publication date lies in the past. */
export const EFFECTIVE_FROM_IN_PAST = "EFFECTIVE_FROM_IN_PAST";

const draftOnly = (
  version: RuleSetVersionHead,
  attempted: string,
): Result<void, InvalidStateError> =>
  version.status === "DRAFT"
    ? ok(undefined)
    : err(new InvalidStateError(version.status, attempted, SUBJECT));

/** Only a DRAFT may be changed. */
export const canEditDraft = (version: RuleSetVersionHead) =>
  draftOnly(version, RULE_SET_REFUSALS.EDIT);

/** Only a DRAFT may be discarded (it was never published, so nothing pins it). */
export const canDiscardDraft = (version: RuleSetVersionHead) =>
  draftOnly(version, RULE_SET_REFUSALS.DISCARD);

/**
 * The PUBLISHED versions of the lineage that a publication effective from
 * `effectiveFrom` conflicts with: every one effective on or after that day.
 * (Earlier ones simply stop being selected for later dates.) Sorted by date.
 */
export function publishConflicts(
  lineage: readonly RuleSetVersionHead[],
  effectiveFrom: IsoDate,
): RuleSetVersionHead[] {
  return lineage
    .filter(
      (v) =>
        v.status === "PUBLISHED" &&
        compareIsoDates(v.effectiveFrom!, effectiveFrom) >= 0,
    )
    .sort((a, b) => compareIsoDates(a.effectiveFrom!, b.effectiveFrom!));
}

/** Publication would replace scheduled versions that were not (all) confirmed. */
export interface PublishConflict {
  readonly type: "PUBLISH_CONFLICT";
  readonly conflicts: readonly RuleSetVersionHead[];
}

export interface PublishPlan {
  /** Versions to retire as REPLACED by the new one (confirmed by the caller). */
  readonly replace: readonly RuleSetVersionHead[];
}

/**
 * Decides whether `version` may be published effective from `effectiveFrom`.
 * The day is today ("effective immediately") or later, never in the past.
 * A conflict never resolves silently: the caller must confirm exactly the
 * conflicting versions (a stale or partial confirmation is a conflict again).
 */
export function planPublish(input: {
  readonly version: RuleSetVersionHead;
  readonly lineage: readonly RuleSetVersionHead[];
  readonly effectiveFrom: IsoDate;
  readonly today: IsoDate;
  readonly confirmReplace: readonly string[];
}): Result<PublishPlan, InvalidStateError | ValidationError | PublishConflict> {
  const draft = draftOnly(input.version, RULE_SET_REFUSALS.PUBLISH);
  if (!draft.ok) return draft;
  if (compareIsoDates(input.effectiveFrom, input.today) < 0)
    return err(
      new ValidationError(
        "A rule set cannot take effect in the past",
        "effectiveFrom",
        EFFECTIVE_FROM_IN_PAST,
      ),
    );
  const conflicts = publishConflicts(input.lineage, input.effectiveFrom);
  const confirmed = new Set(input.confirmReplace);
  const exact =
    confirmed.size === conflicts.length &&
    conflicts.every((c) => confirmed.has(c.id));
  if (!exact) return err({ type: "PUBLISH_CONFLICT", conflicts });
  return ok({ replace: conflicts });
}

/**
 * Whether a PUBLISHED version may be withdrawn (retired without
 * replacement). A Department Override always may: its department falls back
 * to the Hospital Default. A Hospital Default version only while it is still
 * scheduled, so the Hospital Default keeps covering every date from the
 * legacy baseline on.
 */
export function canRetire(
  version: RuleSetVersionHead,
  today: IsoDate,
): Result<void, InvalidStateError> {
  if (version.status !== "PUBLISHED")
    return err(
      new InvalidStateError(version.status, RULE_SET_REFUSALS.RETIRE, SUBJECT),
    );
  if (
    version.departmentId === null &&
    compareIsoDates(version.effectiveFrom!, today) <= 0
  )
    return err(
      new InvalidStateError(
        version.status,
        RULE_SET_REFUSALS.RETIRE_EFFECTIVE_HOSPITAL_DEFAULT,
        SUBJECT,
      ),
    );
  return ok(undefined);
}
