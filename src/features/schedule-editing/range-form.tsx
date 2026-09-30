"use client";

import { useId, useState } from "react";

import type { IsoDate } from "@/domain/shared/dates";
import { SHIFT_CODES, type ShiftCode } from "@/domain/shifts/shift-type";
import { faNumber } from "@/features/calendar/jalali";
import { SHIFT_PRESENTATION } from "@/features/shifts/catalog";
import { cn } from "@/lib/utils";

export interface DayOption {
  readonly date: IsoDate;
  readonly label: string;
}

const focusRing =
  "focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none";

/**
 * A bounded range edit for one nurse: one shift (or "no shift") from this
 * day through a later day of the period, sent as one request (all or
 * nothing, audited per day, undoable).
 */
export function RangeForm({
  id,
  nurseName,
  initialShift,
  date,
  rangeEnds,
  onApply,
  onCancel,
}: {
  id: string;
  nurseName: string;
  initialShift: ShiftCode | null;
  date: IsoDate;
  rangeEnds: readonly DayOption[];
  onApply: (shift: ShiftCode | null, dates: IsoDate[]) => void;
  onCancel: () => void;
}) {
  const [shift, setShift] = useState<ShiftCode | "NONE">(initialShift ?? "M");
  const [end, setEnd] = useState(
    rangeEnds[Math.min(rangeEnds.length, 6) - 1]!.date,
  );
  const endIndex = rangeEnds.findIndex((d) => d.date === end);
  const dates = [date, ...rangeEnds.slice(0, endIndex + 1).map((d) => d.date)];
  const endId = useId();
  const options = [
    ...SHIFT_CODES.map((code) => ({
      value: code as ShiftCode | "NONE",
      label: `${SHIFT_PRESENTATION[code].name} (${code})`,
    })),
    { value: "NONE" as const, label: "بدون شیفت" },
  ];

  return (
    <form
      id={id}
      aria-label={`اعمال برای چند روز: ${nurseName}`}
      onSubmit={(event) => {
        event.preventDefault();
        onApply(shift === "NONE" ? null : shift, dates);
      }}
      className="mt-2 flex flex-col gap-3 rounded-md border bg-muted/40 p-3"
    >
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-xs font-medium">شیفت</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {options.map((o) => (
            <label
              key={o.value}
              className="inline-flex min-h-9 items-center gap-1.5 text-sm pointer-coarse:min-h-11"
            >
              <input
                type="radio"
                name={`${id}-shift`}
                value={o.value}
                checked={shift === o.value}
                onChange={() => setShift(o.value)}
                className="size-4"
              />
              {o.label}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={endId} className="text-xs font-medium">
          از این روز تا
        </label>
        <select
          id={endId}
          value={end}
          onChange={(e) => setEnd(e.target.value as IsoDate)}
          className="min-h-9 rounded-md border border-input bg-background px-2 text-sm pointer-coarse:min-h-11 pointer-coarse:text-base"
        >
          {rangeEnds.map((d) => (
            <option key={d.date} value={d.date}>
              {d.label}
            </option>
          ))}
        </select>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {faNumber(dates.length)} روز. شیفت‌های فعلی {nurseName} در این روزها
        جایگزین می‌شود؛ قابل بازگردانی است.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          className={cn(
            "inline-flex min-h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 pointer-coarse:min-h-11",
            focusRing,
          )}
        >
          اعمال برای {faNumber(dates.length)} روز
        </button>
        <button
          type="button"
          onClick={onCancel}
          className={cn(
            "inline-flex min-h-9 items-center rounded-md border px-3 text-sm hover:bg-accent pointer-coarse:min-h-11",
            focusRing,
          )}
        >
          انصراف
        </button>
      </div>
    </form>
  );
}
