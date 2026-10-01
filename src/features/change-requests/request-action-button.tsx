"use client";

import { Check, RefreshCw, X, XCircle } from "lucide-react";
import { useActionState, useState, type ReactNode } from "react";

import { Button, type ButtonVariant } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

import type { RequestFormState } from "./actions";

const ICONS = {
  cancel: XCircle,
  accept: Check,
  decline: X,
  refresh: RefreshCw,
} as const;

/**
 * One command on one request (cancel, accept or decline a swap, refresh a
 * swap) behind an accessible confirmation that states its consequence. The
 * form carries only the request id (and the answer); the server decides who
 * may do it. After success the page re-renders with the request's new state
 * and the outcome stays announced next to the trigger.
 */
export function RequestActionButton({
  action,
  requestId,
  answer,
  icon,
  triggerLabel,
  title,
  description,
  confirmLabel,
  variant = "outline",
  destructive = false,
}: {
  action: (
    state: RequestFormState,
    formData: FormData,
  ) => Promise<RequestFormState>;
  requestId: string;
  /** For the swap answer: "accept" or "decline". */
  answer?: "accept" | "decline";
  icon: keyof typeof ICONS;
  triggerLabel: string;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  variant?: ButtonVariant;
  destructive?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    async (previous: RequestFormState, formData: FormData) => {
      const next = await action(previous, formData);
      if (next.status === "success") setOpen(false);
      return next;
    },
    { status: "idle" },
  );
  const Icon = ICONS[icon];

  return (
    <div className="flex flex-col gap-1.5">
      <Button
        variant={variant}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="w-full sm:w-auto"
      >
        <Icon aria-hidden="true" className="size-4" />
        {triggerLabel}
      </Button>
      <p
        role={state.status === "error" ? "alert" : "status"}
        className={
          state.status === "error"
            ? "text-sm leading-relaxed text-destructive"
            : state.status === "success"
              ? "text-sm leading-relaxed text-muted-foreground"
              : "sr-only"
        }
      >
        {!open && state.status !== "idle" ? state.message : null}
      </p>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        description={description}
      >
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="requestId" value={requestId} />
          {answer && <input type="hidden" name="answer" value={answer} />}
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
    </div>
  );
}
