import { and, asc, eq, inArray, ne } from "drizzle-orm";

import type { IsoDate } from "../../domain/shared/dates";
import type { Assignment } from "../../domain/shifts/assignment";
import type { AssignmentCode } from "../../domain/shifts/shift-type";
import type { DbExecutor } from "../db/database";
import type { RosterEntry } from "./roster";
import {
  schedules,
  shiftAssignments,
  scheduleRoster,
  users,
} from "../db/schema";
import { asIsoDate, asAssignmentCode } from "./mappers";

/** Sets the nurse's single assignment for the day (D15), replacing any existing one. */
export async function setAssignment(
  db: DbExecutor,
  input: {
    scheduleId: string;
    userId: string;
    date: IsoDate;
    shift: AssignmentCode;
    source?: "MANUAL" | "PREFILL";
    updatedBy: string;
  },
): Promise<void> {
  const values = {
    scheduleId: input.scheduleId,
    userId: input.userId,
    date: input.date,
    shiftCode: input.shift,
    source: input.source ?? "MANUAL",
    updatedBy: input.updatedBy,
  };
  await db
    .insert(shiftAssignments)
    .values(values)
    .onConflictDoUpdate({
      target: [
        shiftAssignments.scheduleId,
        shiftAssignments.userId,
        shiftAssignments.date,
      ],
      set: {
        shiftCode: values.shiftCode,
        source: values.source,
        updatedBy: values.updatedBy,
        updatedAt: new Date(),
      },
    });
}

export async function clearAssignment(
  db: DbExecutor,
  input: { scheduleId: string; userId: string; date: IsoDate },
): Promise<boolean> {
  const rows = await db
    .delete(shiftAssignments)
    .where(
      and(
        eq(shiftAssignments.scheduleId, input.scheduleId),
        eq(shiftAssignments.userId, input.userId),
        eq(shiftAssignments.date, input.date),
      ),
    )
    .returning({ date: shiftAssignments.date });
  return rows.length > 0;
}

const assignmentColumns = {
  nurseId: shiftAssignments.userId,
  date: shiftAssignments.date,
  shift: shiftAssignments.shiftCode,
};

const toAssignment = (r: {
  nurseId: string;
  date: string;
  shift: string;
}): Assignment => ({
  nurseId: r.nurseId,
  date: asIsoDate(r.date),
  shift: asAssignmentCode(r.shift),
});

/** The schedule's working copy (optionally one nurse's), as domain assignments. */
export async function listAssignments(
  db: DbExecutor,
  scheduleId: string,
  filter: { userId?: string } = {},
): Promise<Assignment[]> {
  const rows = await db
    .select(assignmentColumns)
    .from(shiftAssignments)
    .where(
      and(
        eq(shiftAssignments.scheduleId, scheduleId),
        filter.userId ? eq(shiftAssignments.userId, filter.userId) : undefined,
      ),
    )
    .orderBy(asc(shiftAssignments.date), asc(shiftAssignments.userId));
  return rows.map(toAssignment);
}

/**
 * The schedule's assignments of the given nurses on the given dates (one
 * query; the caller picks the exact cells it needs from the result).
 */
export async function listAssignmentsFor(
  db: DbExecutor,
  input: {
    scheduleId: string;
    nurseIds: readonly string[];
    dates: readonly IsoDate[];
  },
): Promise<Assignment[]> {
  if (input.nurseIds.length === 0 || input.dates.length === 0) return [];
  const rows = await db
    .select(assignmentColumns)
    .from(shiftAssignments)
    .where(
      and(
        eq(shiftAssignments.scheduleId, input.scheduleId),
        inArray(shiftAssignments.userId, [...input.nurseIds]),
        inArray(shiftAssignments.date, [...input.dates]),
      ),
    );
  return rows.map(toAssignment);
}

/**
 * Working-copy assignments of the given nurses on the given dates in the
 * department's other schedules; the cross-boundary context for night-rest.
 */
export async function listAdjacentAssignments(
  db: DbExecutor,
  input: {
    departmentId: string;
    excludeScheduleId: string;
    nurseIds: readonly string[];
    dates: readonly IsoDate[];
  },
): Promise<Assignment[]> {
  if (input.nurseIds.length === 0 || input.dates.length === 0) return [];
  const rows = await db
    .select(assignmentColumns)
    .from(shiftAssignments)
    .innerJoin(schedules, eq(schedules.id, shiftAssignments.scheduleId))
    .where(
      and(
        eq(schedules.departmentId, input.departmentId),
        ne(shiftAssignments.scheduleId, input.excludeScheduleId),
        inArray(shiftAssignments.userId, [...input.nurseIds]),
        inArray(shiftAssignments.date, [...input.dates]),
      ),
    )
    .orderBy(asc(shiftAssignments.date), asc(shiftAssignments.userId));
  return rows.map(toAssignment);
}

/** Roster and its explicit decisions in one read; missing decisions stay absent. */
export async function listRosterAssignments(
  db: DbExecutor,
  scheduleId: string,
): Promise<{
  roster: RosterEntry[];
  assignments: Assignment[];
}> {
  const rows = await db
    .select({
      userId: scheduleRoster.userId,
      role: scheduleRoster.role,
      displayName: users.displayName,
      date: shiftAssignments.date,
      shift: shiftAssignments.shiftCode,
    })
    .from(scheduleRoster)
    .innerJoin(users, eq(users.id, scheduleRoster.userId))
    .leftJoin(
      shiftAssignments,
      and(
        eq(shiftAssignments.scheduleId, scheduleRoster.scheduleId),
        eq(shiftAssignments.userId, scheduleRoster.userId),
      ),
    )
    .where(eq(scheduleRoster.scheduleId, scheduleId))
    .orderBy(asc(users.displayName), asc(users.id), asc(shiftAssignments.date));
  const roster = new Map<string, RosterEntry>();
  const assignments: Assignment[] = [];
  for (const row of rows) {
    roster.set(row.userId, {
      userId: row.userId,
      displayName: row.displayName,
      role: row.role,
    });
    if (row.date !== null && row.shift !== null)
      assignments.push(
        toAssignment({ nurseId: row.userId, date: row.date, shift: row.shift }),
      );
  }
  assignments.sort(
    (a, b) =>
      a.date.localeCompare(b.date) || a.nurseId.localeCompare(b.nurseId),
  );
  return { roster: [...roster.values()], assignments };
}
