import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  integer,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { createdAt, id, instant } from "./columns";

/** PostgreSQL `bytea`, read and written as a Uint8Array. */
const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => "bytea",
  toDriver: (value) => Buffer.from(value),
  fromDriver: (value) => new Uint8Array(value),
});

/**
 * A department's uploaded Excel export template (D124): the workbook bytes,
 * their cell mapping and who uploaded them. The bytes never change after the
 * insert; a replacement is a new row and the old one is deactivated in the
 * same transaction. At most one row per department is active.
 *
 * Configuration outside the Phase 14 reset registry: like `reset_operations`
 * it has no operational foreign key (the reset refuses unregistered foreign
 * keys into its tables), so no reset depends on or deletes it. The
 * application only reads it through an active department it may manage, so
 * a row whose department is gone is unreachable. The audit trail keeps the
 * authoritative actor of every upload and mapping change.
 */
export const departmentExcelTemplates = pgTable(
  "department_excel_templates",
  {
    id: id(),
    /** No foreign key: see above. */
    departmentId: uuid().notNull(),
    /** 1, 2, … per department, in upload order. */
    version: integer().notNull(),
    isActive: boolean().notNull(),
    fileName: text().notNull(),
    byteSize: integer().notNull(),
    /** Hex SHA-256 of `content`. */
    sha256: text().notNull(),
    content: bytea().notNull(),
    sheetName: text().notNull(),
    personnelColumn: text().notNull(),
    firstRow: integer().notNull(),
    lastRow: integer().notNull(),
    firstDayColumn: text().notNull(),
    /** Optimistic-concurrency counter, bumped by every mapping change. */
    revision: integer().notNull().default(0),
    uploadedBy: uuid().notNull(),
    uploadedAt: createdAt(),
    mappingUpdatedBy: uuid(),
    mappingUpdatedAt: instant(),
  },
  (t) => [
    unique("department_excel_templates_version_key").on(
      t.departmentId,
      t.version,
    ),
    uniqueIndex("department_excel_templates_one_active_key")
      .on(t.departmentId)
      .where(sql`${t.isActive}`),
    check(
      "department_excel_templates_size_check",
      sql`${t.byteSize} > 0 and ${t.byteSize} = octet_length(${t.content})`,
    ),
    check(
      "department_excel_templates_rows_check",
      sql`${t.firstRow} >= 1 and ${t.lastRow} >= ${t.firstRow}`,
    ),
    check(
      "department_excel_templates_columns_check",
      sql`${t.personnelColumn} ~ '^[A-Z]{1,3}$' and ${t.firstDayColumn} ~ '^[A-Z]{1,3}$'`,
    ),
  ],
);
