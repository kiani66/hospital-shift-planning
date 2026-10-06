import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import {
  MIGRATIONS_FOLDER,
  runMigrations,
} from "../../src/infrastructure/db/migrate";
import { LEGACY_BASELINE_VERSION_ID } from "../../src/infrastructure/db/schema";

/**
 * Migration 0011 must preserve Production: every existing schedule and
 * approved version is pinned to the legacy baseline (M/E/N min 1, no max),
 * nothing else changes, and the previous deployment can keep inserting
 * schedules during a release (expand step). This upgrades a scratch database
 * holding Production-like rows at 0010 to the latest migration.
 */

const testUrl = new URL(inject("databaseUrl"));
const scratchName = `${testUrl.pathname.slice(1)}_rule_sets_upgrade`;
const scratchUrl = new URL(testUrl);
scratchUrl.pathname = `/${scratchName}`;

const ids = {
  head: "11111111-0000-4000-8000-0000000000a1",
  supervisor: "11111111-0000-4000-8000-0000000000a2",
  department: "22222222-0000-4000-8000-0000000000a1",
  planning: "33333333-0000-4000-8000-0000000000a1",
  approved: "33333333-0000-4000-8000-0000000000a2",
  later: "33333333-0000-4000-8000-0000000000a3",
  submission: "44444444-0000-4000-8000-0000000000a1",
  version: "55555555-0000-4000-8000-0000000000a1",
};

async function admin<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: testUrl.toString() });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

async function migrateUpTo(lastIdx: number) {
  const folder = mkdtempSync(join(tmpdir(), "hsp-migrations-"));
  try {
    cpSync(MIGRATIONS_FOLDER, folder, { recursive: true });
    const journalPath = join(folder, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8"));
    journal.entries = journal.entries.filter(
      (e: { idx: number }) => e.idx <= lastIdx,
    );
    writeFileSync(journalPath, JSON.stringify(journal));
    const pool = new Pool({ connectionString: scratchUrl.toString(), max: 1 });
    try {
      await migrate(drizzle({ client: pool }), { migrationsFolder: folder });
    } finally {
      await pool.end();
    }
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

let scratch: Pool;
let before: { id: string; revision: number; status: string }[];

beforeAll(async () => {
  await admin(async (c) => {
    await c.query(`drop database if exists "${scratchName}"`);
    await c.query(`create database "${scratchName}"`);
  });
  await migrateUpTo(10);
  scratch = new Pool({ connectionString: scratchUrl.toString(), max: 1 });

  await scratch.query(`
    insert into users (id, personnel_number, display_name, password_hash) values
      ('${ids.head}', '9001', 'Head', 'x'), ('${ids.supervisor}', '9002', 'Supervisor', 'x');
    insert into departments (id, code, name) values ('${ids.department}', 'nicu-up', 'NICU');
    insert into schedules (id, department_id, period_start, period_end, label, status, revision, created_by) values
      ('${ids.planning}', '${ids.department}', '2026-10-23', '2026-11-21', 'Aban', 'PLANNING', 7, '${ids.head}'),
      ('${ids.approved}', '${ids.department}', '2026-09-23', '2026-10-22', 'Mehr', 'SUBMITTED', 3, '${ids.head}');
    insert into schedule_roster (schedule_id, user_id, role, added_by) values
      ('${ids.planning}', '${ids.head}', 'HEAD_NURSE', '${ids.head}'),
      ('${ids.approved}', '${ids.head}', 'HEAD_NURSE', '${ids.head}');
    insert into shift_assignments (schedule_id, user_id, date, shift_code, updated_by) values
      ('${ids.planning}', '${ids.head}', '2026-10-23', 'OFF', '${ids.head}'),
      ('${ids.approved}', '${ids.head}', '2026-09-23', 'N', '${ids.head}');
    insert into schedule_submissions (id, schedule_id, submitted_by, decision, decided_by, decided_at)
      values ('${ids.submission}', '${ids.approved}', '${ids.head}', 'APPROVED', '${ids.supervisor}', now());
    insert into schedule_versions (id, schedule_id, version_no, submission_id, approved_by)
      values ('${ids.version}', '${ids.approved}', 1, '${ids.submission}', '${ids.supervisor}');
    insert into schedule_version_assignments (version_id, user_id, date, shift_code)
      values ('${ids.version}', '${ids.head}', '2026-09-23', 'N');
    update schedules set status = 'APPROVED', current_version_id = '${ids.version}' where id = '${ids.approved}';
  `);
  before = (
    await scratch.query(
      `select id, revision, status::text from schedules order by id`,
    )
  ).rows;

  await runMigrations(scratchUrl.toString());
}, 60_000);

afterAll(async () => {
  await scratch?.end();
  await admin((c) => c.query(`drop database if exists "${scratchName}"`));
});

describe("upgrading a Production-like database to versioned rule sets (0011)", () => {
  it("pins every existing schedule and approved version to the legacy baseline", async () => {
    const { rows: schedules } = await scratch.query(
      `select id, staffing_rule_set_version_id as pin from schedules order by id`,
    );
    expect(schedules).toEqual([
      { id: ids.planning, pin: LEGACY_BASELINE_VERSION_ID },
      { id: ids.approved, pin: LEGACY_BASELINE_VERSION_ID },
    ]);
    const { rows: versions } = await scratch.query(
      `select id, staffing_rule_set_version_id as pin from schedule_versions`,
    );
    expect(versions).toEqual([
      { id: ids.version, pin: LEGACY_BASELINE_VERSION_ID },
    ]);
  });

  it("changes no status, revision, assignment or approved snapshot", async () => {
    expect(
      (
        await scratch.query(
          `select id, revision, status::text from schedules order by id`,
        )
      ).rows,
    ).toEqual(before);
    const { rows: cells } = await scratch.query(
      `select schedule_id, shift_code from shift_assignments order by schedule_id`,
    );
    expect(cells).toEqual([
      { schedule_id: ids.planning, shift_code: "OFF" },
      { schedule_id: ids.approved, shift_code: "N" },
    ]);
    const { rows: snapshot } = await scratch.query(
      `select shift_code from schedule_version_assignments`,
    );
    expect(snapshot).toEqual([{ shift_code: "N" }]);
  });

  it("creates no rule set besides the Hospital Default baseline", async () => {
    const { rows } = await scratch.query(
      `select v.id, s.department_id from staffing_rule_set_versions v join staffing_rule_sets s on s.id = v.rule_set_id`,
    );
    expect(rows).toEqual([
      { id: LEGACY_BASELINE_VERSION_ID, department_id: null },
    ]);
  });

  it("keeps the previous deployment's schedule inserts working (expand step)", async () => {
    // The old code does not know the pin column.
    await scratch.query(`
      insert into schedules (id, department_id, period_start, period_end, label, created_by)
      values ('${ids.later}', '${ids.department}', '2026-11-22', '2026-12-21', 'Azar', '${ids.head}')
    `);
    const { rows } = await scratch.query(
      `select staffing_rule_set_version_id as pin from schedules where id = '${ids.later}'`,
    );
    expect(rows).toEqual([{ pin: LEGACY_BASELINE_VERSION_ID }]);
  });

  it("refuses to delete a version that schedules reference", async () => {
    await expect(
      scratch.query(
        `delete from staffing_rule_set_versions where id = '${LEGACY_BASELINE_VERSION_ID}'`,
      ),
    ).rejects.toThrow(/foreign key/);
  });
});
