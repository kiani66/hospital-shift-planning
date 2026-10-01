"use server";

import { refresh } from "next/cache";

import {
  cancelChangeRequest,
  createChangeRequest,
  refreshSwapRequest,
  respondToSwapRequest,
} from "@/application/change-requests/commands";
import type { ActionResult } from "@/application/result";
import { requireRequestContext } from "@/features/auth/guards";

import {
  fieldMessages,
  REQUEST_SUCCESS,
  requestErrorMessage,
  type RequestCommand,
} from "./presentation";

/**
 * Thin adapters for the nurse's change-request commands: read the form,
 * load the trusted actor, call the use case, word the result in Persian.
 * The browser never says who is acting: the requester (or swap partner) is
 * always the signed-in actor, and any user id in the form is dropped by the
 * use case's schema. Authorization, validation and concurrency all live in
 * the use cases; a hidden button is never what stops an action.
 */

export interface RequestFormState {
  readonly status: "idle" | "success" | "error";
  readonly message?: string;
  /** Persian messages per form field (VALIDATION). */
  readonly fields?: Readonly<Record<string, string>>;
  /** Changes on every submission so the UI can react to repeated results. */
  readonly at?: number;
}

/** A form value as the use case expects it: absent when blank. */
const field = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
};

function respond<T>(
  command: RequestCommand,
  result: ActionResult<T>,
  success: (data: T) => string,
): RequestFormState {
  // Success, and any refusal caused by a state that moved on, re-render the
  // page with the current requests.
  if (
    result.ok ||
    result.error.code === "CONFLICT" ||
    result.error.code === "INVALID_STATE" ||
    result.error.code === "NOT_FOUND"
  )
    refresh();
  return result.ok
    ? { status: "success", message: success(result.data), at: Date.now() }
    : {
        status: "error",
        message: requestErrorMessage(command, result.error),
        fields: fieldMessages(result.error),
        at: Date.now(),
      };
}

export async function createChangeRequestAction(
  _previous: RequestFormState,
  formData: FormData,
): Promise<RequestFormState> {
  const ctx = await requireRequestContext();
  const type = field(formData, "type");
  const result = await createChangeRequest(ctx, {
    scheduleId: field(formData, "scheduleId"),
    type,
    date: field(formData, "date"),
    // Only the fields of the chosen type are sent (the form keeps hidden ones).
    targetShift:
      type === "CHANGE_SHIFT" ? field(formData, "targetShift") : undefined,
    counterpartId:
      type === "SWAP" ? field(formData, "counterpartId") : undefined,
    reasonCode: field(formData, "reasonCode"),
    note: field(formData, "note"),
  });
  return respond("create", result, () =>
    type === "SWAP" ? REQUEST_SUCCESS.createSwap : REQUEST_SUCCESS.create,
  );
}

export async function cancelChangeRequestAction(
  _previous: RequestFormState,
  formData: FormData,
): Promise<RequestFormState> {
  const ctx = await requireRequestContext();
  return respond(
    "cancel",
    await cancelChangeRequest(ctx, { requestId: field(formData, "requestId") }),
    () => REQUEST_SUCCESS.cancel,
  );
}

export async function respondToSwapAction(
  _previous: RequestFormState,
  formData: FormData,
): Promise<RequestFormState> {
  const ctx = await requireRequestContext();
  const accept = formData.get("answer") === "accept";
  return respond(
    "respond",
    await respondToSwapRequest(ctx, {
      requestId: field(formData, "requestId"),
      accept,
    }),
    () => (accept ? REQUEST_SUCCESS.accept : REQUEST_SUCCESS.decline),
  );
}

export async function refreshSwapAction(
  _previous: RequestFormState,
  formData: FormData,
): Promise<RequestFormState> {
  const ctx = await requireRequestContext();
  return respond(
    "refresh",
    await refreshSwapRequest(ctx, { requestId: field(formData, "requestId") }),
    (data) =>
      data.changed ? REQUEST_SUCCESS.refresh : REQUEST_SUCCESS.refreshUnchanged,
  );
}
