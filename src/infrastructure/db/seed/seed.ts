import { sql } from "drizzle-orm";

import { SHIFT_TYPES } from "../../../domain/shifts/shift-type";
import { hashPassword } from "../../auth/password";
import type { Database, DbExecutor } from "../database";
import { snapshotRosterFromMemberships } from "../../repositories/roster";
import {
  auditEvents,
  departmentMemberships,
  departments,
  loginThrottles,
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
  legacyShiftChangeRequestItems,
  legacyShiftChangeRequests,
  scheduleChangeCells,
  scheduleChanges,
  scheduleRuleSetApplications,
  shiftChangeRequests,
  shiftTypes,
  staffingRuleSetDateExceptions,
  staffingRuleSetRequirements,
  staffingRuleSets,
  staffingRuleSetVersions,
  HOSPITAL_RULE_SET_ID,
  LEGACY_BASELINE_BOUNDS,
  LEGACY_BASELINE_EFFECTIVE_FROM,
  LEGACY_BASELINE_VERSION_ID,
  supervisorAssignments,
  users,
} from "../schema";
import {
  DEMO_DEPARTMENTS,
  DEMO_MEMBERSHIPS,
  DEMO_PASSWORD,
  DEMO_SCHEDULE,
  DEMO_SUPERVISED_DEPARTMENTS,
  DEMO_USERS,
} from "./demo-data";

/**
 * Every application table except reference data (`shift_types`,
 * `change_reasons`). Staffing rule sets are cleared too and the Hospital
 * Default's legacy baseline (migration 0011) is restored by `resetData`. The legacy
 * Phase 2 change-request tables are cleared too: they reference schedules and
 * users, and this reset only ever runs on development, preview and test
 * databases (never production, `assertSeedAllowed`).
 */
export const DATA_TABLES = [
  loginThrottles,
  auditEvents,
  notifications,
  legacyShiftChangeRequestItems,
  legacyShiftChangeRequests,
  scheduleChangeCells,
  scheduleChanges,
  shiftChangeRequests,
  scheduleRuleSetApplications,
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
  staffingRuleSetDateExceptions,
  staffingRuleSetRequirements,
  staffingRuleSetVersions,
  staffingRuleSets,
  supervisorAssignments,
  departmentMemberships,
  departments,
  users,
];

// Hashed once per process: Argon2 is deliberately slow, and every demo
// account shares the demo password.
let demoPasswordHash: Promise<string> | undefined;

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

/**
 * Deletes all application data (keeps shift types and migration history) and
 * restores the Hospital Default's legacy baseline rule set exactly as
 * migration 0011 creates it, so new schedules can always be pinned.
 */
export async function resetData(db: DbExecutor): Promise<void> {
  const tables = sql.join(
    DATA_TABLES.map((t) => sql`${t}`),
    sql`, `,
  );
  await db.execute(sql`truncate table ${tables} restart identity cascade`);
  await restoreLegacyBaseline(db);
}

async function restoreLegacyBaseline(db: DbExecutor): Promise<void> {
  await db
    .insert(staffingRuleSets)
    .values({ id: HOSPITAL_RULE_SET_ID, departmentId: null });
  await db.insert(staffingRuleSetVersions).values({
    id: LEGACY_BASELINE_VERSION_ID,
    ruleSetId: HOSPITAL_RULE_SET_ID,
    versionNo: 1,
    status: "PUBLISHED",
    effectiveFrom: LEGACY_BASELINE_EFFECTIVE_FROM,
    note: "قانون پایه پیشین سامانه: دست‌کم یک نفر در هر نوبت، بدون حداکثر",
    origin: "MIGRATION",
    publishedAt: new Date(),
  });
  await db.insert(staffingRuleSetRequirements).values(
    (["M", "E", "N"] as const).map((coveragePeriod) => ({
      versionId: LEGACY_BASELINE_VERSION_ID,
      dayType: "NORMAL" as const,
      coveragePeriod,
      minStaff: LEGACY_BASELINE_BOUNDS.min,
      maxStaff: LEGACY_BASELINE_BOUNDS.max,
    })),
  );
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
  demoPasswordHash ??= hashPassword(DEMO_PASSWORD);
  const passwordHash = await demoPasswordHash;
  return db.transaction(async (tx) => {
    await resetData(tx);

    await tx
      .insert(shiftTypes)
      .values([
        ...Object.values(SHIFT_TYPES).map((s, i) => ({
          code: s.code,
          label: SHIFT_LABELS[s.code],
          covers: [...s.covers],
          isNight: s.isNight,
          sortOrder: i + 1,
        })),
        {
          code: "OFF",
          label: "استراحت",
          covers: [],
          isNight: false,
          sortOrder: 5,
        },
      ])
      .onConflictDoNothing();

    await tx.insert(departments).values([...DEMO_DEPARTMENTS]);
    await tx
      .insert(users)
      .values(Object.values(DEMO_USERS).map((u) => ({ ...u, passwordHash })));
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
