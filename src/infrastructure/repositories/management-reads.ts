import { and, asc, eq, exists, ilike, inArray, or, sql } from "drizzle-orm";

import type { MembershipRole } from "../../domain/authz/actor";
import type { IsoDate } from "../../domain/shared/dates";
import type { DbExecutor } from "../db/database";
import {
  departments,
  departmentMemberships,
  supervisorAssignments,
  users,
} from "../db/schema";
import { activeOn } from "./memberships";

const accountColumns = {
  id: users.id,
  displayName: users.displayName,
  personnelNumber: users.personnelNumber,
  email: users.email,
  mobile: users.mobile,
  isActive: users.isActive,
  isHospitalAdmin: users.isHospitalAdmin,
};
const departmentColumns = {
  id: departments.id,
  code: departments.code,
  name: departments.name,
  isActive: departments.isActive,
};

export interface PersonnelFilters {
  search: string;
  active: "all" | "active" | "inactive";
  admin: "all" | "admin" | "other";
  departmentId?: string;
  role?: MembershipRole;
  page: number;
}

/** Filter relations in SQL before pagination; department + role must match one current row. */
export async function readPersonnelPage(
  db: DbExecutor,
  input: PersonnelFilters,
  today: IsoDate,
) {
  const pattern = `%${input.search.replace(/[\\%_]/g, "\\$&")}%`;
  const membership = exists(
    db
      .select({ id: departmentMemberships.id })
      .from(departmentMemberships)
      .where(
        and(
          eq(departmentMemberships.userId, users.id),
          activeOn(departmentMemberships, today),
          input.departmentId
            ? eq(departmentMemberships.departmentId, input.departmentId)
            : undefined,
          input.role ? eq(departmentMemberships.role, input.role) : undefined,
        ),
      ),
  );
  const supervisor = exists(
    db
      .select({ id: supervisorAssignments.id })
      .from(supervisorAssignments)
      .where(
        and(
          eq(supervisorAssignments.userId, users.id),
          activeOn(supervisorAssignments, today),
          input.departmentId
            ? eq(supervisorAssignments.departmentId, input.departmentId)
            : undefined,
        ),
      ),
  );
  return db
    .select(accountColumns)
    .from(users)
    .where(
      and(
        or(
          ilike(users.displayName, pattern),
          ilike(users.email, pattern),
          ilike(users.personnelNumber, pattern),
        ),
        input.active === "all"
          ? undefined
          : eq(users.isActive, input.active === "active"),
        input.admin === "all"
          ? undefined
          : eq(users.isHospitalAdmin, input.admin === "admin"),
        input.role
          ? membership
          : input.departmentId
            ? or(membership, supervisor)
            : undefined,
      ),
    )
    .orderBy(asc(users.displayName), asc(users.id))
    .limit(26)
    .offset((input.page - 1) * 25);
}

export async function readAccountDetail(db: DbExecutor, userId: string) {
  const [row] = await db
    .select({
      ...accountColumns,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
      hasCredentials: sql<boolean>`${users.passwordHash} is not null`,
      mustChangePassword: users.mustChangePassword,
    })
    .from(users)
    .where(eq(users.id, userId));
  return row ?? null;
}

/** Batch projection, safe for management reads; never selects credentials. */
export async function readAccessRelations(
  db: DbExecutor,
  userIds: readonly string[],
  today?: IsoDate,
) {
  if (userIds.length === 0) return { memberships: [], supervisors: [] };
  const [memberships, supervisors] = await Promise.all([
    db
      .select({
        id: departmentMemberships.id,
        userId: departmentMemberships.userId,
        department: departmentColumns,
        role: departmentMemberships.role,
        startedOn: departmentMemberships.startedOn,
        endedOn: departmentMemberships.endedOn,
      })
      .from(departmentMemberships)
      .innerJoin(
        departments,
        eq(departments.id, departmentMemberships.departmentId),
      )
      .where(
        and(
          inArray(departmentMemberships.userId, [...userIds]),
          today ? activeOn(departmentMemberships, today) : undefined,
        ),
      )
      .orderBy(
        asc(departmentMemberships.startedOn),
        asc(departmentMemberships.id),
      ),
    db
      .select({
        id: supervisorAssignments.id,
        userId: supervisorAssignments.userId,
        department: departmentColumns,
        startedOn: supervisorAssignments.startedOn,
        endedOn: supervisorAssignments.endedOn,
      })
      .from(supervisorAssignments)
      .innerJoin(
        departments,
        eq(departments.id, supervisorAssignments.departmentId),
      )
      .where(
        and(
          inArray(supervisorAssignments.userId, [...userIds]),
          today ? activeOn(supervisorAssignments, today) : undefined,
        ),
      )
      .orderBy(
        asc(supervisorAssignments.startedOn),
        asc(supervisorAssignments.id),
      ),
  ]);
  return { memberships, supervisors };
}

/** Operational projection: current local relations only, with no email or admin authority. */
export async function readCurrentDepartmentPeople(
  db: DbExecutor,
  departmentId: string,
  today: IsoDate,
) {
  const person = {
    userId: users.id,
    displayName: users.displayName,
    isActive: users.isActive,
  };
  const [memberships, supervisors] = await Promise.all([
    db
      .select({ ...person, role: departmentMemberships.role })
      .from(departmentMemberships)
      .innerJoin(users, eq(users.id, departmentMemberships.userId))
      .where(
        and(
          eq(departmentMemberships.departmentId, departmentId),
          activeOn(departmentMemberships, today),
        ),
      )
      .orderBy(asc(users.displayName), asc(users.id)),
    db
      .select(person)
      .from(supervisorAssignments)
      .innerJoin(users, eq(users.id, supervisorAssignments.userId))
      .where(
        and(
          eq(supervisorAssignments.departmentId, departmentId),
          activeOn(supervisorAssignments, today),
        ),
      )
      .orderBy(asc(users.displayName), asc(users.id)),
  ]);
  return { memberships, supervisors };
}
