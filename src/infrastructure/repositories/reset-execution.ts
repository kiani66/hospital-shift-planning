import { eq, sql } from "drizzle-orm";
import type { Transaction } from "../db/database";
import { resetOperations } from "../db/schema";
import { RESET_TABLES, readResetInventory } from "./reset-inventory";
import {
  references,
  rowKey,
  type ResetRow,
  type ResetTable,
} from "../../domain/reset/categories";
import type { ResetPlan } from "../../domain/reset/plan";
import { pgErrorCode } from "../db/errors";
/** EXCLUSIVE blocks row lockers AND writes, while plain reads stay available. NOWAIT avoids lock-order deadlocks. */
export async function lockResetData(tx: Transaction): Promise<boolean> {
  try {
    await tx.execute(
      sql`lock table ${sql.join([...RESET_TABLES.map((t) => sql.identifier(t.name)), sql.identifier("reset_operations")], sql`, `)} in exclusive mode nowait`,
    );
    return true;
  } catch (error) {
    if (pgErrorCode(error) === "55P03" || pgErrorCode(error) === "40P01")
      return false;
    throw error;
  }
}
const predicate = (table: ResetTable, row: ResetRow) =>
  sql.join(
    table.primaryKey.map((c) => sql`${sql.identifier(c)} = ${row[c]}`),
    sql` and `,
  );
/** Only rows listed in the locked plan are changed. No cascades or disabled constraints. */
export async function deleteResetPlan(
  tx: Transaction,
  inventory: readonly ResetTable[],
  plan: ResetPlan,
): Promise<Record<string, number>> {
  const tables = inventory.map((t) => ({
    ...t,
    rows: t.rows.map((r) => ({ ...r })),
  }));
  const pending = new Map(
    tables.map((t) => [t.name, new Set(plan.deleteKeys[t.name])]),
  );
  const counts: Record<string, number> = {};
  // Break the known schedule/version and rule-version cycles, on deleted rows only.
  for (const t of tables)
    if (t.name === "schedules" || t.name === "staffing_rule_set_versions")
      for (const r of t.rows) {
        if (!pending.get(t.name)!.has(rowKey(t, r))) continue;
        const columns =
          t.name === "schedules"
            ? ["current_version_id"]
            : ["based_on_version_id", "replaced_by_version_id"];
        if (columns.some((c) => r[c] != null)) {
          await tx.execute(
            sql`update ${sql.identifier(t.name)} set ${sql.join(
              columns.map((c) => sql`${sql.identifier(c)} = null`),
              sql`, `,
            )} where ${predicate(t, r)}`,
          );
          for (const c of columns) r[c] = null;
        }
      }
  let remaining = [...pending.values()].reduce((n, keys) => n + keys.size, 0);
  while (remaining) {
    let removed = 0;
    for (const table of tables) {
      const ready = table.rows.filter(
        (row) =>
          pending.get(table.name)!.has(rowKey(table, row)) &&
          !tables.some((child) =>
            child.foreignKeys.some(
              (fk) =>
                fk.target === table.name &&
                child.rows.some(
                  (r) =>
                    pending.get(child.name)!.has(rowKey(child, r)) &&
                    references(r, fk, row),
                ),
            ),
          ),
      );
      for (let offset = 0; offset < ready.length; offset += 250) {
        const batch = ready.slice(offset, offset + 250);
        const result = await tx.execute(
          sql`delete from ${sql.identifier(table.name)} where ${sql.join(
            batch.map((r) => sql`(${predicate(table, r)})`),
            sql` or `,
          )}`,
        );
        if (result.rowCount !== batch.length)
          throw new Error("Reset affected-row count changed under lock");
        for (const r of batch)
          pending.get(table.name)!.delete(rowKey(table, r));
        counts[table.name] = (counts[table.name] ?? 0) + batch.length;
        removed += batch.length;
      }
    }
    if (!removed) throw new Error("Unresolved reset dependency cycle");
    remaining -= removed;
  }
  return counts;
}
/** Verify target removal, all remaining registered FK relationships, and untouched survivors. */
export async function verifyResetIntegrity(
  tx: Transaction,
  before: readonly ResetTable[],
  plan: ResetPlan,
) {
  const after = await readResetInventory(tx);
  for (const table of after) {
    const prior = before.find((t) => t.name === table.name)!;
    const deleted = new Set(plan.deleteKeys[table.name]);
    const expected = prior.rows.filter((r) => !deleted.has(rowKey(prior, r)));
    if (JSON.stringify(table.rows) !== JSON.stringify(expected))
      throw new Error(`Reset survivor mismatch: ${table.name}`);
    for (const fk of table.foreignKeys) {
      const target = after.find((t) => t.name === fk.target)!;
      for (const row of table.rows)
        if (
          fk.columns.every((c) => row[c] != null) &&
          !target.rows.some((r) => references(row, fk, r))
        )
          throw new Error(`Reset integrity violation: ${table.name}`);
    }
  }
  return after;
}
export async function findResetOperation(tx: Transaction, id: string) {
  return (
    await tx
      .select({ id: resetOperations.id })
      .from(resetOperations)
      .where(eq(resetOperations.id, id))
  )[0];
}
export async function recordResetOperation(
  tx: Transaction,
  record: typeof resetOperations.$inferInsert,
) {
  await tx.insert(resetOperations).values(record).onConflictDoNothing();
}
