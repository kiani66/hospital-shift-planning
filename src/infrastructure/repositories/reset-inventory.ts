import { sql } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import type { DbExecutor } from "../db/database";
import * as schema from "../db/schema";
import {
  CATEGORY_IDS,
  RESET_CATEGORIES,
  rowKey,
  type ResetTable,
  type ResetRow,
} from "../../domain/reset/categories";
const wanted = new Set<string>(
  CATEGORY_IDS.flatMap((c) => [...RESET_CATEGORIES[c].tables]),
);
const definitions = [
  schema.users,
  schema.departments,
  schema.departmentMemberships,
  schema.supervisorAssignments,
  schema.shiftTypes,
  schema.changeReasons,
  schema.schedules,
  schema.scheduleRoster,
  schema.preferenceWindows,
  schema.preferenceWindowDates,
  schema.preferenceWindowNurses,
  schema.nursePreferences,
  schema.shiftAssignments,
  schema.scheduleRevisions,
  schema.scheduleRevisionDates,
  schema.scheduleSubmissions,
  schema.scheduleVersions,
  schema.scheduleVersionAssignments,
  schema.scheduleRuleSetApplications,
  schema.shiftChangeRequests,
  schema.legacyShiftChangeRequests,
  schema.legacyShiftChangeRequestItems,
  schema.scheduleChanges,
  schema.scheduleChangeCells,
  schema.notifications,
  schema.auditEvents,
  schema.staffingRuleSets,
  schema.staffingRuleSetVersions,
  schema.staffingRuleSetRequirements,
  schema.staffingRuleSetDateExceptions,
];
export const RESET_TABLES = definitions
  .map((t) => {
    const config = getTableConfig(t);
    return {
      name: config.name,
      primaryKey:
        config.primaryKeys[0]?.columns.map((c) =>
          c.name.replace(/[A-Z]/g, (letter) => "_" + letter.toLowerCase()),
        ) ??
        config.columns
          .filter((c) => c.primary)
          .map((c) =>
            c.name.replace(/[A-Z]/g, (letter) => "_" + letter.toLowerCase()),
          ),
      foreignKeys: config.foreignKeys.map((f) => {
        const ref = f.reference();
        return {
          columns: ref.columns.map((c) =>
            c.name.replace(/[A-Z]/g, (letter) => "_" + letter.toLowerCase()),
          ),
          target: getTableConfig(ref.foreignTable).name,
          targetColumns: ref.foreignColumns.map((c) =>
            c.name.replace(/[A-Z]/g, (letter) => "_" + letter.toLowerCase()),
          ),
        };
      }),
    };
  })
  .sort((a, b) => a.name.localeCompare(b.name));
if (
  RESET_TABLES.some((t) => !wanted.has(t.name) || t.primaryKey.length === 0) ||
  [...wanted].some((n) => !RESET_TABLES.some((t) => t.name === n))
)
  throw new Error("Reset inventory does not match category registry");
/** All data stays inside the server; passwords are excluded at the SQL boundary. */
export async function readResetInventory(
  db: DbExecutor,
): Promise<ResetTable[]> {
  const tables: ResetTable[] = [];
  for (const t of RESET_TABLES) {
    const projection =
      t.name === "users"
        ? sql`(to_jsonb(r) - 'password_hash') || jsonb_build_object('has_credentials', r.password_hash is not null, 'credential_revision', md5(coalesce(r.password_hash,'')))`
        : sql`to_jsonb(r)`;
    const result = await db.execute(
      sql`select ${projection} as record from ${sql.identifier(t.name)} r`,
    );
    const rows = result.rows
      .map((r) => r.record as ResetRow)
      .sort((a, b) =>
        rowKey({ ...t, rows: [] }, a).localeCompare(
          rowKey({ ...t, rows: [] }, b),
        ),
      );
    tables.push({ ...t, rows });
  }
  return tables;
}
/** Refuse schema drift or unregistered foreign-key dependents rather than widening cleanup. */
export async function resetSchemaBlockers(db: DbExecutor): Promise<string[]> {
  const result =
    await db.execute(sql`select c.conrelid::regclass::text as child, c.confrelid::regclass::text as parent,
    array(select a.attname::text from unnest(c.conkey) with ordinality k(attnum,n) join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum order by k.n) as columns,
    array(select a.attname::text from unnest(c.confkey) with ordinality k(attnum,n) join pg_attribute a on a.attrelid=c.confrelid and a.attnum=k.attnum order by k.n) as "targetColumns"
   from pg_constraint c where c.contype='f' and c.confrelid in (select oid from pg_class where relnamespace='public'::regnamespace and relname in (${sql.join(
     RESET_TABLES.map((t) => sql`${t.name}`),
     sql`, `,
   )}))`);
  const blockers: string[] = [];
  for (const r of result.rows) {
    const child = String(r.child).replace(/^public\./, ""),
      parent = String(r.parent).replace(/^public\./, "");
    const table = RESET_TABLES.find((t) => t.name === child);
    if (
      !table ||
      !table.foreignKeys.some(
        (f) =>
          f.target === parent &&
          JSON.stringify(f.columns) === JSON.stringify(r.columns) &&
          JSON.stringify(f.targetColumns) === JSON.stringify(r.targetColumns),
      )
    )
      blockers.push(`UNSUPPORTED_FOREIGN_KEY:${child}→${parent}`);
  }
  return blockers;
}
