import { sql } from "drizzle-orm";
import { check, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt } from "./columns";
/** Independent administrative evidence. No operational FK and never a reset category. */
export const resetOperations = pgTable(
  "reset_operations",
  {
    id: uuid().primaryKey(),
    executingAdminId: uuid().notNull(),
    scope: jsonb()
      .$type<{ kind: string; departmentIds?: readonly string[] }>()
      .notNull(),
    selectedCategories: jsonb().$type<readonly string[]>().notNull(),
    automaticCategories: jsonb().$type<readonly string[]>().notNull(),
    occurredAt: createdAt(),
    result: text().notNull(),
    counts: jsonb().$type<Record<string, number>>().notNull().default({}),
    errorCode: text(),
  },
  (t) => [
    check(
      "reset_operations_result_check",
      sql`${t.result} in ('COMPLETED','FAILED')`,
    ),
  ],
);
