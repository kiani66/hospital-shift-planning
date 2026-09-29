import { allow, deny, type Decision } from "../shared/decision";
import { ForbiddenError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import type { ScheduleStatus } from "../schedule/status";
import { isHeadNurseOf, isMemberOf, isSupervisorOf, type Actor } from "./actor";

/** Head Nurse actions on a department's schedules. */
const HEAD_NURSE_ACTIONS = [
  "schedule.create",
  "schedule.openPreferences",
  "schedule.closePreferences",
  "schedule.startPlanning",
  "schedule.editRoster",
  "schedule.reopenPreferences",
  "schedule.finalize",
  "schedule.submit",
  "schedule.withdraw",
  "schedule.startRevision",
  "schedule.discardRevision",
  "assignment.edit",
  "assignment.prefill",
  "changeRequest.review",
] as const;

type HeadNurseAction = (typeof HEAD_NURSE_ACTIONS)[number];

interface DepartmentResource {
  readonly departmentId: string;
}

/** The resource each action is decided against. Status gating is the state machine's job. */
export interface ActionResources extends Record<
  HeadNurseAction,
  DepartmentResource
> {
  /** Department grid: every nurse's preferences and assignments. */
  "schedule.viewDepartment": DepartmentResource & {
    readonly status: ScheduleStatus;
  };
  "schedule.viewOwn": DepartmentResource;
  "schedule.approve": DepartmentResource & { readonly submittedBy: string };
  "schedule.return": DepartmentResource & { readonly submittedBy: string };
  "audit.view": DepartmentResource;
  "preference.editOwn": DepartmentResource;
  "changeRequest.submit": DepartmentResource & {
    readonly status: ScheduleStatus;
  };
  "changeRequest.view": DepartmentResource & { readonly requesterId: string };
}

export type Action = keyof ActionResources;

export type AuthzDenial =
  | "ACTOR_INACTIVE"
  | "NOT_HEAD_NURSE_OF_DEPARTMENT"
  | "NOT_MEMBER_OF_DEPARTMENT"
  | "NOT_SUPERVISOR_OF_DEPARTMENT"
  | "NO_DEPARTMENT_ACCESS"
  | "SELF_APPROVAL"
  | "SCHEDULE_NOT_YET_FINALIZED";

/** Statuses from which a schedule is visible outside the Head Nurse's planning. */
const FINALIZED_OR_LATER: readonly ScheduleStatus[] = [
  "FINALIZED",
  "SUBMITTED",
  "RETURNED",
  "APPROVED",
  "REVISING",
];

const isHeadNurseAction = (action: Action): action is HeadNurseAction =>
  (HEAD_NURSE_ACTIONS as readonly string[]).includes(action);

/**
 * Who may do what (approved authorization matrix). Pure and exhaustive; the
 * application layer calls it at the start of every use case.
 */
export function decide<A extends Action>(
  actor: Actor,
  action: A,
  resource: ActionResources[A],
): Decision<AuthzDenial> {
  if (!actor.isActive) return deny("ACTOR_INACTIVE");
  const { departmentId } = resource;
  const headNurse = isHeadNurseOf(actor, departmentId);
  const supervisor = isSupervisorOf(actor, departmentId);

  if (isHeadNurseAction(action))
    return headNurse ? allow : deny("NOT_HEAD_NURSE_OF_DEPARTMENT");

  // Narrow the resource by action for the remaining, resource-specific rules.
  const r = resource as ActionResources[Exclude<Action, HeadNurseAction>];
  switch (action as Exclude<Action, HeadNurseAction>) {
    case "schedule.viewDepartment": {
      if (headNurse) return allow;
      if (!supervisor) return deny("NO_DEPARTMENT_ACCESS");
      const { status } = r as ActionResources["schedule.viewDepartment"];
      return FINALIZED_OR_LATER.includes(status)
        ? allow
        : deny("SCHEDULE_NOT_YET_FINALIZED");
    }
    case "schedule.approve":
    case "schedule.return": {
      if (!supervisor) return deny("NOT_SUPERVISOR_OF_DEPARTMENT");
      const { submittedBy } = r as ActionResources["schedule.approve"];
      return submittedBy === actor.userId ? deny("SELF_APPROVAL") : allow;
    }
    case "audit.view":
      return headNurse || supervisor ? allow : deny("NO_DEPARTMENT_ACCESS");
    case "schedule.viewOwn":
    case "preference.editOwn":
      return isMemberOf(actor, departmentId)
        ? allow
        : deny("NOT_MEMBER_OF_DEPARTMENT");
    case "changeRequest.submit": {
      if (!isMemberOf(actor, departmentId))
        return deny("NOT_MEMBER_OF_DEPARTMENT");
      const { status } = r as ActionResources["changeRequest.submit"];
      return FINALIZED_OR_LATER.includes(status)
        ? allow
        : deny("SCHEDULE_NOT_YET_FINALIZED");
    }
    case "changeRequest.view": {
      const { requesterId } = r as ActionResources["changeRequest.view"];
      const own =
        requesterId === actor.userId && isMemberOf(actor, departmentId);
      return own || headNurse || supervisor
        ? allow
        : deny("NO_DEPARTMENT_ACCESS");
    }
  }
}

/** `decide` as a Result, for use cases that stop on the first failure. */
export function authorize<A extends Action>(
  actor: Actor,
  action: A,
  resource: ActionResources[A],
): Result<void, ForbiddenError> {
  const decision = decide(actor, action, resource);
  return decision.allowed
    ? ok(undefined)
    : err(new ForbiddenError(decision.reason));
}
