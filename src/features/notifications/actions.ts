"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import {
  markAllNotificationsRead,
  markNotificationRead,
} from "@/application/notifications/commands";
import type { ActionError } from "@/application/result";
import { requireRequestContext } from "@/features/auth/guards";

import { notificationDestination } from "./presentation";

/**
 * Thin adapters: parse the form, load the trusted actor, call the use case.
 * Ownership is enforced by the use cases (the recipient is always the actor);
 * the only thing the browser sends is a notification id.
 */

export interface NotificationFormState {
  readonly status: "idle" | "success" | "error";
  readonly message?: string;
  /** Changes on every submission so the UI can react to repeated results. */
  readonly at?: number;
}

const MESSAGES: Record<ActionError["code"], string> = {
  VALIDATION: "درخواست معتبر نیست.",
  FORBIDDEN: "شما اجازه انجام این کار را ندارید.",
  NOT_FOUND: "این اعلان پیدا نشد.",
  INVALID_STATE: "این کار در حال حاضر امکان‌پذیر نیست.",
  CONFLICT: "اعلان‌ها هم‌زمان تغییر کرده‌اند؛ دوباره تلاش کنید.",
  RULE_VIOLATION: "این کار امکان‌پذیر نیست.",
  INTERNAL: "خطای غیرمنتظره‌ای رخ داد. لطفاً دوباره تلاش کنید.",
};

const failure = (code: ActionError["code"]): NotificationFormState => ({
  status: "error",
  message: MESSAGES[code],
  at: Date.now(),
});

const success = (message: string): NotificationFormState => ({
  status: "success",
  message,
  at: Date.now(),
});

const notificationForm = z.object({ notificationId: z.uuid() });

/**
 * The unread badge lives in the shared layout: invalidate from the root
 * layout so the next render (this page or the redirect target) and any
 * cached page show the new count.
 */
const refreshShell = () => revalidatePath("/", "layout");

async function markOne(formData: FormData) {
  const form = notificationForm.safeParse(Object.fromEntries(formData));
  if (!form.success) return null;
  const ctx = await requireRequestContext();
  return markNotificationRead(ctx, form.data);
}

/**
 * Opening a notification marks it read (idempotent) and then navigates to
 * its destination, which is derived on the server from the stored row.
 */
export async function openNotificationAction(
  _previous: NotificationFormState,
  formData: FormData,
): Promise<NotificationFormState> {
  const result = await markOne(formData);
  if (!result) return failure("VALIDATION");
  if (!result.ok) return failure(result.error.code);

  refreshShell();
  const destination = notificationDestination(result.data);
  if (destination) redirect(destination);
  return success("اعلان خوانده شد.");
}

export async function markNotificationReadAction(
  _previous: NotificationFormState,
  formData: FormData,
): Promise<NotificationFormState> {
  const result = await markOne(formData);
  if (!result) return failure("VALIDATION");
  if (!result.ok) return failure(result.error.code);
  refreshShell();
  return success("اعلان خوانده شد.");
}

/** Used as a form action: the previous state and form data are not needed. */
export async function markAllNotificationsReadAction(): Promise<NotificationFormState> {
  const ctx = await requireRequestContext();
  const result = await markAllNotificationsRead(ctx, {});
  if (!result.ok) return failure(result.error.code);
  refreshShell();
  return success("همه اعلان‌ها خوانده شدند.");
}
