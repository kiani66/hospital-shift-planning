"use server";
import { refresh, revalidatePath } from "next/cache";
import {
  executeMasterRecovery,
  previewMasterRecovery,
} from "@/application/reset/recovery";
import { toActionError } from "@/application/result";
import { requireRequestContext } from "@/features/auth/guards";
export async function previewMasterRecoveryAction() {
  const ctx = await requireRequestContext();
  try {
    return { ok: true as const, data: await previewMasterRecovery(ctx) };
  } catch (error) {
    return { ok: false as const, error: toActionError(error) };
  }
}
export async function executeMasterRecoveryAction(input: unknown) {
  const result = await executeMasterRecovery(
    await requireRequestContext(),
    input,
  );
  if (result.ok) revalidatePath("/", "layout");
  refresh();
  return result;
}
