import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { SHIFT_TYPES } from "../../src/domain/shifts/shift-type";
import { runMigrations } from "../../src/infrastructure/db/migrate";
import { setupTestDatabase } from "./support/database";

const { db, url } = setupTestDatabase({ seed: false });

const EXPECTED_TABLES = [
  "audit_events",
  "department_memberships",
  "departments",
  "notifications",
  "nurse_preferences",
  "preference_window_dates",
  "preference_window_nurses",
  "preference_windows",
  "schedule_revision_dates",
  "schedule_revisions",
  "schedule_roster",
  "schedule_submissions",
  "schedule_version_assignments",
  "schedule_versions",
  "schedules",
  "shift_assignments",
  "shift_change_request_items",
  "shift_change_requests",
  "shift_types",
  "supervisor_assignments",
  "users",
];

const EXPECTED_ENUMS = {
  assignment_source: ["MANUAL", "PREFILL"],
  change_request_status: [
    "PENDING",
    "ACKNOWLEDGED",
    "DECLINED",
    "RESOLVED",
    "WITHDRAWN",
  ],
  date_scope_kind: ["DAY", "DAYS", "RANGE", "WEEK", "PERIOD"],
  membership_role: ["NURSE", "HEAD_NURSE"],
  notification_type: [
    "PREFERENCES_OPENED",
    "DATES_REOPENED",
    "SCHEDULE_FINALIZED",
    "SCHEDULE_SUBMITTED",
    "SCHEDULE_APPROVED",
    "SCHEDULE_RETURNED",
    "REVISION_STARTED",
    "CHANGE_REQUEST_SUBMITTED",
    "CHANGE_REQUEST_REVIEWED",
  ],
  preference_value: ["M", "E", "N", "ME", "OFF"],
  preference_window_kind: ["INITIAL", "REOPEN"],
  revision_status: ["OPEN", "APPROVED", "DISCARDED"],
  schedule_status: [
    "DRAFT",
    "PLANNING",
    "FINALIZED",
    "SUBMITTED",
    "RETURNED",
    "APPROVED",
    "REVISING",
  ],
  submission_decision: ["APPROVED", "RETURNED", "WITHDRAWN"],
};

describe("migrations (applied to an empty database by the global setup)", () => {
  it("creates every table of the initial schema", async () => {
    const { rows } = await db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_schema = 'public' order by 1`,
    );
    expect(rows.map((r) => r.table_name)).toEqual(EXPECTED_TABLES);
  });

  it("creates the enums with the domain's values in order", async () => {
    const { rows } = await db.execute<{ name: string; labels: string[] }>(sql`
      select t.typname as name, array_agg(e.enumlabel::text order by e.enumsortorder) as labels
      from pg_type t join pg_enum e on e.enumtypid = t.oid
      group by t.typname order by t.typname
    `);
    expect(Object.fromEntries(rows.map((r) => [r.name, r.labels]))).toEqual(
      EXPECTED_ENUMS,
    );
  });

  it("creates the structural unique indexes", async () => {
    const { rows } = await db.execute<{ indexname: string }>(
      sql`select indexname from pg_indexes where schemaname = 'public' and indexname like '%_key' order by 1`,
    );
    expect(rows.map((r) => r.indexname)).toEqual(
      expect.arrayContaining([
        "department_memberships_active_key",
        "supervisor_assignments_active_key",
        "users_email_lower_key",
        "schedule_revisions_one_open_key",
        "schedule_submissions_one_pending_key",
        "schedules_department_period_key",
        "schedule_versions_schedule_version_key",
      ]),
    );
  });

  it("inserts the shift types exactly as the domain defines them", async () => {
    const { rows } = await db.execute<{
      code: string;
      covers: string[];
      is_night: boolean;
    }>(sql`select code, covers, is_night from shift_types order by sort_order`);
    expect(rows).toEqual(
      Object.values(SHIFT_TYPES).map((s) => ({
        code: s.code,
        covers: [...s.covers],
        is_night: s.isNight,
      })),
    );
  });

  it("records the migration history and is a no-op when run again", async () => {
    const count = async () =>
      (
        await db.execute<{ n: number }>(
          sql`select count(*)::int as n from drizzle.__drizzle_migrations`,
        )
      ).rows[0]!.n;
    const before = await count();
    expect(before).toBe(3); // 0000 baseline, 0001 schema, 0002 shift types
    await runMigrations(url);
    expect(await count()).toBe(before);
  });
});
