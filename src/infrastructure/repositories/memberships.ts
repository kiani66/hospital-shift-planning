import { and, eq, isNull } from "drizzle-orm";

import type { Actor, MembershipRole } from "../../domain/authz/actor";
import type { IsoDate } from "../../domain/shared/dates";
import type { DbExecutor } from "../db/database";
import {
  departmentMemberships,
  supervisorAssignments,
  users,
} from "../db/schema";

// A membership or supervisor assignment is active while `ended_on` is null.
// Ending one keeps the row, so history (and D16 access) survives.

export async function addMembership(
  db: DbExecutor,
  input: {
    userId: string;
    departmentId: string;
    role: MembershipRole;
    startedOn: IsoDate;
  },
): Promise<void> {
  await db.insert(departmentMemberships).values(input);
}

/** Ends the active membership; returns false if there was none. */
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

export async function listActiveMembers(
  db: DbExecutor,
  departmentId: string,
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
        isNull(departmentMemberships.endedOn),
      ),
    )
    .orderBy(departmentMemberships.userId);
}

export async function assignSupervisor(
  db: DbExecutor,
  input: { userId: string; departmentId: string; startedOn: IsoDate },
): Promise<void> {
  await db.insert(supervisorAssignments).values(input);
}

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
 * Builds the domain `Actor` from current (active) relations only; historical
 * access is decided per resource (roster, requester). Null for unknown users.
 */
export async function loadActor(
  db: DbExecutor,
  userId: string,
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
          isNull(departmentMemberships.endedOn),
        ),
      ),
    db
      .select({ departmentId: supervisorAssignments.departmentId })
      .from(supervisorAssignments)
      .where(
        and(
          eq(supervisorAssignments.userId, userId),
          isNull(supervisorAssignments.endedOn),
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
