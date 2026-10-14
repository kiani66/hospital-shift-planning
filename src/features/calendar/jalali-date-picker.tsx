"use client";

import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import { Input } from "@/components/ui/input";
import type { IsoDate } from "@/domain/shared/dates";
import { cn } from "@/lib/utils";

import {
  clampDate,
  monthInRange,
  moveFocus,
  pickerMonth,
  pickerYears,
  sameDayIn,
  shiftMonths,
  validateDateText,
  type PickerDay,
} from "./date-picker";
import { faDigits, JALALI_MONTHS } from "./jalali";
import { formatJalaliInput, parseJalaliInput } from "./jalali-input";

export interface JalaliDatePickerProps {
  /** Id of the text field, for an external `<Label htmlFor>`. */
  id?: string;
  /** Form field name; the field submits the Jalali text (`۱۴۰۵/۰۷/۱۱`) as before. */
  name?: string;
  /** The selected day, or null when empty. */
  value: IsoDate | null;
  /** A valid typed or picked day, or null when cleared. Invalid text is not reported. */
  onChange: (value: IsoDate | null) => void;
  disabled?: boolean;
  required?: boolean;
  minDate?: IsoDate | null;
  maxDate?: IsoDate | null;
  placeholder?: string;
  /** An error from the form or server; a local validation message takes precedence. */
  error?: string;
  /**
   * Today's calendar day, ideally from the server (Tehran) so both sides
   * agree. Without it, today is read in Asia/Tehran when the calendar opens.
   */
  today?: IsoDate;
  /** Extra description (a hint) for the text field. */
  "aria-describedby"?: string;
}

const tehranToday = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tehran",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date()) as IsoDate;

/**
 * A Jalali date field: typed `YYYY/MM/DD` text (Persian, Arabic or Latin
 * digits) or a month calendar opened from the field or its icon. The value is
 * an ISO day; Jalali exists only in this adapter. The calendar is a popover
 * in the top layer, so it is never clipped by, or hidden under, a modal
 * `<dialog>`.
 */
