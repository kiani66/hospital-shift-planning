import { integer, pgTable, text } from "drizzle-orm/pg-core";

import { instant } from "./columns";

/**
 * Failed sign-in attempts per e-mail address (login throttling). Keyed by a
 * SHA-256 hash of the normalized address, so arbitrary input is never stored
 * and unknown addresses are throttled exactly like known ones (no account
 * enumeration). A successful sign-in deletes the row.
 */
export const loginThrottles = pgTable("login_throttles", {
  keyHash: text().primaryKey(),
  failedCount: integer().notNull(),
  /** Start of the current counting window. */
  windowStartedAt: instant().notNull(),
  /** Sign-in is refused for this key until then. */
  lockedUntil: instant(),
});
