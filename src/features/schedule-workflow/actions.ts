"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import {
  approveSchedule,
  finalizeSchedule,
  returnSchedule,
  submitSchedule,
  withdrawSubmission,
} from "@/application/schedules/lifecycle";
import type { ScheduleFormState } from "@/features/schedule/actions";
import { requireRequestContext } from "@/features/auth/guards";

import {
  WORKFLOW_SUCCESS,
  workflowErrorMessage,
  type LifecycleCommand,
} from "./presentation";

/**
 * Thin adapters for the approval workflow: parse the form, load the trusted
 * actor, call the use case, word the result in Persian. Authorization,
 * validation, the state machine and concurrency all live in the use cases;
 * a hidden or disabled button is never what stops an action.
 */

const scheduleForm = z.object({
  scheduleId: z.uuid(),
  expectedRevision: z.coerce.number().int().nonnegative(),
});

const COMMANDS = {
  finalize: finalizeSchedule,
  submit: submitSchedule,
  withdraw: withdrawSubmission,
  approve: approveSchedule,
  return: returnSchedule,
} as const;

async function run(
  command: LifecycleCommand,
  formData: FormData,
): Promise<ScheduleFormState> {
  const form = scheduleForm.safeParse(Object.fromEntries(formData));
  if (!form.success)
    return {
      status: "error",
      message: workflowErrorMessage(command, {
        code: "VALIDATION",
        message: "Invalid input",
      }),
      at: Date.now(),
    };

  const ctx = await requireRequestContext();
  const comment = formData.get("comment");
  const result = await COMMANDS[command](ctx, {
    ...form.data,
    ...(command === "return" && {
      comment: typeof comment === "string" ? comment : "",
    }),
  });
  // Success and a state that changed underneath both re-render the page with
  // the current state (status, actions, the other side's decision).
  if (
    result.ok ||
    result.error.code === "CONFLICT" ||
    result.error.code === "INVALID_STATE"
  )
    refresh();
  return result.ok
    ? { status: "success", message: WORKFLOW_SUCCESS[command], at: Date.now() }
    : {
        status: "error",
        message: workflowErrorMessage(command, result.error),
        at: Date.now(),
      };
}

export async function finalizeScheduleAction(
  _previous: ScheduleFormState,
  formData: FormData,
): Promise<ScheduleFormState> {
  return run("finalize", formData);
}

export async function submitScheduleAction(
  _previous: ScheduleFormState,
  formData: FormData,
): Promise<ScheduleFormState> {
  return run("submit", formData);
}

export async function withdrawSubmissionAction(
  _previous: ScheduleFormState,
  formData: FormData,
): Promise<ScheduleFormState> {
  return run("withdraw", formData);
}

export async function approveScheduleAction(
  _previous: ScheduleFormState,
  formData: FormData,
): Promise<ScheduleFormState> {
  return run("approve", formData);
}

export async function returnScheduleAction(
  _previous: ScheduleFormState,
  formData: FormData,
): Promise<ScheduleFormState> {
  return run("return", formData);
}
