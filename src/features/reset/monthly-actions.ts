"use server";
import { refresh } from "next/cache";
import { z } from "zod";
import {
  previewMonthlyReset,
  resetMonthlyPlanning,
} from "@/application/schedules/reset-planning";
import { toActionError } from "@/application/result";
import { requireRequestContext } from "@/features/auth/guards";
export async function previewMonthlyResetAction(scheduleId: string) {
  z.uuid().parse(scheduleId);
  const ctx = await requireRequestContext();
  try {
    return {
      ok: true as const,
      data: await previewMonthlyReset(ctx, scheduleId),
    };
  } catch (error) {
    return { ok: false as const, error: toActionError(error) };
  }
}
export async function resetMonthlyPlanningAction(input: {
  scheduleId: string;
  expectedRevision: number;
}) {
  const ctx = await requireRequestContext();
  const result = await resetMonthlyPlanning(ctx, input);
  refresh();
  return result;
}
