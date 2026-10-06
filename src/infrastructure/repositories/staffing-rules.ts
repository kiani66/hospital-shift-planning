import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";

import type { BaseShift } from "../../domain/shifts/shift-type";
import type {
  CoverageBounds,
  RuleSetContent,
  RuleSetRetireReason,
  RuleSetVersionHead,
} from "../../domain/staffing-rules/model";
import type { DbExecutor, Transaction } from "../db/database";
import {
  scheduleRuleSetApplications,
  schedules,
  scheduleVersions,
  staffingRuleSetDateExceptions,
  staffingRuleSetRequirements,
  staffingRuleSets,
  staffingRuleSetVersions,
} from "../db/schema";
import { asIsoDate } from "./mappers";

/**
 * Staffing rule sets (D105). Reads here; content of a PUBLISHED or RETIRED
 * version is never updated or deleted by any function of this module (only
 * drafts are, see the write functions below).
 */

export interface RuleSetVersionRecord extends RuleSetVersionHead {
  readonly note: string | null;
  readonly origin: "USER" | "MIGRATION";
  /** Draft edit counter (optimistic concurrency). */
  readonly revision: number;
  readonly basedOnVersionId: string | null;
  readonly createdBy: string | null;
  readonly createdAt: Date;
  readonly publishedBy: string | null;
  readonly publishedAt: Date | null;
  readonly retiredBy: string | null;
  readonly retiredAt: Date | null;
  readonly retiredReason: RuleSetRetireReason | null;
  readonly replacedByVersionId: string | null;
}

const versionColumns = {
  id: staffingRuleSetVersions.id,
  ruleSetId: staffingRuleSetVersions.ruleSetId,
  departmentId: staffingRuleSets.departmentId,
  versionNo: staffingRuleSetVersions.versionNo,
  status: staffingRuleSetVersions.status,
  effectiveFrom: staffingRuleSetVersions.effectiveFrom,
  note: staffingRuleSetVersions.note,
  origin: staffingRuleSetVersions.origin,
  revision: staffingRuleSetVersions.revision,
  basedOnVersionId: staffingRuleSetVersions.basedOnVersionId,
  createdBy: staffingRuleSetVersions.createdBy,
  createdAt: staffingRuleSetVersions.createdAt,
  publishedBy: staffingRuleSetVersions.publishedBy,
  publishedAt: staffingRuleSetVersions.publishedAt,
  retiredBy: staffingRuleSetVersions.retiredBy,
  retiredAt: staffingRuleSetVersions.retiredAt,
  retiredReason: staffingRuleSetVersions.retiredReason,
  replacedByVersionId: staffingRuleSetVersions.replacedByVersionId,
};

type VersionRow = {
  [K in keyof typeof versionColumns]:
    (typeof versionColumns)[K]["_"]["data"] | null;
};

const toVersion = (row: VersionRow): RuleSetVersionRecord =>
  ({
    ...row,
    effectiveFrom: row.effectiveFrom ? asIsoDate(row.effectiveFrom) : null,
    origin: row.origin === "MIGRATION" ? "MIGRATION" : "USER",
  }) as RuleSetVersionRecord;

const selectVersions = (db: DbExecutor) =>
  db
    .select(versionColumns)
    .from(staffingRuleSetVersions)
    .innerJoin(
      staffingRuleSets,
      eq(staffingRuleSets.id, staffingRuleSetVersions.ruleSetId),
    );

export async function findRuleSetVersion(
  db: DbExecutor,
  id: string,
): Promise<RuleSetVersionRecord | null> {
  const [row] = await selectVersions(db).where(
    eq(staffingRuleSetVersions.id, id),
  );
  return row ? toVersion(row) : null;
}

export async function findRuleSetVersions(
  db: DbExecutor,
  ids: readonly string[],
): Promise<RuleSetVersionRecord[]> {
  if (ids.length === 0) return [];
  const rows = await selectVersions(db).where(
    inArray(staffingRuleSetVersions.id, [...ids]),
  );
  return rows.map(toVersion);
}

/**
 * Every version applicable to a department's schedules: the Hospital
 * Default lineage and the department's own lineage (if any), oldest first.
 * One query.
 */
