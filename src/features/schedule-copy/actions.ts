"use server";

import { refresh } from "next/cache";
import {
  applyScheduleCopy,
  getScheduleCopySource,
  previewScheduleCopy,
  scheduleCopyInput,
  applyScheduleCopyInput,
  type ScheduleCopyPreview,
} from "@/application/schedules/copy";
import { toActionError, type ActionResult } from "@/application/result";
import { requireRequestContext } from "@/features/auth/guards";

export async function previewCopyAction(
  raw: unknown,
): Promise<ActionResult<ScheduleCopyPreview>> {
  const parsed = scheduleCopyInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: toActionError(parsed.error) };
  const ctx = await requireRequestContext();
  try {
    return { ok: true, data: await previewScheduleCopy(ctx, parsed.data) };
  } catch (error) {
    return { ok: false, error: toActionError(error) };
  }
}

export async function applyCopyAction(raw: unknown) {
  const parsed = applyScheduleCopyInput.safeParse(raw);
  if (!parsed.success)
    return { ok: false as const, error: toActionError(parsed.error) };
  const ctx = await requireRequestContext();
  const result = await applyScheduleCopy(ctx, parsed.data);
  refresh();
  return result;
}

export async function getCopySourceAction(raw: unknown) {
  const parsed = scheduleCopyInput.safeParse(raw);
  if (!parsed.success)
    return { ok: false as const, error: toActionError(parsed.error) };
  const ctx = await requireRequestContext();
  try {
    return {
      ok: true as const,
      data: await getScheduleCopySource(ctx, parsed.data),
    };
  } catch (error) {
    return { ok: false as const, error: toActionError(error) };
  }
}
