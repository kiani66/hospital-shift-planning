"use client";

import {
  BadgeCheck,
  Lock,
  LockOpen,
  MessageSquareWarning,
  Send,
  Undo2,
} from "lucide-react";
import { useActionState, useId, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { faNumber } from "@/features/calendar/jalali";
import { cn } from "@/lib/utils";

import type { ScheduleFormState } from "./actions";

const ICONS = {
  open: LockOpen,
  close: Lock,
  finalize: Lock,
  submit: Send,
  withdraw: Undo2,
  approve: BadgeCheck,
  return: MessageSquareWarning,
} as const;

/** Directional icons (send, undo) point the other way in RTL. */
const MIRRORED: ReadonlySet<keyof typeof ICONS> = new Set([
  "submit",
  "withdraw",
]);

/**
 * A schedule command behind an accessible confirmation dialog. The form
 * carries the schedule revision the page was rendered with, so a stale tab
 * gets a conflict instead of overwriting someone else's change.
 *
 * `comment` adds a required text field to the dialog (returning a schedule);
 * the server validates it again. `disabled` keeps the trigger visible but
 * inert, with `describedBy` pointing at the text that says why.
 */
export function ConfirmScheduleAction({
  action,
  scheduleId,
  revision,
  icon,
  triggerLabel,
  title,
  description,
  confirmLabel,
  destructive = false,
  secondary = false,
  disabled = false,
  describedBy,
  comment,
}: {
  action: (
    state: ScheduleFormState,
    formData: FormData,
  ) => Promise<ScheduleFormState>;
  scheduleId: string;
  revision: number;
  icon: keyof typeof ICONS;
  triggerLabel: string;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  /** An outline trigger and a destructive confirmation (closing, returning). */
  destructive?: boolean;
  /** An outline trigger with a normal confirmation (withdrawing). */
  secondary?: boolean;
  disabled?: boolean;
  describedBy?: string;
  comment?: {
    readonly label: string;
    readonly hint: string;
    readonly maxLength: number;
  };
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const commentId = useId();
  const hintId = useId();
  // Close the dialog once the command succeeded; the page re-renders with the new state.
  const [state, formAction, pending] = useActionState(
    async (previous: ScheduleFormState, formData: FormData) => {
      const next = await action(previous, formData);
      if (next.status === "success") {
        setOpen(false);
        setText("");
      }
      return next;
    },
    { status: "idle" },
  );
  const Icon = ICONS[icon];

  return (
    <>
      <Button
        variant={destructive || secondary ? "outline" : "default"}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-describedby={describedBy}
        disabled={disabled}
        className="w-full sm:w-auto"
      >
        <Icon
          aria-hidden="true"
          className={cn("size-5", MIRRORED.has(icon) && "rtl:-scale-x-100")}
        />
        {triggerLabel}
      </Button>
      {state.status === "error" && !open && (
        <p role="alert" className="text-sm leading-relaxed text-destructive">
          {state.message}
        </p>
      )}

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        description={description}
      >
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="scheduleId" value={scheduleId} />
          <input type="hidden" name="expectedRevision" value={revision} />
          {comment && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor={commentId} className="text-sm font-medium">
                {comment.label}
              </label>
              <textarea
                id={commentId}
                name="comment"
                required
                autoFocus
                rows={4}
                maxLength={comment.maxLength}
                dir="auto"
                value={text}
                onChange={(event) => setText(event.target.value)}
                aria-describedby={hintId}
                className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm leading-relaxed shadow-xs focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none"
              />
              <p
                id={hintId}
                className="flex justify-between gap-3 text-xs text-muted-foreground"
              >
                <span>{comment.hint}</span>
                <span className="shrink-0 tabular-nums">
                  {faNumber(text.length)} / {faNumber(comment.maxLength)}
                </span>
              </p>
            </div>
          )}
          <div
            role="alert"
            className={
              state.status === "error"
                ? "rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-sm leading-relaxed text-destructive"
                : "sr-only"
            }
          >
            {state.status === "error" ? state.message : null}
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            {/* Focus starts on the safe choice (or on the comment to write). */}
            <Button
              variant="outline"
              autoFocus={!comment}
              onClick={() => setOpen(false)}
            >
              انصراف
            </Button>
            <Button
              type="submit"
              disabled={pending}
              variant={destructive ? "destructive" : "default"}
            >
              {pending ? "در حال انجام…" : confirmLabel}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
