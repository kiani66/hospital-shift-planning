import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { SHIFT_TYPES } from "../../src/domain/shifts/shift-type";
import { runMigrations } from "../../src/infrastructure/db/migrate";
import {
  HOSPITAL_RULE_SET_ID,
  LEGACY_BASELINE_BOUNDS,
  LEGACY_BASELINE_EFFECTIVE_FROM,
  LEGACY_BASELINE_VERSION_ID,
} from "../../src/infrastructure/db/schema";
import { setupTestDatabase } from "./support/database";

const { db, url } = setupTestDatabase({ seed: false });

const EXPECTED_TABLES = [
  "audit_events",
  "change_reasons",
  "department_memberships",
  "departments",
  "legacy_shift_change_request_items",
  "legacy_shift_change_requests",
  "login_throttles",
  "notifications",
  "nurse_preferences",
  "preference_window_dates",
  "preference_window_nurses",
  "preference_windows",
  "reset_operations",
  "schedule_change_cells",
  "schedule_changes",
  "schedule_revision_dates",
  "schedule_revisions",
  "schedule_roster",
  "schedule_rule_set_applications",
  "schedule_submissions",
  "schedule_version_assignments",
  "schedule_versions",
  "schedules",
  "shift_assignments",
  "shift_change_requests",
  "shift_types",
  "staffing_rule_set_date_exceptions",
  "staffing_rule_set_requirements",
  "staffing_rule_set_versions",
  "staffing_rule_sets",
  "supervisor_assignments",
  "users",
];

const EXPECTED_ENUMS = {
  assignment_source: ["MANUAL", "PREFILL"],
  change_reason_scope: ["REQUEST", "ADJUSTMENT", "BOTH"],
  change_request_rejection: ["HEAD_NURSE", "COUNTERPART_DECLINED"],
  change_request_status: ["PENDING", "CANCELLED", "REJECTED", "APPLIED"],
  change_request_type: ["UNAVAILABLE", "CHANGE_SHIFT", "SWAP", "OTHER"],
  coverage_period: ["M", "E", "N"],
  date_scope_kind: ["DAY", "DAYS", "RANGE", "WEEK", "PERIOD"],
  legacy_change_request_status: [
    "PENDING",
    "ACKNOWLEDGED",
    "DECLINED",
    "RESOLVED",
    "WITHDRAWN",
  ],
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
    "SWAP_CONSENT_REQUESTED",
  ],
  preference_value: ["M", "E", "N", "ME", "OFF"],
  preference_window_kind: ["INITIAL", "REOPEN"],
  revision_status: ["OPEN", "APPROVED", "DISCARDED"],
  schedule_change_kind: ["REQUEST", "ADJUSTMENT"],
  staffing_day_type: ["NORMAL", "HOLIDAY"],
  staffing_rule_set_retire_reason: ["REPLACED", "WITHDRAWN"],
  staffing_rule_set_status: ["DRAFT", "PUBLISHED", "RETIRED"],
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
  swap_consent_status: ["PENDING", "ACCEPTED", "DECLINED"],
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
        "shift_change_requests_one_active_key",
        "staffing_rule_set_versions_effective_key",
        "staffing_rule_set_versions_one_draft_key",
        "staffing_rule_set_versions_no_key",
        "staffing_rule_sets_department_key",
        "staffing_rule_sets_hospital_key",
      ]),
    );
  });

  it("creates the no-overlap exclusion constraints with btree_gist (D18, D19)", async () => {
    const { rows } = await db.execute<{ table: string; name: string }>(sql`
      select conrelid::regclass::text as table, conname as name
      from pg_constraint where contype = 'x' order by 1
    `);
    expect(rows).toEqual([
      {
        table: "department_memberships",
        name: "department_memberships_no_overlap",
      },
      { table: "schedules", name: "schedules_period_no_overlap" },
      {
        table: "supervisor_assignments",
        name: "supervisor_assignments_no_overlap",
      },
    ]);
    const { rows: ext } = await db.execute<{ extname: string }>(
      sql`select extname from pg_extension where extname = 'btree_gist'`,
    );
    expect(ext).toHaveLength(1);
  });

  it("inserts the shift types exactly as the domain defines them", async () => {
    const { rows } = await db.execute<{
      code: string;
      covers: string[];
      is_night: boolean;
    }>(sql`select code, covers, is_night from shift_types order by sort_order`);
    expect(rows).toEqual([
      ...Object.values(SHIFT_TYPES).map((s) => ({
        code: s.code,
        covers: [...s.covers],
        is_night: s.isNight,
      })),
      { code: "OFF", covers: [], is_night: false },
    ]);
  });

  it("creates only the Hospital Default legacy baseline: M/E/N min 1, no max (D105)", async () => {
    const { rows: sets } = await db.execute<{
      id: string;
      department_id: string | null;
    }>(sql`select id, department_id from staffing_rule_sets`);
    expect(sets).toEqual([{ id: HOSPITAL_RULE_SET_ID, department_id: null }]);
    const { rows: versions } = await db.execute<{
      id: string;
      status: string;
      effective_from: string;
      origin: string;
      version_no: number;
    }>(
      sql`select id, status, effective_from::text, origin, version_no from staffing_rule_set_versions`,
    );
    expect(versions).toEqual([
      {
        id: LEGACY_BASELINE_VERSION_ID,
        status: "PUBLISHED",
        effective_from: LEGACY_BASELINE_EFFECTIVE_FROM,
        origin: "MIGRATION",
        version_no: 1,
      },
    ]);
    const { rows: bounds } = await db.execute<{
      day_type: string;
      coverage_period: string;
      min_staff: number;
      max_staff: number | null;
    }>(
      sql`select day_type, coverage_period, min_staff, max_staff from staffing_rule_set_requirements where version_id = ${LEGACY_BASELINE_VERSION_ID} order by coverage_period`,
    );
    expect(bounds).toEqual(
      ["M", "E", "N"].map((p) => ({
        day_type: "NORMAL",
        coverage_period: p,
        min_staff: LEGACY_BASELINE_BOUNDS.min,
        max_staff: LEGACY_BASELINE_BOUNDS.max,
      })),
    );
    const { rows: exceptions } = await db.execute(
      sql`select 1 from staffing_rule_set_date_exceptions`,
    );
    expect(exceptions).toEqual([]);
  });

  it("records the migration history and is a no-op when run again", async () => {
    const count = async () =>
      (
        await db.execute<{ n: number }>(
          sql`select count(*)::int as n from drizzle.__drizzle_migrations`,
        )
      ).rows[0]!.n;
    const before = await count();
    // 0000 baseline, 0001 schema, 0002 shift types, 0003 no overlaps, 0004 login
    // throttles, 0005 legacy change requests, 0006 Phase 9 schema, 0007 reasons,
    // 0008 system-level Hospital Admin flag, 0009 personnel identity (stage 1),
    // 0010 explicit OFF, 0011 versioned staffing rule sets, 0012 ME label, 0013 reset records
    expect(before).toBe(14);
    await runMigrations(url);
    expect(await count()).toBe(before);
  });
});
