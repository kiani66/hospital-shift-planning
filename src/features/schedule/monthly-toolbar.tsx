"use client";

import { MoreHorizontal } from "lucide-react";
import { useId, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";

import styles from "./monthly-toolbar.module.css";

/** A disclosure keeps the original controls, descriptions and dialog state mounted. */
export function MonthlyToolbar({
  navigation,
  primary,
  secondary,
}: {
  navigation: ReactNode;
  primary?: ReactNode;
  secondary?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const trigger = useRef<HTMLButtonElement>(null);

  return (
    <div className={styles.container} data-schedule-toolbar>
      <div className={styles.toolbar}>
        <div className={styles.navigation}>{navigation}</div>
        {primary && (
          <div
            role="group"
            aria-label="عملیات برنامه"
            className={styles.primary}
          >
            {primary}
          </div>
        )}
        {secondary && (
          <div
            className={styles.secondary}
            onKeyDown={(event) => {
              // Nested confirmation dialogs own Escape and their focus return.
              if (
                event.key !== "Escape" ||
                (event.target as Element).closest("dialog")
              )
                return;
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
              trigger.current?.focus();
            }}
          >
            <Button
              ref={trigger}
              variant="outline"
              aria-expanded={open}
              aria-controls={panelId}
              onClick={() => setOpen((value) => !value)}
              className={styles.more}
            >
              <MoreHorizontal aria-hidden="true" className="size-5 shrink-0" />
              عملیات بیشتر
            </Button>
            <div
              id={panelId}
              role="group"
              aria-label="عملیات بیشتر"
              data-open={open}
              className={styles.panel}
            >
              {secondary}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
