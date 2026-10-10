"use server";
import { revalidatePath, refresh } from "next/cache";
import { executeFullReset } from "@/application/reset/execute";
import { previewFullReset } from "@/application/reset/preview";
import { toActionError } from "@/application/result";
import { requireRequestContext } from "@/features/auth/guards";
export async function previewFullResetAction(input: unknown) {
  const ctx = await requireRequestContext();
  try {
    return { ok: true as const, data: await previewFullReset(ctx, input) };
  } catch (error) {
    return { ok: false as const, error: toActionError(error) };
  }
}

export async function executeFullResetAction(input: unknown) {
  const ctx = await requireRequestContext();
  const result = await executeFullReset(ctx, input);
  if (result.ok) revalidatePath("/", "layout");
  refresh();
  return result;
}
