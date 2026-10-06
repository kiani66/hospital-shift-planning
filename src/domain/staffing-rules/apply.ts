import type { ScheduleStatus } from "../schedule/status";
import { InvalidStateError, ValidationError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import type { RuleSetVersionHead } from "./model";

/**
 * Applying another rule-set version to an existing schedule (D107): never
 * automatic, always previewed and confirmed. It changes only the pin; the
 * schedule's assignments are never touched.
 */

/** `InvalidStateError.attempted` values of a refused Apply. */
export const APPLY_RULE_SET_REFUSALS = {
  /** Frozen while the Supervisor reviews it; withdraw first (D10). */
  SUBMITTED: "APPLY_RULE_SET_WHILE_SUBMITTED",
  /** Approved schedules are immutable: the Head Nurse starts a revision first (D109). */
  APPROVED: "APPLY_RULE_SET_REQUIRES_REVISION",
} as const;

/** `ValidationError.reason` values of a target that cannot be applied. */
export const APPLY_RULE_SET_INVALID_TARGET = {
  NOT_PUBLISHED: "RULE_SET_NOT_PUBLISHED",
  NOT_APPLICABLE: "RULE_SET_NOT_APPLICABLE",
  ALREADY_PINNED: "RULE_SET_ALREADY_PINNED",
} as const;

export interface ApplyPlan {
  /**
   * The target is an earlier version of the same lineage as the current pin
   * (a controlled rollback; allowed, D107).
   */
  readonly rollback: boolean;
}

/**
 * Whether `target` may replace `current` as the pin of a schedule of
 * `departmentId` in `status`. Targets: any PUBLISHED or RETIRED version of
 * the Hospital Default or of the schedule's own department (older versions
 * included); never a DRAFT, never the current pin.
 */
export function planApplyRuleSet(input: {
  readonly status: ScheduleStatus;
  readonly departmentId: string;
  readonly current: RuleSetVersionHead;
  readonly target: RuleSetVersionHead;
}): Result<ApplyPlan, InvalidStateError | ValidationError> {
  const { status, current, target } = input;
  if (status === "SUBMITTED")
    return err(
      new InvalidStateError(status, APPLY_RULE_SET_REFUSALS.SUBMITTED),
    );
  if (status === "APPROVED")
    return err(new InvalidStateError(status, APPLY_RULE_SET_REFUSALS.APPROVED));
  if (target.status === "DRAFT")
    return err(
      new ValidationError(
        "A draft rule set cannot be applied",
        "targetVersionId",
        APPLY_RULE_SET_INVALID_TARGET.NOT_PUBLISHED,
      ),
    );
  if (
    target.departmentId !== null &&
    target.departmentId !== input.departmentId
  )
    return err(
      new ValidationError(
        "This rule set belongs to another department",
        "targetVersionId",
        APPLY_RULE_SET_INVALID_TARGET.NOT_APPLICABLE,
      ),
    );
  if (target.id === current.id)
    return err(
      new ValidationError(
        "The schedule already uses this rule set version",
        "targetVersionId",
        APPLY_RULE_SET_INVALID_TARGET.ALREADY_PINNED,
      ),
    );
  return ok({
    rollback:
      target.ruleSetId === current.ruleSetId &&
      target.versionNo < current.versionNo,
  });
}
