import { z } from "zod";
import { validateRuleSetContent } from "../../domain/staffing-rules/model";
import { unwrap } from "../../domain/shared/result";
import { ValidationError } from "../../domain/shared/errors";
import type { ResetTable } from "../../domain/reset/categories";
import {
  LEGACY_BASELINE_VERSION_ID,
  HOSPITAL_RULE_SET_ID,
  LEGACY_BASELINE_BOUNDS,
} from "../../infrastructure/db/schema";
import {
  RECOVERY_SHIFTS,
  RECOVERY_REASONS,
  restoreMissingMasterData,
} from "../../infrastructure/repositories/master-recovery";
import {
  readResetInventory,
  resetSchemaBlockers,
} from "../../infrastructure/repositories/reset-inventory";
import { lockResetData } from "../../infrastructure/repositories/reset-execution";
import { authorizeAdministration } from "../management/context";
import { ConflictError } from "../errors";
import { defineCommand, type AppContext } from "../use-case";
import {
  createResetProof,
  requireResetAdmin,
  resetFingerprint,
  verifyResetProof,
} from "./preview";

const selection = {
  scope: { kind: "APPLICATION" as const },
  categories: ["changeReasons", "hospitalStaffingRules", "shiftTypes"] as const,
};
// Domain-separate signed proofs: a recovery confirmation can never authorize Full Reset.
const purpose = { operation: "RESTORE_MASTER_DEFAULTS_V1", selection };
function recoveryPlan(tables: readonly ResetTable[]) {
  const rows = (name: string) => tables.find((t) => t.name === name)!.rows;
  const blockers: string[] = [];
  const warnings: string[] = [];
  const shiftCodes = RECOVERY_SHIFTS.filter(
    (d) => !rows("shift_types").some((r) => r.code === d.code),
  ).map((r) => r.code);
  const reasonCodes = RECOVERY_REASONS.filter(
    (d) => !rows("change_reasons").some((r) => r.code === d.code),
  ).map((r) => r.code);
  for (const d of RECOVERY_SHIFTS) {
    const r = rows("shift_types").find((r) => r.code === d.code);
    if (
      r &&
      (JSON.stringify(r.covers) !== JSON.stringify(d.covers) ||
        r.is_night !== d.isNight ||
        !String(r.label).trim())
    )
      blockers.push(
        `تعریف موجود ${d.code} با معنای شیفت سامانه سازگار نیست؛ بازیابی آن را بازنویسی نمی‌کند.`,
      );
  }
  const hospital = rows("staffing_rule_sets").find(
    (r) => r.department_id == null,
  );
  const versions = rows("staffing_rule_set_versions").filter(
    (r) => r.rule_set_id === hospital?.id,
  );
  const restoreBaseline = versions.length === 0;
  if (
    restoreBaseline &&
    rows("staffing_rule_set_versions").some(
      (r) => r.id === LEGACY_BASELINE_VERSION_ID,
    )
  )
    blockers.push(
      "شناسه خط پایه در تبار دیگری وجود دارد؛ بررسی اپراتور لازم است.",
    );
  if (
    !hospital &&
    rows("staffing_rule_sets").some((r) => r.id === HOSPITAL_RULE_SET_ID)
  )
    blockers.push(
      "شناسه تبار پیش‌فرض متعلق به بخش است؛ بررسی اپراتور لازم است.",
    );
  if (versions.length)
    warnings.push(
      "نسخه‌های موجود حفظ می‌شوند؛ خط پایه جایگزین سیاست موجود نمی‌شود. قانون قابل اعمال به ماه برنامه را در مدیریت قوانین پوشش بررسی کنید.",
    );
  if (versions.length && !versions.some((v) => v.status === "PUBLISHED"))
    warnings.push(
      "قانون منتشرشده بیمارستان وجود ندارد؛ پیش‌نویس موجود را با مقادیر تأییدشده بررسی و منتشر کنید.",
    );
  const inactive = rows("change_reasons").filter((r) => r.is_active !== true);
  if (inactive.length)
    warnings.push(
      `دلایل غیرفعال (${inactive.map((r) => String(r.code)).join("، ")}) غیرفعال می‌مانند؛ بازیابی آن‌ها را فعال نمی‌کند.`,
    );
  if (!rows("departments").some((r) => r.is_active === true))
    warnings.push(
      "هیچ بخش فعال وجود ندارد؛ تا ایجاد بخش تأییدشده و عضویت سرپرستار، ورود CSV و ایجاد برنامه ممکن نیست.",
    );
  if (restoreBaseline)
    warnings.push(
      "خط پایه پیشین سامانه: حداقل یک نفر در M/E/N، بدون حداکثر، از 1900-01-01؛ این اعداد نیاز بالینی بیمارستان را تعیین نمی‌کنند. پیش از استفاده عملیاتی، قانون پوشش تأییدشده را منتشر کنید.",
    );
  return {
    shiftCodes,
    reasonCodes,
    restoreBaseline,
    hospitalRuleSetId: hospital ? String(hospital.id) : null,
    preservedShiftCodes: rows("shift_types").map((r) => String(r.code)),
    preservedReasonCodes: rows("change_reasons").map((r) => String(r.code)),
    preservedStaffingVersions: versions.length,
    departmentCount: rows("departments").length,
    blockers,
    warnings,
    permitted: blockers.length === 0,
    counts: {
      shiftTypes: shiftCodes.length,
      changeReasons: reasonCodes.length,
      staffingRuleSets: restoreBaseline && !hospital ? 1 : 0,
      staffingRuleSetVersions: restoreBaseline ? 1 : 0,
      staffingRequirements: restoreBaseline ? 3 : 0,
    },
  };
}
export async function previewMasterRecovery(ctx: AppContext) {
  await requireResetAdmin(ctx);
  return ctx.db.transaction(
    async (tx) => {
      await requireResetAdmin({
        ...ctx,
        db: tx as unknown as AppContext["db"],
      });
      const inventory = await readResetInventory(tx);
      const plan = recoveryPlan(inventory);
      plan.blockers.push(...(await resetSchemaBlockers(tx)));
      plan.permitted = plan.blockers.length === 0;
      return {
        plan,
        ...createResetProof(
          ctx.actor.userId,
          purpose,
          resetFingerprint(
            inventory,
            { ...selection, categories: [...selection.categories] },
            ctx.actor.userId,
          ),
          (ctx.clock?.() ?? new Date()).getTime(),
        ),
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
export type MasterRecoveryPreview = Awaited<
  ReturnType<typeof previewMasterRecovery>
>;
export const executeMasterRecovery = defineCommand({
  name: "masterData.restoreDefaults",
  input: z.object({
    previewId: z.uuid(),
    issuedAt: z.number().int().nonnegative(),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    proof: z.string().regex(/^[a-f0-9]{64}$/),
    confirmed: z.literal(true),
  }),
  async handler(uow, input) {
    await authorizeAdministration(uow, "dataReset.manage");
    verifyResetProof(uow.actor.userId, purpose, input, uow.now.getTime());
    if (!(await lockResetData(uow.tx)))
      throw new ConflictError("A writer is active", "RESET_BUSY");
    await requireResetAdmin({
      db: uow.tx as unknown as AppContext["db"],
      actor: uow.actor,
      clock: () => uow.now,
    });
    const inventory = await readResetInventory(uow.tx);
    if (
      resetFingerprint(
        inventory,
        { ...selection, categories: [...selection.categories] },
        uow.actor.userId,
      ) !== input.fingerprint
    )
      throw new ConflictError(
        "Recovery preview changed",
        "RESET_PREVIEW_STALE",
      );
    const plan = recoveryPlan(inventory);
    plan.blockers.push(...(await resetSchemaBlockers(uow.tx)));
    if (plan.blockers.length)
      throw new ValidationError(
        "Recovery would violate existing configuration",
        "selection",
        "RECOVERY_BLOCKED",
      );
    unwrap(
      validateRuleSetContent({
        normal: {
          M: LEGACY_BASELINE_BOUNDS,
          E: LEGACY_BASELINE_BOUNDS,
          N: LEGACY_BASELINE_BOUNDS,
        },
        holiday: {},
        exceptions: [],
      }),
    );
    await restoreMissingMasterData(uow.tx, plan, uow.now);
    const after = await readResetInventory(uow.tx);
    // Each pre-existing row must survive byte-for-byte. Verify actual inserts, not just intended counts.
    const expected: Record<string, number> = {
      shift_types: plan.counts.shiftTypes,
      change_reasons: plan.counts.changeReasons,
      staffing_rule_sets: plan.counts.staffingRuleSets,
      staffing_rule_set_versions: plan.counts.staffingRuleSetVersions,
      staffing_rule_set_requirements: plan.counts.staffingRequirements,
    };
    for (const prior of inventory) {
      const current = after.find((t) => t.name === prior.name)!;
      if (
        current.rows.length !==
          prior.rows.length + (expected[prior.name] ?? 0) ||
        prior.rows.some(
          (r) =>
            !current.rows.some((a) => JSON.stringify(a) === JSON.stringify(r)),
        )
      )
        throw new Error(`Recovery integrity mismatch: ${prior.name}`);
    }
    const changed = Object.values(plan.counts).some((n) => n > 0);
    if (changed)
      await uow.audit({
        action: "masterData.defaultsRestored",
        entityType: "masterData",
        data: {
          counts: plan.counts,
          restoredLegacyBaseline: plan.restoreBaseline,
          previewId: input.previewId,
        },
      });
    return { counts: plan.counts, changed };
  },
});
