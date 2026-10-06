import { allow, deny, type Decision } from "../shared/decision";
import { ForbiddenError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import type { ScheduleStatus } from "../schedule/status";
import { isHeadNurseOf, isMemberOf, isSupervisorOf, type Actor } from "./actor";

/** Head Nurse actions on a department's schedules. */
const HEAD_NURSE_ACTIONS = [
  /** The department workspace (schedule planning and history pages). */
  "department.manage",
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
  /** The department's request queue: list, inspect, preview and reject. */
  "changeRequest.review",
  /** Apply a request to the schedule (the only way a request changes it). */
  "changeRequest.apply",
  /** A direct operational change with a reason (no nurse request needed). */
  "schedule.adjust",
] as const;

/** Administrative writes are system-scoped, never inferred from department.manage. */
export const HOSPITAL_ADMIN_ACTIONS = [
  "user.list",
  "user.create",
  "user.updateProfile",
  "user.setActive",
  "user.setHospitalAdmin",
  "membership.add",
  "membership.end",
  "membership.transition",
  "supervisor.assign",
  "supervisor.end",
  /** Assign a missing personnel number (legacy backfill) or correct a wrong one. */
  "user.setPersonnelNumber",
  /** Generate a one-time temporary password (never for the admin's own account). */
  "user.issueTemporaryPassword",
  /** Preview and commit a CSV personnel import. */
  "personnel.import",
  /**
   * Staffing/coverage rule sets (D108): drafts, date exceptions, publish
   * and retire, for the Hospital Default and every Department Override.
   */
  "staffingRules.manage",
] as const;
export type HospitalAdminAction = (typeof HOSPITAL_ADMIN_ACTIONS)[number];

type HeadNurseAction = (typeof HEAD_NURSE_ACTIONS)[number];

interface DepartmentResource {
  readonly departmentId: string;
}

/** The resource each action is decided against. Status gating is the state machine's job. */
export interface ActionResources
  extends
    Record<HeadNurseAction, DepartmentResource>,
    Record<HospitalAdminAction, Record<string, never>> {
  "personnel.view": DepartmentResource;
  /**
   * A department's applicable rule-set versions (its override and the
   * Hospital Default), its schedules' pins and the read-only history (D108).
   */
  "staffingRules.view": DepartmentResource;
  /**
   * Preview and apply another rule-set version to one of the department's
   * schedules, seeing aggregate schedule data only (D107, D108). Not a
   * general schedule read: `schedule.viewDepartment` is unchanged.
   */
  "staffingRules.applyToSchedule": DepartmentResource;
  /** Department grid: every nurse's preferences and assignments. */
  "schedule.viewDepartment": DepartmentResource & {
    readonly status: ScheduleStatus;
  };
  /**
   * The actor's own shifts in one schedule. `onRoster` is true when the actor is
   * or was rostered on it, which keeps history readable after leaving (D16).
   */
  "schedule.viewOwn": DepartmentResource & { readonly onRoster: boolean };
  "schedule.approve": DepartmentResource & { readonly submittedBy: string };
  "schedule.return": DepartmentResource & { readonly submittedBy: string };
  "audit.view": DepartmentResource;
  "preference.editOwn": DepartmentResource;
  "changeRequest.submit": DepartmentResource & {
    readonly status: ScheduleStatus;
  };
  "changeRequest.view": DepartmentResource & {
    readonly requesterId: string;
    /** The swap partner of a SWAP request (who may read it to answer it). */
    readonly counterpartId?: string | null;
  };
  /** Cancelling or refreshing one's own pending request (the requester's only changes to it). */
  "changeRequest.cancel": DepartmentResource & {
    readonly requesterId: string;
  };
  /** Consenting to (or declining) a swap one is named in. */
  "changeRequest.consent": DepartmentResource & {
    readonly counterpartId: string;
  };
  /**
   * The actor's own in-app notifications (list, count, mark read). Not tied
   * to a department: ownership is the only rule, so a former member keeps
   * their notifications (D16) and nobody else ever sees them.
   */
  "notification.access": { readonly recipientId: string };
  /**
   * Changing one's own password (self-service, or forced after a temporary
   * password). Ownership is the only rule, like notifications: no membership
   * is needed and nobody may change someone else's password through it.
   */
  "account.changeOwnPassword": { readonly userId: string };
}

export type Action = keyof ActionResources;

export type AuthzDenial =
  | "ACTOR_INACTIVE"
  | "NOT_HOSPITAL_ADMIN"
  | "NOT_ACCOUNT_OWNER"
  | "NOT_HEAD_NURSE_OF_DEPARTMENT"
  | "NOT_MEMBER_OF_DEPARTMENT"
  | "NOT_COUNTERPART"
  | "NOT_RECIPIENT"
  | "NOT_REQUESTER"
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
  if (action === "notification.access") {
    const { recipientId } = resource as ActionResources["notification.access"];
    return recipientId === actor.userId ? allow : deny("NOT_RECIPIENT");
  }
  if (action === "account.changeOwnPassword") {
    const { userId } = resource as ActionResources["account.changeOwnPassword"];
    return userId === actor.userId ? allow : deny("NOT_ACCOUNT_OWNER");
  }
  if ((HOSPITAL_ADMIN_ACTIONS as readonly string[]).includes(action))
    return actor.isHospitalAdmin ? allow : deny("NOT_HOSPITAL_ADMIN");
  if (action === "personnel.view" || action === "staffingRules.view") {
    const { departmentId } = resource as DepartmentResource;
    return actor.isHospitalAdmin ||
      isHeadNurseOf(actor, departmentId) ||
      isSupervisorOf(actor, departmentId)
      ? allow
      : deny("NO_DEPARTMENT_ACCESS");
  }
  if (action === "staffingRules.applyToSchedule") {
    // Never the Head Nurse: they read the rules but do not choose them (D108).
    const { departmentId } = resource as DepartmentResource;
    return actor.isHospitalAdmin || isSupervisorOf(actor, departmentId)
      ? allow
      : deny("NOT_SUPERVISOR_OF_DEPARTMENT");
  }
  const { departmentId } = resource as DepartmentResource;
  const headNurse = isHeadNurseOf(actor, departmentId);
  const supervisor = isSupervisorOf(actor, departmentId);

  if (isHeadNurseAction(action))
    return headNurse ? allow : deny("NOT_HEAD_NURSE_OF_DEPARTMENT");

  // Narrow the resource by action for the remaining, resource-specific rules.
  type DepartmentAction = Exclude<
    Action,
    | HeadNurseAction
    | HospitalAdminAction
    | "personnel.view"
    | "staffingRules.view"
    | "staffingRules.applyToSchedule"
    | "notification.access"
    | "account.changeOwnPassword"
  >;
  const r = resource as ActionResources[DepartmentAction];
  switch (action as DepartmentAction) {
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
    case "schedule.viewOwn": {
      // Historical access (D16): a former member keeps read-only access to the
      // schedules they were rostered on; visibility rules still apply.
      const { onRoster } = r as ActionResources["schedule.viewOwn"];
      return isMemberOf(actor, departmentId) || onRoster
        ? allow
        : deny("NOT_MEMBER_OF_DEPARTMENT");
    }
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
      // Requesters keep read-only access to their own requests after leaving
      // (D16); a swap partner reads the request they are asked about.
      const { requesterId, counterpartId } =
        r as ActionResources["changeRequest.view"];
      return requesterId === actor.userId ||
        (counterpartId != null && counterpartId === actor.userId) ||
        headNurse ||
        supervisor
        ? allow
        : deny("NO_DEPARTMENT_ACCESS");
    }
    case "changeRequest.cancel": {
      const { requesterId } = r as ActionResources["changeRequest.cancel"];
      if (requesterId !== actor.userId) return deny("NOT_REQUESTER");
      // Changing a request needs active membership; history is read-only (D16).
      return isMemberOf(actor, departmentId)
        ? allow
        : deny("NOT_MEMBER_OF_DEPARTMENT");
    }
    case "changeRequest.consent": {
      // Only the named partner answers, and only for themselves.
      const { counterpartId } = r as ActionResources["changeRequest.consent"];
      if (counterpartId !== actor.userId) return deny("NOT_COUNTERPART");
      return isMemberOf(actor, departmentId)
        ? allow
        : deny("NOT_MEMBER_OF_DEPARTMENT");
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