export async function listApplicableRuleSetVersions(
  db: DbExecutor,
  departmentId: string,
): Promise<RuleSetVersionRecord[]> {
  const rows = await selectVersions(db)
    .where(
      or(
        isNull(staffingRuleSets.departmentId),
        eq(staffingRuleSets.departmentId, departmentId),
      ),
    )
    .orderBy(
      asc(staffingRuleSets.departmentId),
      asc(staffingRuleSetVersions.versionNo),
    );
  return rows.map(toVersion);
}

/** Every version of every lineage (the Hospital Admin's overview), oldest first. */
export async function listAllRuleSetVersions(
  db: DbExecutor,
): Promise<RuleSetVersionRecord[]> {
  const rows = await selectVersions(db).orderBy(
    asc(staffingRuleSets.departmentId),
    asc(staffingRuleSetVersions.versionNo),
  );
  return rows.map(toVersion);
}

const toBounds = (row: {
  minStaff: number;
  maxStaff: number | null;
}): CoverageBounds => ({ min: row.minStaff, max: row.maxStaff });

/**
 * The stored content of each version (two queries whatever their number).
 * A version without NORMAL rows cannot exist (they are written with it).
 */
export async function loadRuleSetContents(
  db: DbExecutor,
  versionIds: readonly string[],
): Promise<Map<string, RuleSetContent>> {
  const ids = [...new Set(versionIds)];
  if (ids.length === 0) return new Map();
  const [requirements, exceptions] = await Promise.all([
    db
      .select()
      .from(staffingRuleSetRequirements)
      .where(inArray(staffingRuleSetRequirements.versionId, ids)),
    db
      .select()
      .from(staffingRuleSetDateExceptions)
      .where(inArray(staffingRuleSetDateExceptions.versionId, ids))
      .orderBy(
        asc(staffingRuleSetDateExceptions.date),
        asc(staffingRuleSetDateExceptions.coveragePeriod),
      ),
  ]);
  const contents = new Map<
    string,
    {
      normal: Partial<Record<BaseShift, CoverageBounds>>;
      holiday: Partial<Record<BaseShift, CoverageBounds>>;
      exceptions: RuleSetContent["exceptions"][number][];
    }
  >(ids.map((id) => [id, { normal: {}, holiday: {}, exceptions: [] }]));
  for (const r of requirements) {
    const content = contents.get(r.versionId)!;
    (r.dayType === "NORMAL" ? content.normal : content.holiday)[
      r.coveragePeriod
    ] = toBounds(r);
  }
  for (const e of exceptions)
    contents.get(e.versionId)!.exceptions.push({
      date: asIsoDate(e.date),
      period: e.coveragePeriod,
      bounds: toBounds(e),
      note: e.note,
    });
  return contents as Map<string, RuleSetContent>;
}

export async function loadRuleSetContent(
  db: DbExecutor,
  versionId: string,
): Promise<RuleSetContent> {
  return (await loadRuleSetContents(db, [versionId])).get(versionId)!;
}

/** The lineage of a scope (null: the Hospital Default), if it exists. */
export async function findRuleSetLineage(
  db: DbExecutor,
  departmentId: string | null,
): Promise<{ id: string; departmentId: string | null } | null> {
  const [row] = await db
    .select({
      id: staffingRuleSets.id,
      departmentId: staffingRuleSets.departmentId,
    })
    .from(staffingRuleSets)
    .where(
      departmentId === null
        ? isNull(staffingRuleSets.departmentId)
        : eq(staffingRuleSets.departmentId, departmentId),
    );
  return row ?? null;
}

// --- Writes -----------------------------------------------------------------
// Content is written only for DRAFT versions (every statement below that
// touches content or deletes filters on status = 'DRAFT'). Publishing and
// retiring change lifecycle columns only, never content.

/**
 * Locks the lineage of a scope for the rest of the transaction, creating it
 * first if needed. Every rule-set write of a scope is serialized on it.
 */
export async function lockRuleSetLineage(
  tx: Transaction,
  departmentId: string | null,
): Promise<{ id: string; departmentId: string | null }> {
  await tx
    .insert(staffingRuleSets)
    .values({ departmentId })
    .onConflictDoNothing();
  const [row] = await tx
    .select({
      id: staffingRuleSets.id,
      departmentId: staffingRuleSets.departmentId,
    })
    .from(staffingRuleSets)
    .where(
      departmentId === null
        ? isNull(staffingRuleSets.departmentId)
        : eq(staffingRuleSets.departmentId, departmentId),
    )
    .for("update");
  return row!;
}

