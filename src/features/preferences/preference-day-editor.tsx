"use client";

import { Check, CircleAlert, LoaderCircle, Lock, X } from "lucide-react";
import {
  useOptimistic,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent,
} from "react";

import type { PreferenceValue } from "@/domain/shifts/shift-type";
import { cn } from "@/lib/utils";

import {
  clearMyPreferenceAction,
  setMyPreferenceAction,
  type PreferenceSaveState,
} from "./actions";
import { PREFERENCE_OPTIONS, preferenceOption } from "./presentation";

type Status =
  | { readonly kind: "saved"; readonly message: string }
  | { readonly kind: "error"; readonly message: string };

/** Next index for arrow keys; in RTL, ArrowLeft moves forward. */
function nextIndex(key: string, index: number, count: number): number | null {
  switch (key) {
    case "ArrowLeft":
    case "ArrowDown":
      return (index + 1) % count;
    case "ArrowRight":
    case "ArrowUp":
      return (index - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

/**
 * One day of the nurse's preferences: the selector while the day is editable,
 * the saved value with the reason otherwise. The same component renders both,
 * so a save rejected because the window just closed keeps its message after
 * the page re-renders the day as read-only.
 *
 * Editing: a tap saves immediately. A tap saves immediately: the choice shows
 * at once (optimistic), the server decides, and the page is re-rendered from
 * the server. A rejected save (window just closed, day locked, conflict)
 * falls back to the server's value and says why; nothing is lost silently.
 *
 * Keyboard: one tab stop per day (roving tabindex); arrow keys, Home and End
 * move between options; Enter or Space selects.
 */
export function PreferenceDayEditor({
  scheduleId,
  date,
  value,
  dayLabel,
  lockReason,
}: {
  scheduleId: string;
  date: string;
  /** The stored (server) value. */
  value: PreferenceValue | null;
  /** "شنبه ۲ آبان ۱۴۰۵" */
  dayLabel: string;
  /** Why the day is read-only (Persian), or null when it is editable. */
  lockReason: string | null;
}) {
  const [optimistic, setOptimistic] = useOptimistic(value);
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<Status | null>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIndex = PREFERENCE_OPTIONS.findIndex(
    (o) => o.value === optimistic,
  );
  const [focusIndex, setFocusIndex] = useState(Math.max(selectedIndex, 0));

  function save(next: PreferenceValue | null) {
    if (next === optimistic) return;
    setStatus(null);
    startTransition(async () => {
      setOptimistic(next);
      let result: PreferenceSaveState;
      try {
        result =
          next === null
            ? await clearMyPreferenceAction({ scheduleId, date })
            : await setMyPreferenceAction({ scheduleId, date, value: next });
      } catch {
        result = {
          ok: false,
          message:
            "ارتباط با سرور برقرار نشد و ترجیح ذخیره نشد. دوباره تلاش کنید.",
        };
      }
      setStatus(
        result.ok
          ? {
              kind: "saved",
              message:
                next === null
                  ? `ترجیح ${dayLabel} پاک شد.`
                  : `ترجیح ${preferenceOption(next).label} برای ${dayLabel} ذخیره شد.`,
            }
          : { kind: "error", message: result.message },
      );
    });
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = nextIndex(event.key, focusIndex, PREFERENCE_OPTIONS.length);
    if (index === null) return;
    event.preventDefault();
    setFocusIndex(index);
    buttons.current[index]?.focus();
  }

  const current = optimistic === null ? null : preferenceOption(optimistic);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-h-11 items-center justify-between gap-2">
        <p className="text-sm">
          <span className="text-muted-foreground">ترجیح من: </span>
          {current ? (
            <span className="font-semibold">
              <span dir="ltr">{current.code}</span> — {current.label}
            </span>
          ) : (
            <span className="text-muted-foreground">بدون ترجیح</span>
          )}
        </p>
        {lockReason === null && optimistic !== null && (
          <button
            type="button"
            onClick={() => save(null)}
            aria-label={`پاک کردن ترجیح ${dayLabel}`}
            className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-md px-3 text-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none"
          >
            <X aria-hidden="true" className="size-4" />
            پاک کردن
          </button>
        )}
      </div>

      {lockReason !== null ? (
        <p className="flex items-start gap-1.5 text-sm leading-relaxed text-muted-foreground">
          <Lock aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>
            <span className="sr-only">قابل ویرایش نیست: </span>
            {lockReason}
          </span>
        </p>
      ) : (
        <div
          role="group"
          aria-label={`ترجیح شیفت ${dayLabel}`}
          aria-busy={pending || undefined}
          onKeyDown={onKeyDown}
          className="grid grid-cols-5 gap-1.5"
        >
          {PREFERENCE_OPTIONS.map((option, i) => {
            const selected = option.value === optimistic;
            return (
              <button
                key={option.value}
                ref={(el) => {
                  buttons.current[i] = el;
                }}
                type="button"
                tabIndex={i === focusIndex ? 0 : -1}
                aria-pressed={selected}
                aria-label={`${option.code} — ${option.label}`}
                onFocus={() => setFocusIndex(i)}
                onClick={() => save(option.value)}
                className={cn(
                  "relative flex min-h-12 min-w-0 flex-col items-center justify-center rounded-md border px-0.5 py-1 leading-tight transition-colors",
                  "focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none",
                  selected
                    ? cn(option.className, "border-current font-bold shadow-sm")
                    : "bg-background hover:bg-accent",
                )}
              >
                {selected && (
                  <Check
                    aria-hidden="true"
                    className="absolute end-0.5 top-0.5 size-3.5"
                  />
                )}
                <span dir="ltr" className="text-sm font-bold">
                  {option.code}
                </span>
                <span className="max-w-full truncate text-[0.7rem]">
                  {option.short}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div role="status" className="min-h-5 text-xs leading-relaxed">
        {pending ? (
          <p className="flex items-center gap-1 text-muted-foreground">
            <LoaderCircle
              aria-hidden="true"
              className="size-3.5 animate-spin"
            />
            در حال ذخیره…
          </p>
        ) : status?.kind === "saved" ? (
          <p className="flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
            <Check aria-hidden="true" className="size-3.5" />
            <span>
              ذخیره شد<span className="sr-only">: {status.message}</span>
            </span>
          </p>
        ) : status?.kind === "error" ? (
          <p role="alert" className="flex items-start gap-1 text-destructive">
            <CircleAlert
              aria-hidden="true"
              className="mt-0.5 size-3.5 shrink-0"
            />
            {status.message}
          </p>
        ) : null}
      </div>
    </div>
  );
}
