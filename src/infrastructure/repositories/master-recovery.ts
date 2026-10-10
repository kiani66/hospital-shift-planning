import type { Transaction } from "../db/database";
import {
  shiftTypes,
  changeReasons,
  staffingRuleSets,
  staffingRuleSetVersions,
  staffingRuleSetRequirements,
  HOSPITAL_RULE_SET_ID,
  LEGACY_BASELINE_VERSION_ID,
  LEGACY_BASELINE_EFFECTIVE_FROM,
  LEGACY_BASELINE_BOUNDS,
} from "../db/schema";
import { COVERAGE_PERIODS } from "../../domain/shifts/shift-type";

/** Exact migration 0002/0010/0012 defaults; existing labels/definitions are never replaced. */
export const RECOVERY_SHIFTS = [
  { code: "M", label: "صبح", covers: ["M"], isNight: false, sortOrder: 1 },
  { code: "E", label: "عصر", covers: ["E"], isNight: false, sortOrder: 2 },
  { code: "N", label: "شب", covers: ["N"], isNight: true, sortOrder: 3 },
  {
    code: "ME",
    label: "طولانی",
    covers: ["M", "E"],
    isNight: false,
    sortOrder: 4,
  },
  { code: "OFF", label: "استراحت", covers: [], isNight: false, sortOrder: 5 },
];
/** Exact migration 0007 defaults. Inactive/custom existing reasons are left alone. */
export const RECOVERY_REASONS: (typeof changeReasons.$inferInsert)[] = [
  {
    code: "ILLNESS",
    label: "بیماری",
    scope: "BOTH",
    requiresNote: false,
    isActive: true,
    sortOrder: 1,
  },
  {
    code: "FAMILY_EMERGENCY",
    label: "فوریت خانوادگی",
    scope: "REQUEST",
    requiresNote: false,
    isActive: true,
    sortOrder: 2,
  },
  {
    code: "PERSONAL_MATTER",
    label: "کار شخصی",
    scope: "REQUEST",
    requiresNote: false,
    isActive: true,
    sortOrder: 3,
  },
  {
    code: "EDUCATION",
    label: "آموزش یا دوره",
    scope: "BOTH",
    requiresNote: false,
    isActive: true,
    sortOrder: 4,
  },
  {
    code: "STAFFING_NEED",
    label: "نیاز عملیاتی بخش",
    scope: "ADJUSTMENT",
    requiresNote: false,
    isActive: true,
    sortOrder: 5,
  },
  {
    code: "WORKLOAD_BALANCE",
    label: "تعادل بار کاری",
    scope: "ADJUSTMENT",
    requiresNote: false,
    isActive: true,
    sortOrder: 6,
  },
  {
    code: "OTHER",
    label: "سایر",
    scope: "BOTH",
    requiresNote: true,
    isActive: true,
    sortOrder: 99,
  },
];
export async function restoreMissingMasterData(
  tx: Transaction,
  plan: {
    shiftCodes: readonly string[];
    reasonCodes: readonly string[];
    restoreBaseline: boolean;
    hospitalRuleSetId: string | null;
  },
  now: Date,
) {
  if (plan.shiftCodes.length)
    await tx
      .insert(shiftTypes)
      .values(RECOVERY_SHIFTS.filter((r) => plan.shiftCodes.includes(r.code)));
  if (plan.reasonCodes.length)
    await tx
      .insert(changeReasons)
      .values(
        RECOVERY_REASONS.filter((r) => plan.reasonCodes.includes(r.code)),
      );
  if (plan.restoreBaseline) {
    const ruleSetId = plan.hospitalRuleSetId ?? HOSPITAL_RULE_SET_ID;
    if (!plan.hospitalRuleSetId)
      await tx
        .insert(staffingRuleSets)
        .values({ id: ruleSetId, departmentId: null });
    // Restore the exact migration baseline identity and origin, including compatibility FK defaults.
    // This is restoration, not publishing a new hospital policy or editing an existing version.
    await tx.insert(staffingRuleSetVersions).values({
      id: LEGACY_BASELINE_VERSION_ID,
      ruleSetId,
      versionNo: 1,
      status: "PUBLISHED",
      effectiveFrom: LEGACY_BASELINE_EFFECTIVE_FROM,
      origin: "MIGRATION",
      publishedAt: now,
      note: "قانون پایه پیشین سامانه: دست‌کم یک نفر در هر نوبت، بدون حداکثر",
    });
    await tx.insert(staffingRuleSetRequirements).values(
      COVERAGE_PERIODS.map((coveragePeriod) => ({
        versionId: LEGACY_BASELINE_VERSION_ID,
        dayType: "NORMAL" as const,
        coveragePeriod,
        minStaff: LEGACY_BASELINE_BOUNDS.min,
        maxStaff: LEGACY_BASELINE_BOUNDS.max,
      })),
    );
  }
}
