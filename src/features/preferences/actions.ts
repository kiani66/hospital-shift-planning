"use server";

import { refresh } from "next/cache";

import {
  clearMyPreference,
  setMyPreference,
} from "@/application/preferences/commands";
import type { ActionResult } from "@/application/result";
import type { PreferenceValue } from "@/domain/shifts/shift-type";
import { requireRequestContext } from "@/features/auth/guards";

import { isRetryableSaveError, saveErrorMessage } from "./presentation";
import type { SaveResult } from "./save-queue";

/**
 * Thin adapters: load the trusted actor, call the use case, translate the
 * result. The browser sends only a schedule id, a date and a value; any other
 * field (a user id included) is dropped by the use case's schema, and the
 * target nurse is always the signed-in actor. Validation, authorization, the
 * window check and concurrency all live in the use cases.
 */

export type PreferenceSaveState = SaveResult;

function respond(
  result: ActionResult<{ value: PreferenceValue | null }>,
): PreferenceSaveState {
  if (!result.ok)
    // No refresh: the day keeps showing what was not saved and why (the
    // stored value is unchanged). A reload shows a window that just closed.
    return {
      ok: false,
      message: saveErrorMessage(result.error),
      retryable: isRetryableSaveError(result.error),
    };
  // Keeps the server-rendered page (and the router cache) in step with
  // what is stored; the client applies it to idle days only.
  refresh();
  return { ok: true, value: result.data.value };
}

export async function setMyPreferenceAction(
  input: unknown,
): Promise<PreferenceSaveState> {
  const ctx = await requireRequestContext();
  return respond(await setMyPreference(ctx, input));
}

export async function clearMyPreferenceAction(
  input: unknown,
): Promise<PreferenceSaveState> {
  const ctx = await requireRequestContext();
  return respond(await clearMyPreference(ctx, input));
}
