"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Modal dialog on the native `<dialog>` element: `showModal()` gives focus
 * containment, an inert background, Escape to close and the dialog role for
 * free. Controlled through `open`; `onClose` fires for Escape, a backdrop
 * click and programmatic closes alike.
 *
 * With `closeLabel`, the header gets a close button (for content dialogs
 * that have no action buttons of their own); `headerActions` go beside it.
 * `stickyHeader` keeps the header (title and those controls) visible while
 * long content scrolls. `focusTitle` starts focus on the title (announced
 * as the dialog's name) instead of the first header control, so opening a
 * content dialog does not land on, and ring, a navigation button.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  closeLabel,
  headerActions,
  stickyHeader = false,
  focusTitle = false,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  closeLabel?: string;
  headerActions?: ReactNode;
  stickyHeader?: boolean;
  focusTitle?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      if (focusTitle) titleRef.current?.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open, focusTitle]);

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
        "motion-safe:open:animate-in motion-safe:open:duration-150 motion-safe:open:fade-in-0",
        className,
      )}
    >
      <div className="flex flex-col gap-4 p-5">
        <div
          className={cn(
            "flex items-start gap-3",
            stickyHeader &&
              "sticky top-0 z-10 -mx-5 -mt-5 border-b bg-background px-5 pt-5 pb-3",
          )}
        >
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <h2
              id={titleId}
              ref={titleRef}
              tabIndex={focusTitle ? -1 : undefined}
              className="text-lg leading-relaxed font-bold focus:outline-none"
            >
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
          {headerActions}
          {closeLabel && (
            <button
              type="button"
              aria-label={closeLabel}
              onClick={() => ref.current?.close()}
              className="-me-2 -mt-1 inline-flex size-11 shrink-0 items-center justify-center rounded-md hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none"
            >
              <X aria-hidden="true" className="size-5" />
            </button>
          )}
        </div>
        {open && children}
      </div>
    </dialog>
  );
}
