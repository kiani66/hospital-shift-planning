import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import type {
  CalendarActorSnapshot,
  CalendarDay,
} from "../../domain/calendar/official-calendar";
import { generateCalendarDays, calendarYearPeriod } from "../calendar/base";
import type { DbExecutor, Transaction } from "../db/database";
import {
  officialCalendarAuditEvents as audits,
  officialCalendarVersionDays as days,
  officialCalendarVersions as versions,
  officialCalendarYears as years,
} from "../db/schema";
import { asIsoDate } from "./mappers";

export type CalendarVersionRecord = typeof versions.$inferSelect;

export async function findCalendarYear(db: DbExecutor, year: number) {
  return (await db.select().from(years).where(eq(years.year, year)))[0] ?? null;
}

export async function findCalendarVersion(db: DbExecutor, id: string) {
  return (
    (await db.select().from(versions).where(eq(versions.id, id)))[0] ?? null
  );
}

export async function listCalendarVersions(db: DbExecutor, year: number) {
  return db
    .select()
    .from(versions)
    .where(eq(versions.year, year))
    .orderBy(desc(versions.versionNo));
}

export async function loadCalendarDays(
  db: DbExecutor,
  versionId: string,
): Promise<CalendarDay[]> {
  const rows = await db
    .select()
    .from(days)
    .where(eq(days.versionId, versionId))
    .orderBy(asc(days.date));
  return rows.map(({ date, ...row }) => ({ ...row, date: asIsoDate(date) }));
}

export async function listCalendarAudit(
  db: DbExecutor,
  versionIds: readonly string[],
) {
  if (!versionIds.length) return [];
  return db
    .select()
    .from(audits)
    .where(inArray(audits.versionId, [...versionIds]))
    .orderBy(asc(audits.occurredAt), asc(audits.id));
}

/** Must run within the command transaction. Missing-year insertion and all writes serialize here. */
export async function lockCalendarYear(tx: Transaction, year: number) {
  return (
    await tx.select().from(years).where(eq(years.year, year)).for("update")
  )[0]!;
}

export async function appendCalendarVersion(
  tx: Transaction,
  input: Omit<
    typeof versions.$inferInsert,
    "id" | "confirmedBy" | "confirmedAt"
  >,
  content: readonly CalendarDay[],
) {
  const [version] = await tx.insert(versions).values(input).returning();
  await tx
    .insert(days)
    .values(content.map((day) => ({ ...day, versionId: version!.id })));
  await tx.insert(audits).values({
    versionId: version!.id,
    action: input.origin === "GENERATED" ? "GENERATED" : "IMPORTED",
    actor: input.createdBy,
    occurredAt: version!.createdAt,
    data: {
      year: input.year,
      versionNo: input.versionNo,
      basedOnVersionId: input.basedOnVersionId ?? null,
      reason: input.reason,
    },
  });
  return version!;
}

/** Add-only initializer. Never updates an existing year, version, day or audit event. */
export async function ensureBaseCalendarYear(
  tx: Transaction,
  year: number,
  actor: CalendarActorSnapshot,
  now: Date,
) {
  const period = calendarYearPeriod(year);
  const inserted = await tx
    .insert(years)
    .values({
      year,
      periodStart: period.start,
      periodEnd: period.end,
      createdAt: now,
    })
    .onConflictDoNothing()
    .returning();
  const calendar = await lockCalendarYear(tx, year);
  if (inserted.length) {
    await appendCalendarVersion(
      tx,
      {
        year,
        versionNo: 1,
        basedOnVersionId: null,
        origin: "GENERATED",
        completeness: "UNKNOWN",
        source: null,
        reason: "Deterministic base calendar; official holidays unknown",
        createdBy: actor,
        createdAt: now,
      },
      generateCalendarDays(year),
    );
  }
  return calendar;
}

/** Called under the year row lock; content is never changed and confirmation cannot be repeated. */
export async function confirmCalendarVersion(
  tx: Transaction,
  versionId: string,
  actor: CalendarActorSnapshot,
  now: Date,
) {
  await tx
    .update(versions)
    .set({ confirmedBy: actor, confirmedAt: now })
    .where(
      sql`${versions.id} = ${versionId} and ${versions.confirmedAt} is null`,
    );
  const version = (await findCalendarVersion(tx, versionId))!;
  await tx
    .update(years)
    .set({ activeVersionId: versionId, confirmationStatus: "CONFIRMED" })
    .where(eq(years.year, version.year));
  await tx.insert(audits).values({
    versionId,
    action: "CONFIRMED",
    actor,
    occurredAt: now,
    data: {
      year: version.year,
      previousActiveVersionId: version.basedOnVersionId,
    },
  });
}
