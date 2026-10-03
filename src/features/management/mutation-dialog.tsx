"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

import { FormFeedback } from "./form-fields";
import type { ManagementFormState } from "./mutation-result";

export function MutationDialog({
  title,
  description,
  submitLabel,
  action,
  onClose,
  onSuccess,
  destructive = false,
  children,
}: {
  title: string;
  description: ReactNode;
  submitLabel: string;
  action: (
    previous: ManagementFormState,
    form: FormData,
  ) => Promise<ManagementFormState>;
  onClose: () => void;
  onSuccess: (message: string) => void;
  destructive?: boolean;
  children: (state: ManagementFormState) => ReactNode;
}) {
  const form = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(action, {
    status: "idle",
  });
  useEffect(() => {
    if (state.status === "success") {
      // Wait for the action transition (including refreshed server props) to
      // commit before exposing the next form's concurrency snapshot.
      onSuccess(state.message ?? "اطلاعات ذخیره شد.");
      onClose();
    } else if (state.status === "error")
      form.current?.querySelector<HTMLElement>("[aria-invalid=true]")?.focus();
  }, [state, onSuccess, onClose]);
  return (
    <Dialog
      open
      onClose={onClose}
      preventClose={pending}
      title={title}
      description={description}
      stickyHeader
      className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
    >
      <form ref={form} action={formAction} noValidate className="space-y-5">
        <fieldset disabled={pending} className="space-y-4">
          {children(state)}
        </fieldset>
        <FormFeedback
          state={pending ? { status: "idle" } : state}
          review={onClose}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            disabled={pending}
            variant={destructive ? "destructive" : "default"}
          >
            {pending ? "در حال ذخیره…" : submitLabel}
          </Button>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            انصراف
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
