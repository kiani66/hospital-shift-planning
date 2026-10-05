"use client";

import { Check, CircleAlert, LoaderCircle, RotateCw, X } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from "react";

import type { PreferenceValue } from "@/domain/shifts/shift-type";
import { cn } from "@/lib/utils";

import { clearMyPreferenceAction, setMyPreferenceAction } from "./actions";
import {
  PREFERENCE_OPTIONS,
  myPreferenceText,
  preferenceOption,
} from "./presentation";
import {
  createPreferenceSaver,
  type PreferenceChoice,
  type PreferenceSaver,
} from "./save-queue";

/** How long «ذخیره شد ✓» stays before it fades away. */
const SAVED_VISIBLE_MS = 2200;

const focusRing =
  "focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none";

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

/** One saver per day for the component's lifetime (see `save-queue.ts`). */
function usePreferenceSaver(
  scheduleId: string,
  date: string,
  value: PreferenceValue | null,
): PreferenceSaver {
  const [saver] = useState(() =>
    createPreferenceSaver(value, (next) =>
      next === null
        ? clearMyPreferenceAction({ scheduleId, date })
        : setMyPreferenceAction({ scheduleId, date, value: next }),
    ),
  );
  // A refreshed page carries the stored value; applied only while idle.
  useEffect(() => saver.sync(value), [saver, value]);
  return saver;
}

/**
 * One editable day: the five choices, the explicit clear action, and the
 * save state. A tap saves at once (no "save all"); see `save-queue.ts` for
 * how rapid taps and failures are handled. A failed save never stays shown
 * as chosen: the day falls back to the stored value, says what was not saved
 * and offers a retry when one can help.
 *
 * Keyboard: one tab stop per day (roving tabindex); arrow keys, Home and End
 * move between options; Enter or Space selects.
 */
export function PreferenceDayEditor({
  scheduleId,
  date,
  value,
  dayLabel,
  onConfirmed,
}: {
  scheduleId: string;
  date: string;
  /** The stored (server) value. */
  value: PreferenceValue | null;
  /** "شنبه ۲ آبان ۱۴۰۵" */
  dayLabel: string;
  /** The server confirmed a new stored value for this day. */
  onConfirmed: (value: PreferenceChoice) => void;
}) {
  const saver = usePreferenceSaver(scheduleId, date, value);
  const state = useSyncExternalStore(
    saver.subscribe,
    saver.getState,
    saver.getState,
  );
  const { shown, phase, failure, confirmed } = state;
  // Only what the server confirmed counts (the summary never shows a failed choice).
  useEffect(() => onConfirmed(confirmed), [onConfirmed, confirmed]);

  useEffect(() => {
    if (phase !== "saved") return;
    const timer = setTimeout(() => saver.settle(), SAVED_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [saver, phase, confirmed]);

  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIndex = PREFERENCE_OPTIONS.findIndex((o) => o.value === shown);
  const [focusIndex, setFocusIndex] = useState(Math.max(selectedIndex, 0));

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = nextIndex(event.key, focusIndex, PREFERENCE_OPTIONS.length);
    if (index === null) return;
    event.preventDefault();
    setFocusIndex(index);
    buttons.current[index]?.focus();
  }

  const failedName =
    failure === null
      ? null
      : failure.value === null
        ? "پاک کردن"
        : `«${preferenceOption(failure.value).short}»`;

  const current = shown === null ? null : preferenceOption(shown);
  // While a save is reported, the clear action shrinks to its icon (it keeps
  // its accessible name), so «ترجیح من: …» keeps its room on a 360px phone.
  const reporting = phase === "saving" || phase === "saved";

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex min-h-9 items-center gap-x-2">
        <p
          className={cn(
            "flex min-w-0 flex-1 items-center gap-1 text-sm",
            current ? "font-semibold" : "text-muted-foreground",
          )}
        >
          {current && (
            <current.icon
              aria-hidden="true"
              className="hidden size-4 shrink-0 text-muted-foreground min-[24rem]:block"
            />
          )}
          <span className="truncate">{myPreferenceText(shown)}</span>
        </p>
        <span role="status" className="flex shrink-0 items-center text-xs">
          {phase === "saving" ? (
            <span className="flex items-center gap-1 text-muted-foreground">
              <LoaderCircle
                aria-hidden="true"
                className="size-3.5 animate-spin motion-reduce:animate-none"
              />
              در حال ذخیره…
            </span>
          ) : phase === "saved" ? (
            <span className="flex animate-out items-center gap-1 text-status-success-foreground delay-1600 duration-500 fill-mode-forwards fade-out motion-reduce:animate-none">
              ذخیره شد
              <Check aria-hidden="true" className="size-3.5" />
            </span>
          ) : null}
        </span>
        {shown !== null && (
          <button
            type="button"
            onClick={() => saver.choose(null)}
            aria-label={`پاک کردن ترجیح ${dayLabel}`}
            className={cn(
              "relative inline-flex h-9 min-w-11 shrink-0 items-center justify-center gap-1 rounded-md px-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground",
              // A 44px touch target around a compact button.
              "after:absolute after:inset-x-0 after:-inset-y-1 after:content-['']",
              focusRing,
            )}
          >
            <X aria-hidden="true" className="size-4" />
            {!reporting && "پاک کردن"}
          </button>
        )}
      </div>

      <div
        role="group"
        aria-label={`ترجیح شیفت ${dayLabel}`}
        aria-busy={phase === "saving" || undefined}
        onKeyDown={onKeyDown}
        className="grid grid-cols-5 gap-1"
      >
        {PREFERENCE_OPTIONS.map((option, i) => {
          const selected = option.value === shown;
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
              onClick={() => saver.choose(option.value)}
              className={cn(
                "relative flex min-h-11 min-w-0 flex-col items-center justify-center rounded-md border px-0.5 py-1 leading-tight transition-colors",
                focusRing,
                selected
                  ? cn(option.className, "border-current font-bold")
                  : "bg-background hover:bg-accent",
              )}
            >
              {selected && (
                // Subtle selected mark on the corner, clear of the code text.
                <span
                  aria-hidden="true"
                  className="absolute -end-1 -top-1 flex size-4 items-center justify-center rounded-full border border-current bg-background"
                >
                  <Check className="size-2.5" strokeWidth={3} />
                </span>
              )}
              <span className="flex items-center gap-0.5">
                {/* The code always shows; the icon only where it fits beside it. */}
                <option.icon
                  aria-hidden="true"
                  className="hidden size-3.5 shrink-0 opacity-80 min-[24rem]:block"
                />
                <span dir="ltr" className="text-sm font-bold">
                  {option.code}
                </span>
              </span>
              <span className="max-w-full truncate text-[0.625rem] min-[24rem]:text-[0.6875rem]">
                {option.short}
              </span>
            </button>
          );
        })}
      </div>

      {failure && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-destructive"
        >
          <CircleAlert aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="font-semibold">{failedName} ذخیره نشد</span>
          <span className="min-w-0 basis-full ps-5 leading-relaxed sm:basis-auto sm:ps-0">
            {failure.message}
          </span>
          {failure.retryable && (
            <button
              type="button"
              onClick={() => saver.retry()}
              className={cn(
                "inline-flex min-h-9 items-center gap-1 rounded-md px-2 font-medium underline-offset-4 hover:underline",
                focusRing,
              )}
            >
              <RotateCw aria-hidden="true" className="size-3.5" />
              تلاش مجدد
            </button>
          )}
        </div>
      )}
    </div>
  );
}
