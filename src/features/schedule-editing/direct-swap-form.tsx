"use client";

import { useActionState, useId } from "react";
import type { ReasonView } from "@/application/change-requests/queries";
import type { ReviewRosterNurse } from "@/application/schedules/review";
import { Button } from "@/components/ui/button";
import type { RequestFormState } from "@/features/change-requests/actions";
import { assignmentName, type ShiftLabels } from "@/features/shifts/catalog";
import { directSwapAction } from "./actions";

const fieldClass =
  "min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none";

export function DirectSwapForm({
  scheduleId,
  revision,
  date,
  nurses,
  reasons,
  shiftLabels,
}: {
  scheduleId: string;
  revision: number;
  date: string;
  nurses: readonly ReviewRosterNurse[];
  reasons: readonly ReasonView[];
  shiftLabels: ShiftLabels;
}) {
  const [state, action, pending] = useActionState(directSwapAction, {
    status: "idle",
  } as RequestFormState);
  const id = useId();
  const decided = nurses.filter((n) => n.shift !== null);
  return (
    <details className="rounded-xl border bg-card p-3">
      <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none">
        جابه‌جایی مستقیم
      </summary>
      <form action={action} className="flex min-w-0 flex-col gap-3">
        <p className="text-xs text-muted-foreground">
          دو تصمیم جابه‌جا می‌شوند؛ قوانین برنامه بررسی و تغییر با علت ثبت
          می‌شود.
        </p>
        <input type="hidden" name="scheduleId" value={scheduleId} />
        <input type="hidden" name="expectedRevision" value={revision} />
        <input type="hidden" name="date" value={date} />
        {(["firstNurseId", "secondNurseId"] as const).map((name, i) => (
          <div key={name} className="flex flex-col gap-1 text-sm">
            <label htmlFor={`${id}-${name}`}>
              {i === 0 ? "پرستار اول" : "پرستار دوم"}
            </label>
            <select
              id={`${id}-${name}`}
              name={name}
              required
              defaultValue=""
              className={fieldClass}
            >
              <option value="" disabled>
                انتخاب کنید
              </option>
              {decided.map((n) => (
                <option key={n.userId} value={n.userId}>
                  {n.displayName} — {assignmentName(n.shift, shiftLabels)}
                </option>
              ))}
            </select>
          </div>
        ))}
        <div className="flex flex-col gap-1 text-sm">
          <label htmlFor={`${id}-reason`}>علت</label>
          <select
            id={`${id}-reason`}
            name="reasonCode"
            required
            defaultValue=""
            className={fieldClass}
          >
            <option value="" disabled>
              انتخاب کنید
            </option>
            {reasons.map((r) => (
              <option key={r.code} value={r.code}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1 text-sm">
          <label htmlFor={`${id}-note`}>توضیح (برای سایر الزامی است)</label>
          <textarea
            id={`${id}-note`}
            name="note"
            maxLength={2000}
            className={fieldClass}
          />
        </div>
        {state.status !== "idle" && (
          <p
            role={state.status === "error" ? "alert" : "status"}
            className="text-sm"
          >
            {state.message}
          </p>
        )}
        <Button type="submit" disabled={pending || decided.length < 2}>
          ثبت جابه‌جایی
        </Button>
      </form>
    </details>
  );
}
