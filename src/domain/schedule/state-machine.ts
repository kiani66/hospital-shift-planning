import {
  InvalidStateError,
  RuleViolationError,
  ValidationError,
} from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import {
  hasBlockingViolations,
  isBlocking,
  type Violation,
} from "../rules/violation";
import type { ScheduleStatus } from "./status";

/**
 * Workflow commands. Guard inputs travel with the command so the transition
 * function stays pure; the use case gathers them inside its transaction.
 */
export type ScheduleCommand =
  | { readonly type: "OPEN_PREFERENCES" }
  | { readonly type: "START_PLANNING" }
  | { readonly type: "FINALIZE"; readonly violations: readonly Violation[] }
  | {
      readonly type: "SUBMIT";
      readonly violations: readonly Violation[];
      readonly activePreferenceWindows: number;
    }
  | { readonly type: "WITHDRAW"; readonly hasApprovedVersion: boolean }
  | { readonly type: "APPROVE" }
  | { readonly type: "RETURN"; readonly comment: string }
  | { readonly type: "START_REVISION" }
  | { readonly type: "DISCARD_REVISION"; readonly hasApprovedVersion: boolean };

export type ScheduleEvent = ScheduleCommand["type"];

export const TRANSITIONS = {
  DRAFT: { OPEN_PREFERENCES: "PLANNING", START_PLANNING: "PLANNING" },
  PLANNING: { FINALIZE: "FINALIZED" },
  FINALIZED: { SUBMIT: "SUBMITTED" },
  SUBMITTED: { APPROVE: "APPROVED", RETURN: "RETURNED", WITHDRAW: "FINALIZED" },
  RETURNED: { SUBMIT: "SUBMITTED", DISCARD_REVISION: "APPROVED" },
  APPROVED: { START_REVISION: "REVISING" },
  REVISING: { SUBMIT: "SUBMITTED", DISCARD_REVISION: "APPROVED" },
} as const satisfies Record<
  ScheduleStatus,
  Partial<Record<ScheduleEvent, ScheduleStatus>>
>;

/** Events whose target is defined for `status` (guards not evaluated). */
export function eventsFrom(status: ScheduleStatus): ScheduleEvent[] {
  return Object.keys(TRANSITIONS[status]) as ScheduleEvent[];
}

export type TransitionError =
  InvalidStateError | RuleViolationError | ValidationError;

/**
 * `InvalidStateError.attempted` when SUBMIT is refused because preference
 * collection is still open (stable, machine-readable; the UI words it).
 */
export const PREFERENCE_WINDOW_OPEN = "PREFERENCE_WINDOW_OPEN";

/**
 * Computes the next status or explains why the command is not allowed.
 *
 * Guards:
 * - FINALIZE / SUBMIT: blocked by any error-severity violation (e.g. night-rest).
 * - SUBMIT: blocked while a preference window is still active.
 * - RETURN: a non-blank comment is required.
 * - DISCARD_REVISION from RETURNED: only when an approved version exists.
 * - WITHDRAW of a revision's submission returns to REVISING instead of FINALIZED.
 */
export function transition(
  from: ScheduleStatus,
  command: ScheduleCommand,
): Result<ScheduleStatus, TransitionError> {
  const targets: Partial<Record<ScheduleEvent, ScheduleStatus>> =
    TRANSITIONS[from];
  const target = targets[command.type];
  if (!target) return err(new InvalidStateError(from, command.type));

  switch (command.type) {
    case "FINALIZE":
    case "SUBMIT": {
      if (hasBlockingViolations(command.violations)) {
        return err(
          new RuleViolationError(command.violations.filter(isBlocking)),
        );
      }
      if (command.type === "SUBMIT" && command.activePreferenceWindows > 0) {
        return err(new InvalidStateError(from, PREFERENCE_WINDOW_OPEN));
      }
      return ok(target);
    }
    case "RETURN":
      return command.comment.trim()
        ? ok(target)
        : err(
            new ValidationError(
              "A comment is required when returning a schedule",
              "comment",
            ),
          );
    case "DISCARD_REVISION":
      return command.hasApprovedVersion
        ? ok(target)
        : err(
            new InvalidStateError(
              from,
              "DISCARD_REVISION without an approved version",
            ),
          );
    case "WITHDRAW":
      // A withdrawn revision goes back to REVISING; a first submission to FINALIZED.
      return ok(command.hasApprovedVersion ? "REVISING" : target);
    default:
      return ok(target);
  }
}
