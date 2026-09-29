import { and, eq, isNull, sql, type SQL } from "drizzle-orm";

import type { Actor, MembershipRole } from "../../domain/authz/actor";
import type { IsoDate } from "../../domain/shared/dates";
import type { DbExecutor } from "../db/database";
import {
  departmentMemberships,
  supervisorAssignments,
  users,
} from "../db/schema";

// Memberships and supervisor assignments are effective-dated (D19): one is
// active on day D when `started_on <= D` and (`ended_on` is null or
// `ended_on >= D`). Both bounds may lie in the future. Ending one keeps the
// row, so history (and D16 access) survives. The database rejects overlapping
// ranges for the same user and department (migration 0003).

/** SQL predicate: the membership or supervisor assignment is in effect on `onDate`. */
export function activeOn(
  table: typeof departmentMemberships | typeof supervisorAssignments,
  onDate: IsoDate,
): SQL {
  return sql`(${table.startedOn} <= ${onDate} and (${table.endedOn} is null or ${table.endedOn} >= ${onDate}))`;
}

export async function addMembership(
  db: DbExecutor,
  input: {
    userId: string;
    departmentId: string;
    role: MembershipRole;
    startedOn: IsoDate;
    /** Known last day, e.g. a fixed-term contract; null or omitted means open-ended. */
    endedOn?: IsoDate | null;
  },
): Promise<void> {
  await db.insert(departmentMemberships).values(input);
}

/**
 * Sets the last day (inclusive, may be in the future) of the open-ended
 * membership; returns false if there is none.
 */
export async function endMembership(
  db: DbExecutor,
  input: { userId: string; departmentId: string; endedOn: IsoDate },
): Promise<boolean> {
  const rows = await db
    .update(departmentMemberships)
    .set({ endedOn: input.endedOn })
    .where(
      and(
        eq(departmentMemberships.userId, input.userId),
        eq(departmentMemberships.departmentId, input.departmentId),
        isNull(departmentMemberships.endedOn),
      ),
    )
    .returning({ id: departmentMemberships.id });
  return rows.length > 0;
}

/** Members (nurses and head nurses) of the department on `onDate`. */
export async function listActiveMembers(
  db: DbExecutor,
  departmentId: string,
  onDate: IsoDate,
): Promise<{ userId: string; role: MembershipRole }[]> {
  return db
    .select({
      userId: departmentMemberships.userId,
      role: departmentMemberships.role,
    })
    .from(departmentMemberships)
    .where(
      and(
        eq(departmentMemberships.departmentId, departmentId),
        activeOn(departmentMemberships, onDate),
      ),
    )
    .orderBy(departmentMemberships.userId);
}

export async function assignSupervisor(
  db: DbExecutor,
  input: {
    userId: string;
    departmentId: string;
    startedOn: IsoDate;
    endedOn?: IsoDate | null;
  },
): Promise<void> {
  await db.insert(supervisorAssignments).values(input);
}

/** Sets the last day of the open-ended supervisor assignment; false if there is none. */
export async function endSupervisorAssignment(
  db: DbExecutor,
  input: { userId: string; departmentId: string; endedOn: IsoDate },
): Promise<boolean> {
  const rows = await db
    .update(supervisorAssignments)
    .set({ endedOn: input.endedOn })
    .where(
      and(
        eq(supervisorAssignments.userId, input.userId),
        eq(supervisorAssignments.departmentId, input.departmentId),
        isNull(supervisorAssignments.endedOn),
      ),
    )
    .returning({ id: supervisorAssignments.id });
  return rows.length > 0;
}

/**
 * Builds the domain `Actor` from the relations in effect on `onDate` (the
 * caller's current day in the department timezone); historical access is
 * decided per resource (roster, requester). Null for unknown users.
 */
export async function loadActor(
  db: DbExecutor,
  userId: string,
  onDate: IsoDate,
): Promise<Actor | null> {
  const [user] = await db
    .select({ isActive: users.isActive })
    .from(users)
    .where(eq(users.id, userId));
  if (!user) return null;

  const [memberships, supervised] = await Promise.all([
    db
      .select({
        departmentId: departmentMemberships.departmentId,
        role: departmentMemberships.role,
      })
      .from(departmentMemberships)
      .where(
        and(
          eq(departmentMemberships.userId, userId),
          activeOn(departmentMemberships, onDate),
        ),
      ),
    db
      .select({ departmentId: supervisorAssignments.departmentId })
      .from(supervisorAssignments)
      .where(
        and(
          eq(supervisorAssignments.userId, userId),
          activeOn(supervisorAssignments, onDate),
        ),
      ),
  ]);

  return {
    userId,
    isActive: user.isActive,
    memberships,
    supervisedDepartmentIds: supervised.map((s) => s.departmentId),
  };
}
