"use client";

import { Lock, LockOpen } from "lucide-react";
import { useActionState, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

import type { ScheduleFormState } from "./actions";

const ICONS = { open: LockOpen, close: Lock } as const;

/**
 * A schedule command behind an accessible confirmation dialog. The form
 * carries the schedule revision the page was rendered with, so a stale tab
 * gets a conflict instead of overwriting someone else's change.
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
  destructive?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // Close the dialog once the command succeeded; the page re-renders with the new state.
  const [state, formAction, pending] = useActionState(
    async (previous: ScheduleFormState, formData: FormData) => {
      const next = await action(previous, formData);
      if (next.status === "success") setOpen(false);
      return next;
    },
    { status: "idle" },
  );
  const Icon = ICONS[icon];

  return (
    <>
      <Button
        variant={destructive ? "outline" : "default"}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="w-full sm:w-auto"
      >
        <Icon aria-hidden="true" className="size-5" />
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
            {/* Focus starts on the safe choice. */}
            <Button variant="outline" autoFocus onClick={() => setOpen(false)}>
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
