"use server";

import { refresh } from "next/cache";
import { toActionError } from "@/application/result";
import {
  readDailyPreferences,
  readDailyPreferencesInput,
  acceptDailyPreferences,
  acceptDailyPreferencesInput,
  type DailyPreferencePreview,
  type DailyPreferenceAcceptanceResult,
} from "@/application/schedules/daily-preferences";
import { requireRequestContext } from "@/features/auth/guards";
import { dailyFailure } from "./presentation";

type Failure = { ok: false } & ReturnType<typeof dailyFailure>;
export type DailyReadResult =
  { ok: true; data: DailyPreferencePreview } | Failure;
export type DailyAcceptResult =
  | {
      ok: true;
      data: Extract<DailyPreferenceAcceptanceResult, { ok: true }>["data"];
    }
  | Failure;

export async function readDailyPreferencesAction(
  input: unknown,
): Promise<DailyReadResult> {
  const ctx = await requireRequestContext();
  const parsed = readDailyPreferencesInput.safeParse(input);
  if (!parsed.success)
    return { ok: false, ...dailyFailure({ code: "VALIDATION", message: "" }) };
  try {
    return { ok: true, data: await readDailyPreferences(ctx, parsed.data) };
  } catch (error) {
    return { ok: false, ...dailyFailure(toActionError(error)) };
  }
}

export async function acceptDailyPreferencesAction(
  input: unknown,
): Promise<DailyAcceptResult> {
  const ctx = await requireRequestContext();
  const parsed = acceptDailyPreferencesInput.safeParse(input);
  if (!parsed.success)
    return { ok: false, ...dailyFailure({ code: "VALIDATION", message: "" }) };
  try {
    const result = await acceptDailyPreferences(ctx, parsed.data);
    if (result.ok) {
      refresh();
      return result;
    }
    const failure = dailyFailure(result.error);
    if (failure.reload) refresh();
    return { ok: false, ...failure };
  } catch (error) {
    return { ok: false, ...dailyFailure(toActionError(error)) };
  }
}
