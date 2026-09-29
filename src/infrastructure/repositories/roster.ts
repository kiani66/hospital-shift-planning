import { and, asc, eq, isNull, sql } from "drizzle-orm";

import type { MembershipRole } from "../../domain/authz/actor";
import type { DbExecutor } from "../db/database";
import { departmentMemberships, scheduleRoster, users } from "../db/schema";

export interface RosterEntry {
  readonly userId: string;
  readonly displayName: string;
  /** Department role at snapshot time. */
  readonly role: MembershipRole;
}

/**
 * Copies the department's active members (nurses and head nurses) onto the
 * schedule's roster. Existing entries are kept. Returns the number added.
 */
export async function snapshotRosterFromMemberships(
  db: DbExecutor,
  input: { scheduleId: string; departmentId: string; addedBy: string },
): Promise<number> {
  const result = await db.execute(sql`
    insert into ${scheduleRoster} (schedule_id, user_id, role, added_by)
    select ${input.scheduleId}, ${departmentMemberships.userId}, ${departmentMemberships.role}, ${input.addedBy}
    from ${departmentMemberships}
    where ${departmentMemberships.departmentId} = ${input.departmentId}
      and ${departmentMemberships.endedOn} is null
    on conflict do nothing
  `);
  return result.rowCount ?? 0;
}

export async function addToRoster(
  db: DbExecutor,
  input: {
    scheduleId: string;
    userId: string;
    role: MembershipRole;
    addedBy: string;
  },
): Promise<void> {
  await db.insert(scheduleRoster).values(input);
}

/** Fails with a foreign-key violation if the nurse already has preferences, assignments or requests. */
export async function removeFromRoster(
  db: DbExecutor,
  input: { scheduleId: string; userId: string },
): Promise<boolean> {
  const rows = await db
    .delete(scheduleRoster)
    .where(
      and(
        eq(scheduleRoster.scheduleId, input.scheduleId),
        eq(scheduleRoster.userId, input.userId),
      ),
    )
    .returning({ userId: scheduleRoster.userId });
  return rows.length > 0;
}

export async function listRoster(
  db: DbExecutor,
  scheduleId: string,
): Promise<RosterEntry[]> {
  return db
    .select({
      userId: scheduleRoster.userId,
      displayName: users.displayName,
      role: scheduleRoster.role,
    })
    .from(scheduleRoster)
    .innerJoin(users, eq(users.id, scheduleRoster.userId))
    .where(eq(scheduleRoster.scheduleId, scheduleId))
    .orderBy(asc(users.displayName));
}

export async function isOnRoster(
  db: DbExecutor,
  scheduleId: string,
  userId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ userId: scheduleRoster.userId })
    .from(scheduleRoster)
    .where(
      and(
        eq(scheduleRoster.scheduleId, scheduleId),
        eq(scheduleRoster.userId, userId),
      ),
    );
  return row !== undefined;
}

/** Roster members whose department membership has since ended (for D16-aware reads). */
export async function listFormerMembersOnRoster(
  db: DbExecutor,
  input: { scheduleId: string; departmentId: string },
): Promise<string[]> {
  const rows = await db
    .select({ userId: scheduleRoster.userId })
    .from(scheduleRoster)
    .leftJoin(
      departmentMemberships,
      and(
        eq(departmentMemberships.userId, scheduleRoster.userId),
        eq(departmentMemberships.departmentId, input.departmentId),
        isNull(departmentMemberships.endedOn),
      ),
    )
    .where(
      and(
        eq(scheduleRoster.scheduleId, input.scheduleId),
        isNull(departmentMemberships.id),
      ),
    )
    .orderBy(scheduleRoster.userId);
  return rows.map((r) => r.userId);
}
