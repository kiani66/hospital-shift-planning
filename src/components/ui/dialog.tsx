"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Modal dialog on the native `<dialog>` element: `showModal()` gives focus
 * containment, an inert background, Escape to close and the dialog role for
 * free. Controlled through `open`; `onClose` fires for Escape, a backdrop
 * click and programmatic closes alike.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onClose={onClose}
      onClick={(event) => {
        // A click on the element itself (not its content) is the backdrop.
        if (event.target === event.currentTarget) event.currentTarget.close();
      }}
      className={cn(
        "m-auto w-[min(calc(100vw-2rem),32rem)] max-w-none rounded-lg border bg-background p-0 text-foreground shadow-xl",
        "backdrop:bg-black/40",
        className,
      )}
    >
      <div className="flex flex-col gap-4 p-5">
        <div className="flex flex-col gap-1.5">
          <h2 id={titleId} className="text-lg leading-relaxed font-bold">
            {title}
          </h2>
          {description && (
            <div
              id={descriptionId}
              className="text-sm leading-relaxed text-muted-foreground"
            >
              {description}
            </div>
          )}
        </div>
        {open && children}
      </div>
    </dialog>
  );
}
