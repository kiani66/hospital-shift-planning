import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import type {
  StatisticColumn,
  SummaryRow,
} from "../../../domain/excel-export/template-mapping";
import { createdAt, id, instant } from "./columns";
import { departments } from "./identity";

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
 * Department configuration: it belongs to its department and is registered
 * in the Phase 14 reset's `departments` category, so a reset that deletes a
 * department deletes its templates with it (never orphaned), while an
 * operational reset keeps them. `uploaded_by` / `mapping_updated_by` are
 * evidence without a foreign key, so templates never retain personnel; the
 * audit trail keeps the authoritative actor of every upload and change.
 */
export const departmentExcelTemplates = pgTable(
  "department_excel_templates",
  {
    id: id(),
    departmentId: uuid()
      .notNull()
      .references(() => departments.id),
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
    /** Optional row that gets the period's day numbers (migration 0017). */
    dayHeaderRow: integer(),
    /** Per-person statistic columns (validated by the domain mapping). */
    statisticColumns: jsonb()
      .$type<readonly StatisticColumn[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** Daily summary rows (validated by the domain mapping). */
    summaryRows: jsonb()
      .$type<readonly SummaryRow[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
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
      "department_excel_templates_day_header_row_check",
      sql`${t.dayHeaderRow} is null or ${t.dayHeaderRow} >= 1`,
    ),
    check(
      "department_excel_templates_statistics_check",
      sql`jsonb_typeof(${t.statisticColumns}) = 'array' and jsonb_typeof(${t.summaryRows}) = 'array'`,
    ),
    check(
      "department_excel_templates_columns_check",
      sql`${t.personnelColumn} ~ '^[A-Z]{1,3}$' and ${t.firstDayColumn} ~ '^[A-Z]{1,3}$'`,
    ),
  ],
);
