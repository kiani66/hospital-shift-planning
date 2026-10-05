import type { Actor } from "../../domain/authz/actor";
import { decide } from "../../domain/authz/policies";
import { violationDay } from "../../domain/rules/diagnostic";
import { isBlocking, type Violation } from "../../domain/rules/violation";
import {
  eventsFrom,
  PREFERENCE_WINDOW_OPEN,
  transition,
  type ScheduleEvent,
  type TransitionError,
} from "../../domain/schedule/state-machine";
import type { ScheduleStatus } from "../../domain/schedule/status";
import { uniqueSortedDates, type IsoDate } from "../../domain/shared/dates";
import {
  InvalidStateError,
  RuleViolationError,
} from "../../domain/shared/errors";
import type { DatePeriod } from "../../domain/shared/period";
import type { Result } from "../../domain/shared/result";
import type {
  SubmissionDecision,
  SubmissionRecord,
} from "../../infrastructure/repositories/submissions";

/**
 * The schedule's approval workflow as a screen needs it: where it stands,
 * the submission history that matters now, and which lifecycle actions the
 * actor may take, each with what still blocks it.
 *
 * Nothing here decides a rule of its own: an action is offered when the
 * state machine has the event from this status (`eventsFrom`) and the policy
 * allows the actor (`decide`); its blockers are the guards `transition`
 * reports. The commands check everything again inside their transaction, so
 * this is guidance for the UI, never the gate.
 */

/** Why an offered action cannot be taken yet. */
export type WorkflowBlocker = "BLOCKING_FINDINGS" | "PREFERENCE_WINDOW_OPEN";

/** An action the actor may take in this status; no blockers = possible now. */
export interface WorkflowAction {
  readonly blockers: readonly WorkflowBlocker[];
}

export interface WorkflowPerson {
  readonly userId: string;
  readonly displayName: string;
}

export interface WorkflowSubmission {
  readonly id: string;
  readonly submittedBy: WorkflowPerson;
  readonly submittedAt: Date;
  readonly decision: SubmissionDecision | null;
  readonly decidedBy: WorkflowPerson | null;
  readonly decidedAt: Date | null;
  /** The Supervisor's comment when returned. */
  readonly comment: string | null;
}

export interface ScheduleWorkflow {
  readonly status: ScheduleStatus;
  /** The submission awaiting the Supervisor (only in SUBMITTED). */
  readonly pending: WorkflowSubmission | null;
  /** The most recent decided submission (approved, returned or withdrawn). */
  readonly lastDecision: WorkflowSubmission | null;
  /** Blocking findings of the working copy and the period days they belong to. */
  readonly blockingFindings: {
    readonly count: number;
    readonly undecided: number;
    readonly staffing: number;
    readonly dates: readonly IsoDate[];
  };
  readonly preferenceWindowOpen: boolean;
  /** Null: not offered to this actor in this status. */
  readonly actions: {
    readonly finalize: WorkflowAction | null;
    readonly submit: WorkflowAction | null;
    readonly withdraw: WorkflowAction | null;
    readonly approve: WorkflowAction | null;
    readonly return: WorkflowAction | null;
    /**
     * Abandon the revision of an approved schedule (REVISING, or a returned
     * revision): the working copy goes back to the latest approved version.
     */
    readonly discardRevision: WorkflowAction | null;
  };
  /**
   * The actor is a Supervisor of the department but submitted the pending
   * submission themselves, so approve and return are not theirs (D60).
   */
  readonly ownSubmission: boolean;
}

const NO_BLOCKERS: WorkflowAction = { blockers: [] };

function blockersOf(
  result: Result<ScheduleStatus, TransitionError>,
): WorkflowBlocker[] {
  if (result.ok) return [];
  if (result.error instanceof RuleViolationError) return ["BLOCKING_FINDINGS"];
  if (
    result.error instanceof InvalidStateError &&
    result.error.attempted === PREFERENCE_WINDOW_OPEN
  )
    return ["PREFERENCE_WINDOW_OPEN"];
  return [];
}