export function JalaliDatePicker({
  id: idProp,
  name,
  value,
  onChange,
  disabled = false,
  required = false,
  minDate = null,
  maxDate = null,
  placeholder = "سال/ماه/روز",
  error,
  today: todayProp,
  "aria-describedby": describedBy,
}: JalaliDatePickerProps) {
  const generatedId = useId();
  const id = idProp ?? generatedId;
  const popupId = `${id}-calendar`;
  const errorId = `${id}-error`;
  const bounds = { minDate, maxDate };

  const [text, setText] = useState(() =>
    value ? formatJalaliInput(value) : "",
  );
  const [syncedValue, setSyncedValue] = useState(value);
  const [touched, setTouched] = useState(false);
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState<IsoDate | null>(null);
  const [today, setToday] = useState<IsoDate | null>(todayProp ?? null);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const focusDay = useRef(false);

  // A value set from outside (another field, a reset) replaces the text,
  // unless the text already means that day.
  if (value !== syncedValue) {
    setSyncedValue(value);
    if (parseJalaliInput(text) !== value)
      setText(value ? formatJalaliInput(value) : "");
  }
  if (disabled && open) setOpen(false);

  const result = validateDateText(text, { ...bounds, required });
  // Range errors follow from a valid day (possibly another field's change)
  // and show at once; format and required errors wait until the field is left.
  const localError =
    !result.ok && (touched || parseJalaliInput(text) !== null)
      ? result.message
      : undefined;
  const shownError = localError ?? error;

  const emit = (next: IsoDate | null) => {
    if (next !== value) onChange(next);
  };

  const openCalendar = (moveFocusToDay: boolean) => {
    const day = today ?? todayProp ?? tehranToday();
    setToday(day);
    setFocused(clampDate(parseJalaliInput(text) ?? value ?? day, bounds));
    focusDay.current = moveFocusToDay;
    setOpen(true);
  };

  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) inputRef.current?.focus();
  };

  const select = (day: PickerDay) => {
    if (day.disabled) return;
    setText(formatJalaliInput(day.date));
    setTouched(true);
    emit(day.date);
    close(true);
  };

  const clear = () => {
    setText("");
    emit(null);
    close(true);
  };

  const view = (date: IsoDate) => setFocused(clampDate(date, bounds));

  // Show the popover in the top layer and keep it next to the field.
  useLayoutEffect(() => {
    const popup = popupRef.current;
    const anchor = wrapperRef.current;
    if (!open || !popup || !anchor) return;
    if (
      typeof popup.showPopover === "function" &&
      !popup.matches(":popover-open")
    )
      popup.showPopover();
    const place = () => {
      const field = anchor.getBoundingClientRect();
      const { width, height } = popup.getBoundingClientRect();
      const viewWidth = document.documentElement.clientWidth;
      const viewHeight = window.innerHeight;
      const gap = 4;
      const margin = 8;
      const below = field.bottom + gap;
      const above = field.top - gap - height;
      let top =
        below + height <= viewHeight - margin || above < margin ? below : above;
      top = Math.max(margin, Math.min(top, viewHeight - height - margin));
      // Align the inline-start edges (the right edges in RTL).
      const rtl = getComputedStyle(anchor).direction === "rtl";
      let start = rtl ? field.right - width : field.left;
      start = Math.max(margin, Math.min(start, viewWidth - width - margin));
      popup.style.top = `${top}px`;
      popup.style.left = `${start}px`;
      popup.style.visibility = "visible";
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(popup);
    window.addEventListener("resize", place);
    // Capture: the field may scroll inside the dialog, not the window.
    document.addEventListener("scroll", place, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      document.removeEventListener("scroll", place, true);
    };
  }, [open]);

  // Close when the pointer or focus goes elsewhere.
  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      if (wrapperRef.current?.contains(event.target as Node)) return;
      setOpen(false);
      setTouched(true);
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("focusin", outside);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("focusin", outside);
    };
  }, [open]);

  // Roving focus: after a keyboard move, focus the newly focused day.
  useEffect(() => {
    if (!open || !focusDay.current || !focused) return;
    focusDay.current = false;
    popupRef.current
      ?.querySelector<HTMLButtonElement>(`[data-date="${focused}"]`)
      ?.focus();
  }, [open, focused]);

  const onFieldKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      // Already open (from a click): no state changes, so focus the day here.
      if (open)
        popupRef.current
          ?.querySelector<HTMLButtonElement>(`[data-date="${focused}"]`)
          ?.focus();
      else openCalendar(true);
    } else if (event.key === "Escape" && open) {
      // Close only the calendar, not an enclosing dialog.
      event.preventDefault();
      event.stopPropagation();
      close(false);
    } else if (event.key === "Enter") {
      const parsed = parseJalaliInput(text);
      if (parsed) setText(formatJalaliInput(parsed));
      setTouched(true);
      if (open) {
        event.preventDefault();
        close(false);
      }
    }
  };

  const onPopupKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    }
  };

  const onGridKeyDown = (event: KeyboardEvent<HTMLTableElement>) => {
    if (!focused) return;
    const ltr = getComputedStyle(event.currentTarget).direction === "ltr";
    const next = moveFocus(focused, event.key, {
      ...bounds,
      shiftKey: event.shiftKey,
      ltr,
    });
    if (!next) return;
    event.preventDefault();
    focusDay.current = true;
    setFocused(next);
  };

  const month =
    open && focused
      ? pickerMonth(focused, { ...bounds, selected: value, today })
      : null;

  return (
    <div className="space-y-2">
      <div ref={wrapperRef} className="relative">
        <Input
          ref={inputRef}
          id={id}
          name={name}
          value={text}
          onChange={(event) => {
            const next = event.target.value;
            setText(next);
            const parsed = parseJalaliInput(next);
            if (next.trim() === "") emit(null);
            else if (parsed) {
              emit(parsed);
              if (open) view(parsed);
            }
          }}
          onClick={() => {
            if (!open) openCalendar(false);
          }}
          onKeyDown={onFieldKeyDown}
          onBlur={(event) => {
            const parsed = parseJalaliInput(text);
            if (parsed) setText(formatJalaliInput(parsed));
            if (!wrapperRef.current?.contains(event.relatedTarget as Node))
              setTouched(true);
          }}
          placeholder={placeholder}
          disabled={disabled}
          required={required}
          dir="ltr"
          maxLength={10}
          autoComplete="off"
          spellCheck={false}
          role="combobox"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? popupId : undefined}
          aria-required={required}
          aria-invalid={!!shownError}
          aria-describedby={
            [shownError ? errorId : null, describedBy]
              .filter(Boolean)
              .join(" ") || undefined
          }
          // dir="ltr": the inline start (`ps`) is the left, beside the icon.
          className="ps-12 text-end tabular-nums"
        />
        <button
          type="button"
          aria-label="انتخاب از تقویم"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? popupId : undefined}
          disabled={disabled}
          tabIndex={-1}
          onClick={() => (open ? close(true) : openCalendar(true))}
          className="absolute inset-y-0 end-0 my-auto me-1 inline-flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
        >
          <CalendarDays aria-hidden="true" className="size-5" />
        </button>
        {month && focused && (
          <div
            ref={popupRef}
            id={popupId}
            popover="manual"
            role="dialog"
            aria-modal="false"
            aria-label="تقویم شمسی"
            tabIndex={-1}
            onKeyDown={onPopupKeyDown}
            style={{ position: "fixed", inset: "auto", visibility: "hidden" }}
            className="z-50 m-0 w-[min(20rem,calc(100vw-1rem))] overflow-visible rounded-lg border bg-popover p-3 text-popover-foreground shadow-lg outline-none"
          >
            <div className="flex items-center gap-1">
              <MonthStep
                direction="previous"
                enabled={month.canGoPrevious}
                onStep={() => view(shiftMonths(focused, -1) ?? focused)}
              />
              <select
                aria-label="ماه"
                value={month.month.month}
                onChange={(event) =>
                  view(
                    sameDayIn(focused, {
                      year: month.month.year,
                      month: Number(event.target.value),
                    }),
                  )
                }
                className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none"
              >
                {JALALI_MONTHS.map((label, index) => (
                  <option
                    key={label}
                    value={index + 1}
                    disabled={
                      !monthInRange(
                        { year: month.month.year, month: index + 1 },
                        bounds,
                      )
                    }
                  >
                    {label}
                  </option>
                ))}
              </select>
              <select
                aria-label="سال"
                value={month.month.year}
                onChange={(event) =>
                  view(
                    sameDayIn(focused, {
                      year: Number(event.target.value),
                      month: month.month.month,
                    }),
                  )
                }
                className="h-9 w-20 rounded-md border border-input bg-background px-2 text-sm tabular-nums focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none"
              >
                {pickerYears(bounds).map((year) => (
                  <option key={year} value={year}>
                    {faDigits(year)}
                  </option>
                ))}
              </select>
              <MonthStep
                direction="next"
                enabled={month.canGoNext}
                onStep={() => view(shiftMonths(focused, 1) ?? focused)}
              />
            </div>
            <table
              role="grid"
              aria-label={month.label}
              onKeyDown={onGridKeyDown}
              className="mt-3 w-full border-collapse text-center"
            >
              <thead>
                <tr>
                  {month.weekdays.map((weekday) => (
                    <th
                      key={weekday.long}
                      scope="col"
                      abbr={weekday.long}
                      className="pb-1 text-xs font-medium text-muted-foreground"
                    >
                      {weekday.short}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {month.weeks.map((week, row) => (
                  <tr key={row}>
                    {week.map((day, column) =>
                      day ? (
                        <td
                          key={day.date}
                          aria-selected={day.selected}
                          className="p-0.5"
                        >
                          <DayButton day={day} onSelect={select} />
                        </td>
                      ) : (
                        <td key={`empty-${column}`} aria-hidden="true" />
                      ),
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-2 flex items-center justify-between gap-2 border-t pt-2">
              <TodayButton
                today={today}
                bounds={bounds}
                onPick={(date) => {
                  setText(formatJalaliInput(date));
                  setTouched(true);
                  emit(date);
                  close(true);
                }}
              />
              {!required && (
                <button
                  type="button"
                  onClick={clear}
                  className="inline-flex h-9 items-center rounded-md px-3 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none"
                >
                  پاک کردن تاریخ
                </button>
              )}
            </div>
          </div>
        )}
      </div>
      {shownError && (
        <p id={errorId} aria-live="polite" className="text-sm text-destructive">
          {shownError}
        </p>
      )}
    </div>
  );
}

function MonthStep({
  direction,
  enabled,
  onStep,
}: {
  direction: "previous" | "next";
  enabled: boolean;
  onStep: () => void;
}) {
  // RTL: the previous month is at the inline start (right), pointing right.
  const Icon = direction === "previous" ? ChevronRight : ChevronLeft;
  return (
    <button
      type="button"
      aria-label={direction === "previous" ? "ماه قبل" : "ماه بعد"}
      // aria-disabled keeps focus on the button at the first or last month.
      aria-disabled={!enabled}
      onClick={() => enabled && onStep()}
      className="inline-flex size-9 shrink-0 items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none aria-disabled:cursor-not-allowed aria-disabled:opacity-40 aria-disabled:hover:bg-transparent"
    >
      <Icon aria-hidden="true" className="size-5" />
    </button>
  );
}

function DayButton({
  day,
  onSelect,
}: {
  day: PickerDay;
  onSelect: (day: PickerDay) => void;
}) {
  return (
    <button
      type="button"
      data-date={day.date}
      tabIndex={day.focused ? 0 : -1}
      aria-label={day.today ? `${day.name}، امروز` : day.name}
      aria-current={day.today ? "date" : undefined}
      aria-disabled={day.disabled || undefined}
      onClick={() => onSelect(day)}
      className={cn(
        "relative mx-auto flex size-10 items-center justify-center rounded-md text-sm tabular-nums transition-colors",
        "focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none",
        day.selected
          ? "bg-primary font-semibold text-primary-foreground hover:bg-primary/90"
          : day.disabled
            ? "cursor-not-allowed text-muted-foreground/45"
            : "hover:bg-accent hover:text-accent-foreground",
        day.today &&
          !day.selected &&
          "font-bold text-primary ring-1 ring-primary/60 ring-inset",
        // A dot marks today, also when it is the selected day.
        day.today &&
          "after:absolute after:bottom-1 after:size-1 after:rounded-full after:bg-current",
      )}
    >
      {day.label}
    </button>
  );
}

function TodayButton({
  today,
  bounds,
  onPick,
}: {
  today: IsoDate | null;
  bounds: { minDate: IsoDate | null; maxDate: IsoDate | null };
  onPick: (date: IsoDate) => void;
}) {
  if (!today) return <span />;
  const allowed = clampDate(today, bounds) === today;
  return (
    <button
      type="button"
      disabled={!allowed}
      onClick={() => onPick(today)}
      className="inline-flex h-9 items-center rounded-md px-3 text-sm font-medium text-primary hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:text-muted-foreground disabled:opacity-60"
    >
      امروز
    </button>
  );
}
