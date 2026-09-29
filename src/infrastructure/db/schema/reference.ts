import { boolean, integer, pgTable, text } from "drizzle-orm/pg-core";

/**
 * Shift types (reference data, inserted by migration 0002). Mirrors
 * `SHIFT_TYPES` in the domain; an integration test keeps them in sync.
 */
export const shiftTypes = pgTable("shift_types", {
  code: text().primaryKey(),
  label: text().notNull(),
  covers: text().array().notNull(),
  isNight: boolean().notNull(),
  sortOrder: integer().notNull(),
});
