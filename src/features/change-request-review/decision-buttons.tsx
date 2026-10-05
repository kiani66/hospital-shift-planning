"use client";

import { Check, X } from "lucide-react";
import { useActionState, useId, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { CHANGE_NOTE_MAX_LENGTH } from "@/domain/change-requests/reason";
import type { AssignmentCode } from "@/domain/shifts/shift-type";
import { faNumber } from "@/features/calendar/jalali";
import type { RequestFormState } from "@/features/change-requests/actions";

import { applyChangeRequestAction, rejectChangeRequestAction } from "./actions";

const FIELD_CLASS =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm leading-relaxed shadow-xs focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none";

function ErrorBox({ state }: { state: RequestFormState }) {
  return (
    <div
      role="alert"
      className={
        state.status === "error"
          ? "rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-sm leading-relaxed text-destructive"
          : "sr-only"
      }
    >
      {state.status === "error"
        ? [state.message, ...Object.values(state.fields ?? {})].join(" ")
        : null}
    </div>
  );
}

function useDecision(
  action: (
    state: RequestFormState,
    formData: FormData,
  ) => Promise<RequestFormState>,
) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    async (previous: RequestFormState, formData: FormData) => {
      const next = await action(previous, formData);
      if (next.status === "success") setOpen(false);
      return next;
    },
    { status: "idle" },
  );
  return { open, setOpen, state, formAction, pending };
}

/** The outcome next to the trigger once the dialog closed. */
function Outcome({ state, open }: { state: RequestFormState; open: boolean }) {
  return (
    <p
      role={state.status === "error" ? "alert" : "status"}
      className={
        !open && state.status !== "idle"
          ? state.status === "error"
            ? "text-sm text-destructive"
            : "text-sm text-muted-foreground"
          : "sr-only"
      }
    >
      {!open && state.status !== "idle" ? state.message : null}
    </p>
  );
}

/**
 * Applies the request. The server locks the schedule and the request,
 * re-authorizes, re-reads the current context and re-validates: what the
 * preview showed is checked again, never trusted. `expectedRevision` makes a
 * stale page a conflict instead of an apply on a state nobody reviewed.
 */
export function ApplyRequestButton({
  requestId,
  revision,
  replacementNurseId,
  requesterShift,
  stale,
  disabled,
  describedBy,
  consequence,
}: {
  requestId: string;
  revision: number;
  replacementNurseId: string | null;
  /** OTHER: the decided resulting shift ("" = undecided); undefined when not OTHER. */
  requesterShift?: AssignmentCode | "";
  /** The requester's shift changed since the request: confirmation required. */
  stale: ReactNode | null;
  disabled: boolean;
  describedBy?: string;
  consequence: ReactNode;
}) {
  const { open, setOpen, state, formAction, pending } = useDecision(
    applyChangeRequestAction,
  );
  const [confirmed, setConfirmed] = useState(false);
  const confirmId = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <Button
        onClick={() => setOpen(true)}
        disabled={disabled}
        aria-describedby={describedBy}
        aria-haspopup="dialog"
        className="w-full sm:w-auto"
      >
        <Check aria-hidden="true" className="size-4" />
        اعمال درخواست
      </Button>
      <Outcome state={state} open={open} />
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="اعمال درخواست"
        description={consequence}
      >
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="requestId" value={requestId} />
          <input type="hidden" name="expectedRevision" value={revision} />
          {replacementNurseId && (
            <input
              type="hidden"
              name="replacementNurseId"
              value={replacementNurseId}
            />
          )}
          {requesterShift !== undefined && (
            <input type="hidden" name="requesterShift" value={requesterShift} />
          )}
          {stale && (
            <label
              htmlFor={confirmId}
              className="flex items-start gap-3 rounded-lg border border-health-attention/50 bg-health-attention/10 px-3 py-2.5 text-sm leading-relaxed"
            >
              <input
                id={confirmId}
                type="checkbox"
                name="confirmStaleContext"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="mt-1 size-4 accent-primary"
              />
              <span>{stale}</span>
            </label>
          )}
          <ErrorBox state={state} />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" autoFocus onClick={() => setOpen(false)}>
              انصراف
            </Button>
            <Button type="submit" disabled={pending || (!!stale && !confirmed)}>
              {pending ? "در حال اعمال…" : "بله، اعمال شود"}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

/** Rejects the request with an optional note the nurse sees. */
export function RejectRequestButton({ requestId }: { requestId: string }) {
  const { open, setOpen, state, formAction, pending } = useDecision(
    rejectChangeRequestAction,
  );
  const [note, setNote] = useState("");
  const noteId = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <Button
        variant="outline"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="w-full sm:w-auto"
      >
        <X aria-hidden="true" className="size-4" />
        رد درخواست
      </Button>
      <Outcome state={state} open={open} />
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="رد درخواست"
        description="درخواست رد می‌شود، در سابقه می‌ماند و به پرستار اطلاع داده می‌شود. برنامه تغییری نمی‌کند."
      >
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="requestId" value={requestId} />
          <div className="flex flex-col gap-1.5">
            <label htmlFor={noteId} className="text-sm font-medium">
              توضیح برای پرستار (اختیاری)
            </label>
            <textarea
              id={noteId}
              name="note"
              rows={3}
              dir="auto"
              maxLength={CHANGE_NOTE_MAX_LENGTH}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className={FIELD_CLASS}
            />
            <p className="text-end text-xs text-muted-foreground tabular-nums">
              {faNumber(note.length)} / {faNumber(CHANGE_NOTE_MAX_LENGTH)}
            </p>
          </div>
          <ErrorBox state={state} />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" autoFocus onClick={() => setOpen(false)}>
              انصراف
            </Button>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending ? "در حال انجام…" : "بله، رد شود"}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
