import { asc, eq, inArray, isNull, or } from "drizzle-orm";

import type { BaseShift } from "../../domain/shifts/shift-type";
import type {
  CoverageBounds,
  RuleSetContent,
  RuleSetRetireReason,
  RuleSetVersionHead,
} from "../../domain/staffing-rules/model";
import type { DbExecutor } from "../db/database";
import {
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
