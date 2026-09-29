import { date, timestamp, uuid } from "drizzle-orm/pg-core";

/** Surrogate key. */
export const id = () => uuid().primaryKey().defaultRandom();

/** A calendar day, read and written as an ISO `YYYY-MM-DD` string (never a JS Date). */
export const isoDay = () => date({ mode: "string" });

/** An instant. */
export const instant = () => timestamp({ withTimezone: true, mode: "date" });

export const createdAt = () => instant().notNull().defaultNow();
