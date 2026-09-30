import type { MembershipRole } from "../../domain/authz/actor";
import { decide } from "../../domain/authz/policies";
import {
  findDepartmentByCode,
  listDepartmentsByIds,
} from "../../infrastructure/repositories/departments";
import { findUserById } from "../../infrastructure/repositories/users";
import { NotFoundError } from "../errors";
import { getUnreadNotificationCount } from "../notifications/queries";
import type { AppContext } from "../use-case";

export interface DepartmentSummary {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

/** What the authenticated shell shows: all of it derived from the trusted actor. */
export interface ShellContext {
  readonly user: { readonly displayName: string; readonly email: string };
  /** Current memberships (a HEAD_NURSE is also a nurse), ordered by department code. */
  readonly memberships: readonly {
    readonly department: DepartmentSummary;
    readonly role: MembershipRole;
  }[];
  /** Departments the user currently supervises, ordered by code. */
  readonly supervised: readonly DepartmentSummary[];
  /** The actor's unread notifications (a COUNT; the list is never loaded for it). */
  readonly unreadNotifications: number;
}

/** Loads the names the shell needs for the actor's current relations. */
export async function getShellContext(ctx: AppContext): Promise<ShellContext> {
  const { db, actor } = ctx;
  const [user, unreadNotifications] = await Promise.all([
    findUserById(db, actor.userId),
    getUnreadNotificationCount(ctx),
  ]);
  if (!user) throw new NotFoundError("User");

  const ids = [
    ...actor.memberships.map((m) => m.departmentId),
    ...actor.supervisedDepartmentIds,
  ];
  const departments = new Map(
    (await listDepartmentsByIds(db, [...new Set(ids)])).map((d) => [
      d.id,
      { id: d.id, code: d.code, name: d.name },
    ]),
  );
  const byCode = (a: DepartmentSummary, b: DepartmentSummary) =>
    a.code.localeCompare(b.code);

  return {
    user: { displayName: user.displayName, email: user.email },
    memberships: actor.memberships
      .flatMap((m) => {
        const department = departments.get(m.departmentId);
        return department ? [{ department, role: m.role }] : [];
      })
      .sort((a, b) => byCode(a.department, b.department)),
    supervised: actor.supervisedDepartmentIds
      .flatMap((id) => departments.get(id) ?? [])
      .sort(byCode),
    unreadNotifications,
  };
}

/** Department pages and the policy action that guards them. */
export type DepartmentPageAction = "department.manage" | "audit.view";

/**
 * The department behind a URL segment, if the actor may open it for
 * `action`. An unknown code and a denied one both raise the same
 * NotFoundError, so a guessed URL does not reveal that a department exists.
 */
export async function getDepartmentForPage(
  ctx: AppContext,
  code: string,
  action: DepartmentPageAction,
): Promise<DepartmentSummary> {
  const department = await findDepartmentByCode(ctx.db, code);
  if (
    !department ||
    !department.isActive ||
    !decide(ctx.actor, action, { departmentId: department.id }).allowed
  )
    throw new NotFoundError("Department");
  return { id: department.id, code: department.code, name: department.name };
}

/** The departments the actor supervises, or NotFoundError if none. */
export async function getReviewDepartments(
  ctx: AppContext,
): Promise<readonly DepartmentSummary[]> {
  const departments = await listDepartmentsByIds(
    ctx.db,
    ctx.actor.supervisedDepartmentIds,
  );
  if (!ctx.actor.isActive || departments.length === 0)
    throw new NotFoundError("Review");
  return departments.map(({ id, code, name }) => ({ id, code, name }));
}