async function writeContent(
  db: DbExecutor,
  versionId: string,
  content: RuleSetContent,
): Promise<void> {
  const requirements = [
    ...Object.entries(content.normal).map(([p, b]) => ({
      dayType: "NORMAL" as const,
      p,
      b,
    })),
    ...Object.entries(content.holiday).map(([p, b]) => ({
      dayType: "HOLIDAY" as const,
      p,
      b,
    })),
  ].filter((r) => r.b);
  await db.insert(staffingRuleSetRequirements).values(
    requirements.map(({ dayType, p, b }) => ({
      versionId,
      dayType,
      coveragePeriod: p as BaseShift,
      minStaff: b!.min,
      maxStaff: b!.max,
    })),
  );
  if (content.exceptions.length > 0)
    await db.insert(staffingRuleSetDateExceptions).values(
      content.exceptions.map((e) => ({
        versionId,
        date: e.date,
        coveragePeriod: e.period,
        minStaff: e.bounds.min,
        maxStaff: e.bounds.max,
        note: e.note,
      })),
    );
}

/** Inserts the next version of a lineage as a DRAFT with its content. */
export async function insertRuleSetDraft(
  db: DbExecutor,
  input: {
    ruleSetId: string;
    basedOnVersionId: string | null;
    content: RuleSetContent;
    note: string | null;
    createdBy: string;
  },
): Promise<string> {
  const [row] = await db
    .insert(staffingRuleSetVersions)
    .values({
      ruleSetId: input.ruleSetId,
      versionNo: sql`(select coalesce(max(${staffingRuleSetVersions.versionNo}), 0) + 1 from ${staffingRuleSetVersions} where ${staffingRuleSetVersions.ruleSetId} = ${input.ruleSetId})`,
      basedOnVersionId: input.basedOnVersionId,
      note: input.note,
      createdBy: input.createdBy,
    })
    .returning({ id: staffingRuleSetVersions.id });
  await writeContent(db, row!.id, input.content);
  return row!.id;
}

/**
 * Replaces a DRAFT's content when its revision still matches; returns false
 * when the version is not a draft any more or was changed meanwhile.
 */
