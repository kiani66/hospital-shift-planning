"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import {
  applyChangeRequest,
  rejectChangeRequest,
} from "@/application/change-requests/commands";
import { NotFoundError } from "@/application/errors";
import type { ActionResult } from "@/application/result";
import {
  getAdjustmentPreview,
  type ChangePreviewView,
} from "@/application/schedules/change-preview";
import { adjustSchedule } from "@/application/schedules/schedule-changes";
import { isIsoDate, type IsoDate } from "@/domain/shared/dates";
import { SHIFT_CODES } from "@/domain/shifts/shift-type";
import { requireRequestContext } from "@/features/auth/guards";
import type { RequestFormState } from "@/features/change-requests/actions";
import {
  fieldMessages,
  REQUEST_SUCCESS,
  requestErrorMessage,
  type RequestCommand,
} from "@/features/change-requests/presentation";

/**
 * Thin adapters for the Head Nurse's request decisions and operational
 * adjustments: read the form, load the trusted actor, call the use case,
 * word the result. Everything that matters (authorization for this
 * department, the request still pending, consent, stale context, the
 * schedule's revision, validation, the revision path for an approved
 * schedule) is checked again inside the use case's transaction.
 */

const value = (formData: FormData, name: string) => {
  const v = formData.get(name);
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
};

function respond<T>(
  command: Extract<RequestCommand, "apply" | "reject" | "adjust">,
  result: ActionResult<T>,
): RequestFormState {
  // Success and refusals caused by state that moved on re-render the page.
  if (result.ok || result.error.code !== "VALIDATION") refresh();
  return result.ok
    ? { status: "success", message: REQUEST_SUCCESS[command], at: Date.now() }
    : {
        status: "error",
        message: requestErrorMessage(command, result.error),
        fields: fieldMessages(result.error),
        at: Date.now(),
      };
}

export async function applyChangeRequestAction(
  _previous: RequestFormState,
  formData: FormData,
): Promise<RequestFormState> {
  const ctx = await requireRequestContext();
  const shift = formData.get("requesterShift");
  return respond(
    "apply",
    await applyChangeRequest(ctx, {
      requestId: value(formData, "requestId"),
      expectedRevision: Number(formData.get("expectedRevision")),
      replacementNurseId: value(formData, "replacementNurseId") ?? null,
      // OTHER: "" is "no shift" (off); absent means not decided.
      ...(typeof shift === "string" && {
        requesterShift: shift === "" ? null : shift,
      }),
      confirmStaleContext: formData.get("confirmStaleContext") === "on",
    }),
  );
}

export async function rejectChangeRequestAction(
  _previous: RequestFormState,
  formData: FormData,
): Promise<RequestFormState> {
  const ctx = await requireRequestContext();
  return respond(
    "reject",
    await rejectChangeRequest(ctx, {
      requestId: value(formData, "requestId"),
      note: value(formData, "note") ?? null,
    }),
  );
}

const adjustmentCell = z.object({
  scheduleId: z.uuid(),
  nurseId: z.uuid(),
  date: z.string().refine(isIsoDate),
  /** "" is "no shift". */
  shift: z.enum([...SHIFT_CODES, ""]),
});

const cellOf = (formData: FormData) => {
  const parsed = adjustmentCell.safeParse({
    scheduleId: formData.get("scheduleId"),
    nurseId: formData.get("nurseId"),
    date: formData.get("date"),
    shift: formData.get("shift") ?? "",
  });
  if (!parsed.success) return null;
  const { scheduleId, nurseId, date, shift } = parsed.data;
  return {
    scheduleId,
    change: {
      nurseId,
      date: date as IsoDate,
      shift: shift === "" ? null : shift,
    },
  };
};

export type AdjustmentPreviewState =
  | { readonly status: "idle" }
  | {
      readonly status: "ready";
      readonly preview: ChangePreviewView;
      readonly at: number;
    }
  | { readonly status: "error"; readonly message: string; readonly at: number };

/** Validates an adjustment without writing anything (the form's "check" step). */
export async function previewAdjustmentAction(
  _previous: AdjustmentPreviewState,
  formData: FormData,
): Promise<AdjustmentPreviewState> {
  const ctx = await requireRequestContext();
  const cell = cellOf(formData);
  if (!cell)
    return {
      status: "error",
      message: "پرستار و شیفت را انتخاب کنید.",
      at: Date.now(),
    };
  try {
    return {
      status: "ready",
      preview: await getAdjustmentPreview(ctx, {
        scheduleId: cell.scheduleId,
        changes: [cell.change],
      }),
      at: Date.now(),
    };
  } catch (error) {
    if (error instanceof NotFoundError)
      return {
        status: "error",
        message: requestErrorMessage("adjust", {
          code: "FORBIDDEN",
          message: "",
        }),
        at: Date.now(),
      };
    throw error;
  }
}

export async function adjustScheduleAction(
  _previous: RequestFormState,
  formData: FormData,
): Promise<RequestFormState> {
  const ctx = await requireRequestContext();
  const cell = cellOf(formData);
  return respond(
    "adjust",
    await adjustSchedule(ctx, {
      scheduleId: cell?.scheduleId,
      expectedRevision: Number(formData.get("expectedRevision")),
      changes: cell ? [cell.change] : [],
      reasonCode: value(formData, "reasonCode"),
      note: value(formData, "note") ?? null,
    }),
  );
}
