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
import { afterAll, beforeEach, describe, expect, inject, it } from "vitest";

import { MIGRATIONS_FOLDER } from "../../src/infrastructure/db/migrate";

/**
 * The Excel template migrations (0016-0019) were published in two shapes: a
 * first 0016 (no department foreign key) that Preview databases already applied,
 * and a rewritten 0016 (foreign key inline, newer journal timestamp) that fresh
 * databases applied together with 0017/0018. drizzle compares only the newest
 * applied `created_at` with each journal timestamp, so 0016 must keep its
 * original timestamp and the foreign key must arrive in 0019, safe to run on a
 * database that already has it. Every historical state must reach the latest
 * migration, with no failure and no data loss.
 */

const FK = "department_excel_templates_department_id_departments_id_fk";
const SUPERSEDED_0016_WHEN = 1791999828297;

const testUrl = new URL(inject("databaseUrl"));
const scratchName = `${testUrl.pathname.slice(1)}_excel_history`;
const scratchUrl = new URL(testUrl);
scratchUrl.pathname = `/${scratchName}`;

const ids = {
  user: "11111111-0000-4000-8000-0000000000b1",
  department: "22222222-0000-4000-8000-0000000000b1",
  template: "33333333-0000-4000-8000-0000000000b1",
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

/**
 * Applies the journal entries up to `lastIdx` from a copy of the migration
 * folder. `supersededZeroSixteen` swaps in the rewritten 0016 that was once
 * published (inline foreign key, timestamp 1791999828297).
 */
async function migrateUpTo(
  lastIdx: number,
  options: { supersededZeroSixteen?: boolean } = {},
) {
  const folder = mkdtempSync(join(tmpdir(), "hsp-migrations-"));
  try {
    cpSync(MIGRATIONS_FOLDER, folder, { recursive: true });
    const journalPath = join(folder, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8"));
    journal.entries = journal.entries.filter(
      (e: { idx: number }) => e.idx <= lastIdx,
    );
    if (options.supersededZeroSixteen) {
      const file = join(folder, "0016_excel_export_templates.sql");
      const original = readFileSync(file, "utf8");
      const index =
        'CREATE UNIQUE INDEX "department_excel_templates_one_active_key"';
      expect(original).toContain(index);
      writeFileSync(
        file,
        original.replace(
          index,
          `ALTER TABLE "department_excel_templates" ADD CONSTRAINT "${FK}" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint\n${index}`,
        ),
      );
      journal.entries.find((e: { idx: number }) => e.idx === 16).when =
        SUPERSEDED_0016_WHEN;
    }
    writeFileSync(journalPath, JSON.stringify(journal));
    await applyFolder(folder);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

async function applyFolder(folder: string) {
  const pool = new Pool({ connectionString: scratchUrl.toString(), max: 1 });
  try {
    await migrate(drizzle({ client: pool }), { migrationsFolder: folder });
  } finally {
    await pool.end();
  }
}

const migrateToLatest = () => applyFolder(MIGRATIONS_FOLDER);

let scratch: Pool | undefined;
const query = (text: string, values?: unknown[]) =>
  scratch!.query(text, values);

beforeEach(async () => {
  await scratch?.end();
  scratch = undefined;
  await admin(async (c) => {
    await c.query(`drop database if exists "${scratchName}"`);
    await c.query(`create database "${scratchName}"`);
  });
  scratch = new Pool({ connectionString: scratchUrl.toString(), max: 2 });
});

afterAll(async () => {
  await scratch?.end();
  scratch = undefined;
  await admin((c) => c.query(`drop database if exists "${scratchName}"`));
});

async function insertTemplate() {
  await query(
    `insert into users (id, personnel_number, display_name, password_hash)
       values ($1, '9101', 'Uploader', 'x')`,
    [ids.user],
  );
  await query(
    `insert into departments (id, code, name) values ($1, 'excel-up', 'NICU')`,
    [ids.department],
  );
  await query(
    `insert into department_excel_templates
       (id, department_id, version, is_active, file_name, byte_size, sha256, content,
        sheet_name, personnel_column, first_row, last_row, first_day_column, uploaded_by)
       values ($1, $2, 1, true, 'print.xlsx', 3, 'abc', '\\x010203',
        'Sheet2', 'BL', 7, 21, 'M', $3)`,
    [ids.template, ids.department, ids.user],
  );
}

async function expectLatestSchema() {
  const { rows: foreignKeys } = await query(
    `select conname from pg_constraint
      where conrelid = 'department_excel_templates'::regclass and contype = 'f'`,
  );
  expect(foreignKeys).toEqual([{ conname: FK }]);
  const { rows: columns } = await query(
    `select column_name from information_schema.columns
      where table_name = 'department_excel_templates'
        and column_name in ('day_header_row', 'statistic_columns', 'summary_rows',
                            'weekday_row', 'weekday_format', 'month_heading_cell',
                            'holiday_fill_cell', 'normal_fill_column')`,
  );
  expect(columns).toHaveLength(8);
  const { rows: kept } = await query(
    `select id, sheet_name from department_excel_templates`,
  );
  expect(kept).toEqual([{ id: ids.template, sheet_name: "Sheet2" }]);
  // The restored constraint is enforced.
  await expect(
    query(
      `insert into department_excel_templates
         (department_id, version, is_active, file_name, byte_size, sha256, content,
          sheet_name, personnel_column, first_row, last_row, first_day_column, uploaded_by)
         values ('99999999-0000-4000-8000-000000000000', 1, false, 'x.xlsx', 1, 'z',
          '\\x01', 'S', 'A', 1, 1, 'B', $1)`,
      [ids.user],
    ),
  ).rejects.toMatchObject({ code: "23503" });
}

async function appliedCount() {
  const { rows } = await query(
    `select count(*)::int as n from drizzle.__drizzle_migrations`,
  );
  return rows[0].n as number;
}

describe("Excel template migrations across every published history", () => {
  it("fresh database: 0016 has no foreign key, 0019 adds it", async () => {
    await migrateUpTo(16);
    const { rows } = await query(
      `select 1 from pg_constraint where conname = $1`,
      [FK],
    );
    expect(rows).toHaveLength(0);
    await insertTemplate();
    await migrateToLatest();
    await expectLatestSchema();
  });

  it("Preview database that applied the first 0016 upgrades without re-running it", async () => {
    await migrateUpTo(16);
    await insertTemplate();
    await migrateToLatest();
    await expectLatestSchema();
    expect(await appliedCount()).toBe(20);
  });

  it("database that applied only the rewritten 0016 upgrades", async () => {
    await migrateUpTo(16, { supersededZeroSixteen: true });
    await insertTemplate();
    await migrateToLatest();
    await expectLatestSchema();
  });

  it("database that applied the rewritten 0016 plus 0017/0018 gets 0019 as a no-op", async () => {
    await migrateUpTo(18, { supersededZeroSixteen: true });
    await insertTemplate();
    expect(await appliedCount()).toBe(19);
    await migrateToLatest();
    await expectLatestSchema();
    expect(await appliedCount()).toBe(20);
  });

  it("is idempotent once at the latest migration", async () => {
    await migrateToLatest();
    await insertTemplate();
    await migrateToLatest();
    await expectLatestSchema();
    expect(await appliedCount()).toBe(20);
  });
});
