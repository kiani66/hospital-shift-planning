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

/**
 * Migration 0005 must keep the Phase 2 change-request tables and any rows
 * they hold (renamed to legacy_*, never dropped). This test upgrades a
 * scratch database that holds such rows at 0004 to the latest migration.
 */

const testUrl = new URL(inject("databaseUrl"));
const scratchName = `${testUrl.pathname.slice(1)}_legacy_upgrade`;
const scratchUrl = new URL(testUrl);
scratchUrl.pathname = `/${scratchName}`;

const ids = {
  user: "11111111-0000-4000-8000-000000000001",
  partner: "11111111-0000-4000-8000-000000000002",
  department: "22222222-0000-4000-8000-000000000001",
  schedule: "33333333-0000-4000-8000-000000000001",
  request: "44444444-0000-4000-8000-000000000001",
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

/** Applies only the migrations up to and including `lastIdx`. */
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

beforeAll(async () => {
  await admin(async (c) => {
    await c.query(`drop database if exists "${scratchName}"`);
    await c.query(`create database "${scratchName}"`);
  });
  await migrateUpTo(4);
  scratch = new Pool({ connectionString: scratchUrl.toString(), max: 1 });

  // A Phase 2 request with two items, exactly as the old schema stored it.
  await scratch.query(`
    insert into users (id, email, display_name, password_hash) values
      ('${ids.user}', 'legacy1@test.invalid', 'Legacy One', 'x'),
      ('${ids.partner}', 'legacy2@test.invalid', 'Legacy Two', 'x');
    insert into departments (id, code, name) values ('${ids.department}', 'legacy', 'Legacy');
    insert into schedules (id, department_id, period_start, period_end, label, created_by)
      values ('${ids.schedule}', '${ids.department}', '2026-01-01', '2026-01-31', 'Jan', '${ids.user}');
    insert into schedule_roster (schedule_id, user_id, role, added_by)
      values ('${ids.schedule}', '${ids.user}', 'NURSE', '${ids.user}');
    insert into shift_change_requests
      (id, schedule_id, requester_id, counterpart_user_id, reason, status, reviewed_by, reviewed_at, review_note)
      values ('${ids.request}', '${ids.schedule}', '${ids.user}', '${ids.partner}',
              'Coordinated with a colleague', 'ACKNOWLEDGED', '${ids.user}', '2026-01-05T10:00:00Z', 'Seen');
    insert into shift_change_request_items (request_id, date, current_shift_code, desired_shift_code) values
      ('${ids.request}', '2026-01-10', 'M', null),
      ('${ids.request}', '2026-01-11', null, 'N');
  `);

  // Upgrade with the real migrator and folder, as a deployment does.
  await runMigrations(scratchUrl.toString());
}, 60_000);

afterAll(async () => {
  await scratch?.end();
  await admin((c) => c.query(`drop database if exists "${scratchName}"`));
});

describe("upgrading a database that holds Phase 2 change requests (0005)", () => {
  it("keeps every legacy row and value under the legacy table names", async () => {
    const { rows: requests } = await scratch.query(
      `select id, requester_id, counterpart_user_id, reason, status::text, review_note
       from legacy_shift_change_requests`,
    );
    expect(requests).toEqual([
      {
        id: ids.request,
        requester_id: ids.user,
        counterpart_user_id: ids.partner,
        reason: "Coordinated with a colleague",
        status: "ACKNOWLEDGED",
        review_note: "Seen",
      },
    ]);
    const { rows: items } = await scratch.query(
      `select to_char(date, 'YYYY-MM-DD') as date, current_shift_code, desired_shift_code
       from legacy_shift_change_request_items order by date`,
    );
    expect(items).toEqual([
      { date: "2026-01-10", current_shift_code: "M", desired_shift_code: null },
      { date: "2026-01-11", current_shift_code: null, desired_shift_code: "N" },
    ]);
  });

  it("keeps the legacy enum, keys, foreign keys, checks and indexes (renamed)", async () => {
    const { rows: type } = await scratch.query(
      `select pg_typeof(status)::text as type from legacy_shift_change_requests`,
    );
    expect(type).toEqual([{ type: "legacy_change_request_status" }]);

    const { rows: constraints } = await scratch.query(`
      select conname as name, contype as type from pg_constraint
      where conrelid::regclass::text like 'legacy_%' order by 1`);
    expect(constraints).toEqual([
      { name: "legacy_shift_change_request_items_current_shift_fk", type: "f" },
      { name: "legacy_shift_change_request_items_desired_shift_fk", type: "f" },
      { name: "legacy_shift_change_request_items_pk", type: "p" },
      { name: "legacy_shift_change_request_items_request_fk", type: "f" },
      { name: "legacy_shift_change_requests_counterpart_check", type: "c" },
      { name: "legacy_shift_change_requests_counterpart_fk", type: "f" },
      { name: "legacy_shift_change_requests_pkey", type: "p" },
      { name: "legacy_shift_change_requests_requester_fk", type: "f" },
      { name: "legacy_shift_change_requests_resolved_revision_fk", type: "f" },
      { name: "legacy_shift_change_requests_reviewed_by_fk", type: "f" },
      { name: "legacy_shift_change_requests_reviewed_check", type: "c" },
      { name: "legacy_shift_change_requests_roster_fk", type: "f" },
      { name: "legacy_shift_change_requests_schedule_fk", type: "f" },
    ]);
    const { rows: indexes } = await scratch.query(`
      select indexname from pg_indexes where tablename like 'legacy_%' order by 1`);
    expect(indexes.map((r) => r.indexname)).toEqual([
      "legacy_shift_change_request_items_pk",
      "legacy_shift_change_requests_pkey",
      "legacy_shift_change_requests_requester_idx",
      "legacy_shift_change_requests_schedule_idx",
    ]);
  });

  it("still enforces the legacy constraints", async () => {
    await expect(
      scratch.query(
        `insert into legacy_shift_change_request_items (request_id, date)
         values ('99999999-0000-4000-8000-000000000000', '2026-01-12')`,
      ),
    ).rejects.toThrow(/legacy_shift_change_request_items_request_fk/);
    await expect(
      scratch.query(
        `update legacy_shift_change_requests set counterpart_user_id = requester_id`,
      ),
    ).rejects.toThrow(/legacy_shift_change_requests_counterpart_check/);
  });

  it("does not turn legacy rows into Phase 9 requests", async () => {
    const { rows } = await scratch.query(
      `select count(*)::int as n from shift_change_requests`,
    );
    expect(rows).toEqual([{ n: 0 }]);
    const { rows: reasons } = await scratch.query(
      `select count(*)::int as n from change_reasons where code = 'OTHER' and requires_note`,
    );
    expect(reasons).toEqual([{ n: 1 }]);
  });
});