export function describeWorkflow(
  actor: Actor,
  input: {
    readonly schedule: {
      readonly departmentId: string;
      readonly period: DatePeriod;
      readonly status: ScheduleStatus;
      /** The latest approved version, if any (a revision needs one). */
      readonly currentVersionId?: string | null;
    };
    readonly violations: readonly Violation[];
    readonly activePreferenceWindows: number;
    /** Every submission of the schedule, oldest first. */
    readonly submissions: readonly SubmissionRecord[];
    readonly names: ReadonlyMap<string, string>;
  },
): ScheduleWorkflow {
  const { schedule, violations, activePreferenceWindows } = input;
  const { status, departmentId } = schedule;
  const person = (userId: string): WorkflowPerson => ({
    userId,
    displayName: input.names.get(userId) ?? "—",
  });
  const toSubmission = (s: SubmissionRecord): WorkflowSubmission => ({
    id: s.id,
    submittedBy: person(s.submittedBy),
    submittedAt: s.submittedAt,
    decision: s.decision,
    decidedBy: s.decidedBy ? person(s.decidedBy) : null,
    decidedAt: s.decidedAt,
    comment: s.decisionComment,
  });
  const pendingRecord =
    status === "SUBMITTED"
      ? input.submissions.find((s) => s.decision === null)
      : undefined;
  const lastDecided = input.submissions.findLast((s) => s.decision !== null);

  const has = (event: ScheduleEvent) => eventsFrom(status).includes(event);
  const headNurse = (
    event: ScheduleEvent,
    action: "schedule.finalize" | "schedule.submit" | "schedule.withdraw",
  ) => has(event) && decide(actor, action, { departmentId }).allowed;

  const supervisorDecision = pendingRecord
    ? decide(actor, "schedule.approve", {
        departmentId,
        submittedBy: pendingRecord.submittedBy,
      })
    : null;
  const mayDecide = supervisorDecision?.allowed === true;

  const blocking = violations.filter(isBlocking);
  return {
    status,
    pending: pendingRecord ? toSubmission(pendingRecord) : null,
    lastDecision: lastDecided ? toSubmission(lastDecided) : null,
    blockingFindings: {
      count: blocking.length,
      undecided: blocking.filter((v) => v.rule === "UNDECIDED").length,
      staffing: blocking.filter((v) => v.rule === "STAFFING").length,
      dates: uniqueSortedDates(
        blocking.flatMap((v) => violationDay(v, schedule.period) ?? []),
      ),
    },
    preferenceWindowOpen: activePreferenceWindows > 0,
    actions: {
      finalize: headNurse("FINALIZE", "schedule.finalize")
        ? {
            blockers: blockersOf(
              transition(status, { type: "FINALIZE", violations }),
            ),
          }
        : null,
      submit: headNurse("SUBMIT", "schedule.submit")
        ? {
            // Both guards, each on its own, so the Head Nurse sees every blocker.
            blockers: [
              ...blockersOf(
                transition(status, {
                  type: "SUBMIT",
                  violations,
                  activePreferenceWindows: 0,
                }),
              ),
              ...blockersOf(
                transition(status, {
                  type: "SUBMIT",
                  violations: [],
                  activePreferenceWindows,
                }),
              ),
            ],
          }
        : null,
      withdraw:
        pendingRecord && headNurse("WITHDRAW", "schedule.withdraw")
          ? NO_BLOCKERS
          : null,
      approve: has("APPROVE") && mayDecide ? NO_BLOCKERS : null,
      return: has("RETURN") && mayDecide ? NO_BLOCKERS : null,
      discardRevision:
        has("DISCARD_REVISION") &&
        decide(actor, "schedule.discardRevision", { departmentId }).allowed &&
        transition(status, {
          type: "DISCARD_REVISION",
          hasApprovedVersion: (schedule.currentVersionId ?? null) !== null,
        }).ok
          ? NO_BLOCKERS
          : null,
    },
    ownSubmission:
      supervisorDecision?.allowed === false &&
      supervisorDecision.reason === "SELF_APPROVAL",
  };
}

/** The users `describeWorkflow` names (submitters and deciders). */
export const workflowPeople = (
  submissions: readonly SubmissionRecord[],
): string[] => [
  ...new Set(
    submissions.flatMap((s) => [
      s.submittedBy,
      ...(s.decidedBy ? [s.decidedBy] : []),
    ]),
  ),
];
