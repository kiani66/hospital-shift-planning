"use client";

import { Check, CheckCheck, LoaderCircle } from "lucide-react";
import { useActionState, useEffect, useRef, type ReactNode } from "react";

import { buttonClasses } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import {
  markAllNotificationsReadAction,
  markNotificationReadAction,
  openNotificationAction,
  type NotificationFormState,
} from "./actions";

/** The list heading; focus lands here when the focused control disappears. */
export const LIST_HEADING_ID = "notifications-list-heading";
export const openButtonId = (id: string) => `notification-${id}-open`;

const IDLE: NotificationFormState = { status: "idle" };

function focusAfterChange(preferredId?: string) {
  const target =
    (preferredId && document.getElementById(preferredId)) ||
    document.getElementById(LIST_HEADING_ID);
  target?.focus();
}

function ErrorMessage({ state }: { state: NotificationFormState }) {
  if (state.status !== "error") return null;
  return (
    <p role="alert" className="text-sm leading-relaxed text-destructive">
      {state.message}
    </p>
  );
}

/**
 * The notification itself is one submit button: opening it marks it read on
 * the server, then navigates to its destination (or stays, if it has none).
 * Works without JavaScript too (a plain form post).
 */
export function OpenNotificationForm({
  notificationId,
  className,
  children,
}: {
  notificationId: string;
  className?: string;
  children: ReactNode;
}) {
  const [state, action, pending] = useActionState(openNotificationAction, IDLE);
  return (
    <form action={action} className="flex min-w-0 flex-1 flex-col gap-1">
      <input type="hidden" name="notificationId" value={notificationId} />
      <button
        type="submit"
        id={openButtonId(notificationId)}
        aria-busy={pending || undefined}
        className={className}
      >
        {children}
      </button>
      <ErrorMessage state={state} />
    </form>
  );
}

/** "Mark as read" for one unread notification, without leaving the page. */
export function MarkReadForm({
  notificationId,
  title,
}: {
  notificationId: string;
  title: string;
}) {
  const marked = useRef(false);
  const [state, action, pending] = useActionState(
    async (previous: NotificationFormState, formData: FormData) => {
      const next = await markNotificationReadAction(previous, formData);
      marked.current = next.status === "success";
      return next;
    },
    IDLE,
  );
  // This form disappears once the item is read (and, under "unread", the
  // whole item): move focus to the item, or to the list heading, afterwards.
  useEffect(
    () => () => {
      if (marked.current)
        setTimeout(() => focusAfterChange(openButtonId(notificationId)), 0);
    },
    [notificationId],
  );
  return (
    <form action={action} className="flex flex-col gap-1 sm:shrink-0">
      <input type="hidden" name="notificationId" value={notificationId} />
      <button
        type="submit"
        disabled={pending}
        aria-label={`علامت خوانده‌شده: ${title}`}
        className={buttonClasses("outline", "w-full px-3 sm:w-auto")}
      >
        {pending ? (
          <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
        ) : (
          <Check aria-hidden="true" className="size-4" />
        )}
        علامت خوانده‌شده
      </button>
      <ErrorMessage state={state} />
    </form>
  );
}

/**
 * Marks every unread notification of the user as read. Stays mounted when the
 * count reaches zero so the result is still announced.
 */
export function MarkAllReadForm({ unread }: { unread: number }) {
  const [state, action, pending] = useActionState(
    markAllNotificationsReadAction,
    IDLE,
  );
  useEffect(() => {
    if (state.status === "success") focusAfterChange();
  }, [state]);

  return (
    <div className="flex flex-col gap-1">
      {unread > 0 && (
        <form action={action}>
          <button
            type="submit"
            disabled={pending}
            className={buttonClasses("outline", "w-full sm:w-auto")}
          >
            {pending ? (
              <LoaderCircle
                aria-hidden="true"
                className="size-5 animate-spin"
              />
            ) : (
              <CheckCheck aria-hidden="true" className="size-5" />
            )}
            علامت‌گذاری همه به‌عنوان خوانده‌شده
          </button>
        </form>
      )}
      <p
        role="status"
        className={cn(
          "text-sm text-muted-foreground",
          state.status !== "success" && "sr-only",
        )}
      >
        {state.status === "success" ? state.message : ""}
      </p>
      <ErrorMessage state={state} />
    </div>
  );
}
