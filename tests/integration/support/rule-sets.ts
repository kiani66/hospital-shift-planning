import { and, eq, isNull, sql } from "drizzle-orm";

import type { RuleSetContent } from "../../../src/domain/staffing-rules/model";
import type { DbExecutor } from "../../../src/infrastructure/db/database";
import {
  schedules,
  staffingRuleSetDateExceptions,
  staffingRuleSetRequirements,
  staffingRuleSets,
  staffingRuleSetVersions,
} from "../../../src/infrastructure/db/schema";

/**
 * Test data only: stores a PUBLISHED rule-set version directly (the
 * Hospital Admin workflow has its own tests) and pins schedules to it.
 */
export async function publishTestRuleSet(
  db: DbExecutor,
  input: {
    departmentId: string | null;
    content: RuleSetContent;
    createdBy: string;
    effectiveFrom?: string;
  },
): Promise<string> {
  const [existing] = await db
    .select({ id: staffingRuleSets.id })
    .from(staffingRuleSets)
    .where(
      input.departmentId === null
        ? isNull(staffingRuleSets.departmentId)
        : eq(staffingRuleSets.departmentId, input.departmentId),
    );
  const ruleSetId =
    existing?.id ??
    (
      await db
        .insert(staffingRuleSets)
        .values({ departmentId: input.departmentId })
        .returning({ id: staffingRuleSets.id })
    )[0]!.id;
  const [version] = await db
    .insert(staffingRuleSetVersions)
    .values({
      ruleSetId,
      versionNo: sql`(select coalesce(max(${staffingRuleSetVersions.versionNo}), 0) + 1 from ${staffingRuleSetVersions} where ${staffingRuleSetVersions.ruleSetId} = ${ruleSetId})`,
      status: "PUBLISHED",
      effectiveFrom: input.effectiveFrom ?? "2000-01-01",
      createdBy: input.createdBy,
      publishedBy: input.createdBy,
      publishedAt: new Date(),
    })
    .returning({ id: staffingRuleSetVersions.id });
  const versionId = version!.id;
  const rows = [
    ...Object.entries(input.content.normal).map(([p, b]) => ({
      dayType: "NORMAL" as const,
      p,
      b,
    })),
    ...Object.entries(input.content.holiday).map(([p, b]) => ({
      dayType: "HOLIDAY" as const,
      p,
      b,
    })),
  ];
  await db.insert(staffingRuleSetRequirements).values(
    rows.map(({ dayType, p, b }) => ({
      versionId,
      dayType,
      coveragePeriod: p as "M" | "E" | "N",
      minStaff: b!.min,
      maxStaff: b!.max,
    })),
  );
  if (input.content.exceptions.length > 0)
    await db.insert(staffingRuleSetDateExceptions).values(
      input.content.exceptions.map((e) => ({
        versionId,
        date: e.date,
        coveragePeriod: e.period,
        minStaff: e.bounds.min,
        maxStaff: e.bounds.max,
        note: e.note,
      })),
    );
  return versionId;
}

/** Test data only: pins a schedule without the Apply workflow. */
export async function pinTestRuleSet(
  db: DbExecutor,
  scheduleId: string,
  versionId: string,
): Promise<void> {
  await db
    .update(schedules)
    .set({ staffingRuleSetVersionId: versionId })
    .where(and(eq(schedules.id, scheduleId)));
}

/** M/E/N bounds for every normal day, plus optional exceptions. */
export const ruleContent = (
  normal: { min: number; max: number | null },
  extra: Partial<RuleSetContent> = {},
): RuleSetContent => ({
  normal: { M: normal, E: normal, N: normal },
  holiday: {},
  exceptions: [],
  ...extra,
});
