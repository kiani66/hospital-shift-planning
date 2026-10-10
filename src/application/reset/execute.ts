import { z } from "zod";
import { unwrap } from "../../domain/shared/result";
import { authorize } from "../../domain/authz/policies";
import { ValidationError } from "../../domain/shared/errors";
import { buildResetPlan } from "../../domain/reset/plan";
import {
  readResetInventory,
  resetSchemaBlockers,
} from "../../infrastructure/repositories/reset-inventory";
import {
  lockResetData,
  deleteResetPlan,
  verifyResetIntegrity,
  recordResetOperation,
  findResetOperation,
} from "../../infrastructure/repositories/reset-execution";
import { findUserById } from "../../infrastructure/repositories/users";
import { countUsableHospitalAdmins } from "../../infrastructure/repositories/management";
import { authorizeAdministration } from "../management/context";
import { ConflictError } from "../errors";
import { defineCommand, type AppContext } from "../use-case";
import {
  requireResetAdmin,
  resetSelectionInput,
  resetFingerprint,
  verifyResetProof,
} from "./preview";
export const fullResetInput = z.object({
  selection: resetSelectionInput,
  previewId: z.uuid(),
  issuedAt: z.number().int().nonnegative(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  proof: z.string().regex(/^[a-f0-9]{64}$/),
  confirmed: z.literal(true),
});
const executeReset = defineCommand({
  name: "dataReset.execute",
  input: fullResetInput,
  async handler(uow, input) {
    await authorizeAdministration(uow, "dataReset.manage");
    verifyResetProof(
      uow.actor.userId,
      input.selection,
      input,
      uow.now.getTime(),
    );
    if (!(await lockResetData(uow.tx)))
      throw new ConflictError(
        "A data writer is active; retry with a fresh preview",
        "RESET_BUSY",
      );
    const actor = await findUserById(uow.tx, uow.actor.userId);
    unwrap(
      authorize(
        {
          ...uow.actor,
          isActive: actor?.isActive ?? false,
          isHospitalAdmin: actor?.isHospitalAdmin ?? false,
        },
        "dataReset.manage",
        {},
      ),
    );
    if (await findResetOperation(uow.tx, input.previewId))
      throw new ConflictError(
        "Reset preview already executed",
        "RESET_PREVIEW_USED",
      );
    const inventory = await readResetInventory(uow.tx);
    const fingerprint = resetFingerprint(
      inventory,
      input.selection,
      uow.actor.userId,
    );
    if (fingerprint !== input.fingerprint)
      throw new ConflictError(
        "Data changed since preview",
        "RESET_PREVIEW_STALE",
      );
    const plan = buildResetPlan(
      inventory,
      input.selection.scope,
      input.selection.categories,
      uow.actor.userId,
    );
    plan.blockers.push(...(await resetSchemaBlockers(uow.tx)));
    if (plan.blockers.length)
      throw new ValidationError(
        "Reset dependencies cannot be resolved safely",
        "selection",
        "RESET_DEPENDENCY_BLOCKED",
      );
    const counts = await deleteResetPlan(uow.tx, inventory, plan);
    await verifyResetIntegrity(uow.tx, inventory, plan);
    if (!(await countUsableHospitalAdmins(uow.tx)))
      throw new ValidationError(
        "No usable admin would remain",
        "selection",
        "LAST_ACTIVE_ADMIN",
      );
    const surviving = await findUserById(uow.tx, uow.actor.userId);
    if (!surviving?.isActive || !surviving.isHospitalAdmin)
      throw new ValidationError(
        "Executing admin must remain",
        "selection",
        "PROTECTED_ADMIN",
      );
    await recordResetOperation(uow.tx, {
      id: input.previewId,
      executingAdminId: uow.actor.userId,
      scope: input.selection.scope,
      selectedCategories: input.selection.categories,
      automaticCategories: plan.automatic.map((a) => a.category),
      occurredAt: uow.now,
      result: "COMPLETED",
      counts,
    });
    return {
      operationId: input.previewId,
      counts,
      protectedUserIds: plan.protectedUserIds,
      preservedUserIds: plan.preservedUserIds,
    };
  },
});
/** Failed deletions roll back first. A separate minimal failure record contains no operational/personal snapshots. */
export async function executeFullReset(ctx: AppContext, raw: unknown) {
  const result = await executeReset(ctx, raw);
  if (!result.ok) {
    const input = fullResetInput.safeParse(raw);
    if (input.success) {
      try {
        await requireResetAdmin(ctx);
        verifyResetProof(
          ctx.actor.userId,
          input.data.selection,
          input.data,
          (ctx.clock?.() ?? new Date()).getTime(),
        );
        await ctx.db.transaction(async (tx) =>
          recordResetOperation(tx, {
            id: input.data.previewId,
            executingAdminId: ctx.actor.userId,
            scope: input.data.selection.scope,
            selectedCategories: input.data.selection.categories,
            automaticCategories: [],
            result: "FAILED",
            counts: {},
            errorCode: result.error.code,
          }),
        );
      } catch {
        /* Unauthorized/invalid previews write nothing; unavailable DB cannot record a failed attempt. */
      }
    }
  }
  return result;
}
