import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";

import type { MembershipRole } from "../../domain/authz/actor";
import { ValidationError } from "../../domain/shared/errors";
import { lockActiveSchedulingUsers } from "./management";
import type { IsoDate } from "../../domain/shared/dates";
import type { DbExecutor, Transaction } from "../db/database";
import {
  departmentMemberships,
  scheduleRoster,
  schedules,
  users,
} from "../db/schema";
import { activeOn } from "./memberships";

export interface RosterEntry {
  readonly userId: string;
  readonly displayName: string;
  /** Department role at snapshot time. */
  readonly role: MembershipRole;
}

/**
 * Copies onto the roster everyone who is a member of the schedule's department
 * on at least one day of its period (D19), including known future joiners and
 * leavers. A user with two memberships in the period (e.g. promoted mid-period)
 * gets the role of the later one. Existing entries are kept; later membership
 * changes never rewrite the roster, and adding someone afterwards is explicit
 * (`addToRoster`). Returns the number added.
 */
export async function snapshotRosterFromMemberships(
  db: DbExecutor,
  input: { scheduleId: string; addedBy: string },
): Promise<number> {
  const m = departmentMemberships;
  // Locks candidate accounts until the surrounding schedule-creation transaction
  // commits. Deactivation either wins first or waits for this snapshot.
  const candidates = await db.execute<{ id: string }>(sql`
    select ${users.id} from ${users}
    where ${users.isActive} = true and exists (
      select 1 from ${m} join ${schedules} on ${m.departmentId} = ${schedules.departmentId}
      where ${schedules.id} = ${input.scheduleId} and ${m.userId} = ${users.id}
        and ${m.startedOn} <= ${schedules.periodEnd}
        and (${m.endedOn} is null or ${m.endedOn} >= ${schedules.periodStart})
    ) order by ${users.id} for share
  `);
  const ids = candidates.rows.map((row) => row.id);
  if (ids.length === 0) return 0;
  const result = await db.execute(sql`
    insert into ${scheduleRoster} (schedule_id, user_id, role, added_by)
    select distinct on (${m.userId}) ${schedules.id}, ${m.userId}, ${m.role}, ${input.addedBy}::uuid
    from ${schedules}
    join ${m} on ${m.departmentId} = ${schedules.departmentId}
      and ${m.startedOn} <= ${schedules.periodEnd}
      and (${m.endedOn} is null or ${m.endedOn} >= ${schedules.periodStart})
    join ${users} on ${users.id} = ${m.userId} and ${users.isActive} = true
    where ${schedules.id} = ${input.scheduleId} and ${inArray(users.id, ids)}
    order by ${m.userId}, ${m.startedOn} desc
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
  if (!(await lockActiveSchedulingUsers(db, [input.userId])))
    throw new ValidationError(
      "Inactive account cannot join a new roster",
      "userId",
    );
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

/**
 * Locks one roster entry (`FOR NO KEY UPDATE`) for the rest of the
 * transaction and says whether it exists. Serializes one nurse's concurrent
 * writes to their own rows of the schedule (two tabs, two devices) without
 * blocking other nurses. Foreign-key checks (`FOR KEY SHARE`) do not conflict
 * with it.
 */
export async function lockRosterEntry(
  tx: Transaction,
  scheduleId: string,
  userId: string,
): Promise<boolean> {
  const [row] = await tx
    .select({ userId: scheduleRoster.userId })
    .from(scheduleRoster)
    .where(
      and(
        eq(scheduleRoster.scheduleId, scheduleId),
        eq(scheduleRoster.userId, userId),
      ),
    )
    .for("no key update");
  return row !== undefined;
}

/**
 * Roster members who are not members of the schedule's department on `onDate`
 * (left, not yet started, or added from elsewhere); for D16-aware reads.
 */
export async function listFormerMembersOnRoster(
  db: DbExecutor,
  input: { scheduleId: string; onDate: IsoDate },
): Promise<string[]> {
  const rows = await db
    .select({ userId: scheduleRoster.userId })
    .from(scheduleRoster)
    .innerJoin(schedules, eq(schedules.id, scheduleRoster.scheduleId))
    .leftJoin(
      departmentMemberships,
      and(
        eq(departmentMemberships.userId, scheduleRoster.userId),
        eq(departmentMemberships.departmentId, schedules.departmentId),
        activeOn(departmentMemberships, input.onDate),
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

/** Active candidates only; listRoster remains the unchanged historical snapshot. */
export async function listSchedulingRoster(
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
    .where(
      and(eq(scheduleRoster.scheduleId, scheduleId), eq(users.isActive, true)),
    )
    .orderBy(asc(users.displayName));
}

export interface RosterMemberOnDate {
  readonly userId: string;
  readonly displayName: string;
  readonly personnelNumber: string | null;
}

/**
 * Roster entries of the schedule that are schedulable on `onDate`: an active
 * account and a membership of the schedule's own department in effect on
 * that day (D19, inclusive bounds). One query, ordered by user id,
 * optionally restricted to some users. The roster itself is never changed;
 * members not on it are never included.
 */
export async function listRosterMembersOn(
  db: DbExecutor,
  input: {
    scheduleId: string;
    onDate: IsoDate;
    userIds?: readonly string[];
  },
): Promise<RosterMemberOnDate[]> {
  const m = departmentMemberships;
  return db
    .select({
      userId: users.id,
      displayName: users.displayName,
      personnelNumber: users.personnelNumber,
    })
    .from(scheduleRoster)
    .innerJoin(schedules, eq(schedules.id, scheduleRoster.scheduleId))
    .innerJoin(users, eq(users.id, scheduleRoster.userId))
    .where(
      and(
        eq(scheduleRoster.scheduleId, input.scheduleId),
        input.userIds ? inArray(users.id, [...input.userIds]) : undefined,
        eq(users.isActive, true),
        sql`exists (select 1 from ${m} where ${m.userId} = ${users.id} and ${m.departmentId} = ${schedules.departmentId} and ${activeOn(m, input.onDate)})`,
      ),
    )
    .orderBy(asc(users.id));
}

/**
 * Selected Candidate eligibility, protected until commit. The account is
 * already share-locked and the roster is protected by its schedule lock.
 * SHARE on the actual qualifying membership rows conflicts with the UPDATE
 * used by administrative end/transfer commands (NO KEY UPDATE). At READ
 * COMMITTED a waited-for update is rechecked against the dated predicate.
 */
export async function lockRosterMemberOn(
  tx: Transaction,
  input: { scheduleId: string; userId: string; onDate: IsoDate },
): Promise<boolean> {
  const m = departmentMemberships;
  const rows = await tx
    .select({ id: m.id })
    .from(scheduleRoster)
    .innerJoin(schedules, eq(schedules.id, scheduleRoster.scheduleId))
    .innerJoin(users, eq(users.id, scheduleRoster.userId))
    .innerJoin(
      m,
      and(
        eq(m.userId, users.id),
        eq(m.departmentId, schedules.departmentId),
        activeOn(m, input.onDate),
      ),
    )
    .where(
      and(
        eq(scheduleRoster.scheduleId, input.scheduleId),
        eq(users.id, input.userId),
        eq(users.isActive, true),
      ),
    )
    .orderBy(asc(m.id))
    .for("share", { of: m });
  return rows.length > 0;
}

export interface RosterCandidateRow {
  readonly userId: string;
  readonly displayName: string;
  readonly personnelNumber: string | null;
  readonly role: MembershipRole;
  readonly startedOn: IsoDate;
  readonly endedOn: IsoDate | null;
}

/**
 * Memberships (one row each) of active department members that overlap the
 * schedule's period, for people not on its roster. Optionally restricted to
 * some users and share-locked, so a concurrent membership end or account
 * deactivation waits for (or wins before) an explicit roster addition.
 */
export async function listRosterCandidateMemberships(
  db: DbExecutor,
  input: {
    scheduleId: string;
    userIds?: readonly string[];
    lock?: boolean;
  },
): Promise<RosterCandidateRow[]> {
  const m = departmentMemberships;
  const query = db
    .select({
      userId: users.id,
      displayName: users.displayName,
      personnelNumber: users.personnelNumber,
      role: m.role,
      startedOn: m.startedOn,
      endedOn: m.endedOn,
    })
    .from(schedules)
    .innerJoin(
      m,
      and(
        eq(m.departmentId, schedules.departmentId),
        sql`${m.startedOn} <= ${schedules.periodEnd}`,
        sql`(${m.endedOn} is null or ${m.endedOn} >= ${schedules.periodStart})`,
      ),
    )
    .innerJoin(users, and(eq(users.id, m.userId), eq(users.isActive, true)))
    .where(
      and(
        eq(schedules.id, input.scheduleId),
        input.userIds ? inArray(users.id, [...input.userIds]) : undefined,
        sql`not exists (select 1 from ${scheduleRoster} r where r.schedule_id = ${schedules.id} and r.user_id = ${users.id})`,
      ),
    )
    .orderBy(asc(users.displayName), asc(users.id), asc(m.startedOn));
  const rows = input.lock
    ? await query.for("share", { of: [m, users] })
    : await query;
  return rows.map((r) => ({
    ...r,
    startedOn: r.startedOn as IsoDate,
    endedOn: r.endedOn as IsoDate | null,
  }));
}
