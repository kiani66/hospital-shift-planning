import { sql } from "drizzle-orm";

import { SHIFT_TYPES } from "../../../domain/shifts/shift-type";
import type { Database, DbExecutor } from "../database";
import { snapshotRosterFromMemberships } from "../../repositories/roster";
import {
  auditEvents,
  departmentMemberships,
  departments,
  notifications,
  nursePreferences,
  preferenceWindowDates,
  preferenceWindowNurses,
  preferenceWindows,
  scheduleRevisionDates,
  scheduleRevisions,
  schedules,
  scheduleSubmissions,
  scheduleVersionAssignments,
  scheduleVersions,
  shiftAssignments,
  shiftChangeRequestItems,
  shiftChangeRequests,
  shiftTypes,
  supervisorAssignments,
  users,
} from "../schema";
import {
  DEMO_DEPARTMENTS,
  DEMO_MEMBERSHIPS,
  DEMO_SCHEDULE,
  DEMO_SUPERVISED_DEPARTMENTS,
  DEMO_USERS,
} from "./demo-data";

/** Every application table except the `shift_types` reference data. */
export const DATA_TABLES = [
  auditEvents,
  notifications,
  shiftChangeRequestItems,
  shiftChangeRequests,
  scheduleVersionAssignments,
  scheduleVersions,
  scheduleSubmissions,
  scheduleRevisionDates,
  scheduleRevisions,
  shiftAssignments,
  nursePreferences,
  preferenceWindowNurses,
  preferenceWindowDates,
  preferenceWindows,
  schedules,
  supervisorAssignments,
  departmentMemberships,
  departments,
  users,
];

const SHIFT_LABELS = { M: "صبح", E: "عصر", N: "شب", ME: "صبح و عصر" } as const;

export class SeedNotAllowedError extends Error {
  override readonly name = "SeedNotAllowedError";
}

/** The seed wipes data, so it must never run against production. */
export function assertSeedAllowed(
  env: Record<string, string | undefined>,
): void {
  if (env.NODE_ENV === "production" || env.VERCEL_ENV === "production") {
    throw new SeedNotAllowedError(
      "Refusing to seed: this looks like a production environment",
    );
  }
}

/** Deletes all application data (keeps shift types and migration history). */
export async function resetData(db: DbExecutor): Promise<void> {
  const tables = sql.join(
    DATA_TABLES.map((t) => sql`${t}`),
    sql`, `,
  );
  await db.execute(sql`truncate table ${tables} restart identity cascade`);
}

export interface SeedSummary {
  readonly departments: number;
  readonly users: number;
  readonly memberships: number;
  readonly supervisorAssignments: number;
  readonly schedules: number;
  readonly rosterEntries: number;
}

/**
 * Resets the database to the deterministic demo data set. Idempotent: running
 * it again produces the same rows with the same ids.
 */
export async function seedDemoData(db: Database): Promise<SeedSummary> {
  return db.transaction(async (tx) => {
    await resetData(tx);

    await tx
      .insert(shiftTypes)
      .values(
        Object.values(SHIFT_TYPES).map((s, i) => ({
          code: s.code,
          label: SHIFT_LABELS[s.code],
          covers: [...s.covers],
          isNight: s.isNight,
          sortOrder: i + 1,
        })),
      )
      .onConflictDoNothing();

    await tx.insert(departments).values([...DEMO_DEPARTMENTS]);
    await tx.insert(users).values(Object.values(DEMO_USERS));
    await tx.insert(departmentMemberships).values([...DEMO_MEMBERSHIPS]);
    await tx.insert(supervisorAssignments).values(
      DEMO_SUPERVISED_DEPARTMENTS.map((departmentId) => ({
        userId: DEMO_USERS.supervisor.id,
        departmentId,
        startedOn: "2026-01-01",
      })),
    );
    await tx.insert(schedules).values(DEMO_SCHEDULE);
    const rosterEntries = await snapshotRosterFromMemberships(tx, {
      scheduleId: DEMO_SCHEDULE.id,
      departmentId: DEMO_SCHEDULE.departmentId,
      addedBy: DEMO_SCHEDULE.createdBy,
    });

    return {
      departments: DEMO_DEPARTMENTS.length,
      users: Object.keys(DEMO_USERS).length,
      memberships: DEMO_MEMBERSHIPS.length,
      supervisorAssignments: DEMO_SUPERVISED_DEPARTMENTS.length,
      schedules: 1,
      rosterEntries,
    };
  });
}