export async function replaceRuleSetDraft(
  db: DbExecutor,
  input: {
    versionId: string;
    expectedRevision: number;
    content: RuleSetContent;
    note: string | null;
  },
): Promise<boolean> {
  const updated = await db
    .update(staffingRuleSetVersions)
    .set({
      note: input.note,
      revision: sql`${staffingRuleSetVersions.revision} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(staffingRuleSetVersions.id, input.versionId),
        eq(staffingRuleSetVersions.status, "DRAFT"),
        eq(staffingRuleSetVersions.revision, input.expectedRevision),
      ),
    )
    .returning({ id: staffingRuleSetVersions.id });
  if (updated.length === 0) return false;
  await db
    .delete(staffingRuleSetRequirements)
    .where(eq(staffingRuleSetRequirements.versionId, input.versionId));
  await db
    .delete(staffingRuleSetDateExceptions)
    .where(eq(staffingRuleSetDateExceptions.versionId, input.versionId));
  await writeContent(db, input.versionId, input.content);
  return true;
}

/** Deletes a never-published DRAFT (its content cascades). */
export async function deleteRuleSetDraft(
  db: DbExecutor,
  input: { versionId: string; expectedRevision: number },
): Promise<boolean> {
  const deleted = await db
    .delete(staffingRuleSetVersions)
    .where(
      and(
        eq(staffingRuleSetVersions.id, input.versionId),
        eq(staffingRuleSetVersions.status, "DRAFT"),
        eq(staffingRuleSetVersions.revision, input.expectedRevision),
      ),
    )
    .returning({ id: staffingRuleSetVersions.id });
  return deleted.length > 0;
}

/** DRAFT → PUBLISHED (lifecycle columns only). */
export async function markRuleSetPublished(
  db: DbExecutor,
  input: {
    versionId: string;
    expectedRevision: number;
    effectiveFrom: string;
    publishedBy: string;
    now: Date;
  },
): Promise<boolean> {
  const updated = await db
    .update(staffingRuleSetVersions)
    .set({
      status: "PUBLISHED",
      effectiveFrom: input.effectiveFrom,
      publishedBy: input.publishedBy,
      publishedAt: input.now,
      revision: sql`${staffingRuleSetVersions.revision} + 1`,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(staffingRuleSetVersions.id, input.versionId),
        eq(staffingRuleSetVersions.status, "DRAFT"),
        eq(staffingRuleSetVersions.revision, input.expectedRevision),
      ),
    )
    .returning({ id: staffingRuleSetVersions.id });
  return updated.length > 0;
}

/** PUBLISHED → RETIRED (lifecycle columns only). */
export async function markRuleSetRetired(
  db: DbExecutor,
  input: {
    versionId: string;
    reason: RuleSetRetireReason;
    retiredBy: string;
    replacedByVersionId: string | null;
    now: Date;
  },
): Promise<boolean> {
  const updated = await db
    .update(staffingRuleSetVersions)
    .set({
      status: "RETIRED",
      retiredBy: input.retiredBy,
      retiredAt: input.now,
      retiredReason: input.reason,
      replacedByVersionId: input.replacedByVersionId,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(staffingRuleSetVersions.id, input.versionId),
        eq(staffingRuleSetVersions.status, "PUBLISHED"),
      ),
    )
    .returning({ id: staffingRuleSetVersions.id });
  return updated.length > 0;
}

/**
 * How many schedules (working pins) and approved versions reference each
 * version; two grouped queries whatever the number of versions.
 */
export async function countRuleSetPins(
  db: DbExecutor,
  versionIds: readonly string[],
): Promise<Map<string, { schedules: number; approvedVersions: number }>> {
  const ids = [...new Set(versionIds)];
  const counts = new Map(
    ids.map((id) => [id, { schedules: 0, approvedVersions: 0 }]),
  );
  if (ids.length === 0) return counts;
  const [pins, approved] = await Promise.all([
    db
      .select({
        id: schedules.staffingRuleSetVersionId,
        n: sql<number>`count(*)::int`,
      })
      .from(schedules)
      .where(inArray(schedules.staffingRuleSetVersionId, ids))
      .groupBy(schedules.staffingRuleSetVersionId),
    db
      .select({
        id: scheduleVersions.staffingRuleSetVersionId,
        n: sql<number>`count(*)::int`,
      })
      .from(scheduleVersions)
      .where(inArray(scheduleVersions.staffingRuleSetVersionId, ids))
      .groupBy(scheduleVersions.staffingRuleSetVersionId),
  ]);
  for (const p of pins) counts.get(p.id)!.schedules = p.n;
  for (const a of approved) counts.get(a.id)!.approvedVersions = a.n;
  return counts;
}

// --- Apply history (append-only) -------------------------------------------

export interface RuleSetApplicationRecord {
  readonly id: string;
  readonly scheduleId: string;
  readonly fromVersionId: string;
  readonly toVersionId: string;
  readonly revisionId: string | null;
  readonly rollback: boolean;
  readonly appliedBy: string;
  readonly appliedAt: Date;
  readonly impact: Record<string, unknown>;
}

/** Records one explicit Apply (D107, D110). Never updated or deleted. */
export async function insertRuleSetApplication(
  db: DbExecutor,
  input: Omit<RuleSetApplicationRecord, "id">,
): Promise<string> {
  const [row] = await db
    .insert(scheduleRuleSetApplications)
    .values(input)
    .returning({ id: scheduleRuleSetApplications.id });
  return row!.id;
}

/** The Apply history of the given schedules, newest first (one query). */
export async function listRuleSetApplications(
  db: DbExecutor,
  scheduleIds: readonly string[],
): Promise<RuleSetApplicationRecord[]> {
  if (scheduleIds.length === 0) return [];
  return db
    .select()
    .from(scheduleRuleSetApplications)
    .where(inArray(scheduleRuleSetApplications.scheduleId, [...scheduleIds]))
    .orderBy(sql`${scheduleRuleSetApplications.appliedAt} desc`);
}

/** Approved versions per rule-set version among the given schedules (one query). */
export async function countApprovedVersionPins(
  db: DbExecutor,
  scheduleIds: readonly string[],
): Promise<Map<string, number>> {
  if (scheduleIds.length === 0) return new Map();
  const rows = await db
    .select({
      id: scheduleVersions.staffingRuleSetVersionId,
      n: sql<number>`count(*)::int`,
    })
    .from(scheduleVersions)
    .where(inArray(scheduleVersions.scheduleId, [...scheduleIds]))
    .groupBy(scheduleVersions.staffingRuleSetVersionId);
  return new Map(rows.map((r) => [r.id, r.n]));
}
