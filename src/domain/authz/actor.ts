export type MembershipRole = "NURSE" | "HEAD_NURSE";

export interface Membership {
  readonly departmentId: string;
  /** A HEAD_NURSE is also a nurse of the department (rostered, can be scheduled). */
  readonly role: MembershipRole;
}

/**
 * The authenticated user as the domain sees it. Built by the application layer
 * from the database on every request; never trusted from the session token.
 *
 * `memberships` and `supervisedDepartmentIds` are current (active) relations
 * only. Historical relations (a former nurse's own requests and rostered
 * schedules) are expressed on the resource being accessed, not here.
 */
export interface Actor {
  readonly userId: string;
  readonly isActive: boolean;
  readonly memberships: readonly Membership[];
  readonly supervisedDepartmentIds: readonly string[];
}

export const isMemberOf = (actor: Actor, departmentId: string): boolean =>
  actor.memberships.some((m) => m.departmentId === departmentId);

export const isHeadNurseOf = (actor: Actor, departmentId: string): boolean =>
  actor.memberships.some(
    (m) => m.departmentId === departmentId && m.role === "HEAD_NURSE",
  );

export const isSupervisorOf = (actor: Actor, departmentId: string): boolean =>
  actor.supervisedDepartmentIds.includes(departmentId);
