"use server";

import { refresh } from "next/cache";

import {
  clearMyPreference,
  setMyPreference,
} from "@/application/preferences/commands";
import type { ActionResult } from "@/application/result";
import type { PreferenceValue } from "@/domain/shifts/shift-type";
import { requireRequestContext } from "@/features/auth/guards";

import { saveErrorMessage } from "./presentation";

/**
 * Thin adapters: load the trusted actor, call the use case, translate the
 * result. The browser sends only a schedule id, a date and a value; any other
 * field (a user id included) is dropped by the use case's schema, and the
 * target nurse is always the signed-in actor. Validation, authorization, the
 * window check and concurrency all live in the use cases.
 */

export type PreferenceSaveState =
  | { readonly ok: true; readonly value: PreferenceValue | null }
  | { readonly ok: false; readonly message: string };

function respond(
  result: ActionResult<{ value: PreferenceValue | null }>,
): PreferenceSaveState {
  // Success re-renders the page with the saved value and summary; a failure
  // re-renders too, so a window that just closed shows as read-only.
  refresh();
  return result.ok
    ? { ok: true, value: result.data.value }
    : { ok: false, message: saveErrorMessage(result.error) };
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
