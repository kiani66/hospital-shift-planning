"use client";

import { ShieldCheck } from "lucide-react";
import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";

import { applyRuleSetAction, type RuleSetFormState } from "./actions";

/**
 * The explicit confirmation of an Apply (D107 N): the box must be ticked
 * after reading the preview; the form carries the schedule revision and the
 * pin the preview was computed at, so a change in between is a conflict.
 */
export function ApplyConfirmForm({
  scheduleId,
  revision,
  fromVersionId,
  toVersionId,
  departmentCode,
  targetLabel,
}: {
  scheduleId: string;
  revision: number;
  fromVersionId: string;
  toVersionId: string;
  departmentCode: string;
  targetLabel: string;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [state, action, pending] = useActionState<RuleSetFormState, FormData>(
    applyRuleSetAction,
    { status: "idle" },
  );
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="scheduleId" value={scheduleId} />
      <input type="hidden" name="expectedRevision" value={revision} />
      <input type="hidden" name="fromVersionId" value={fromVersionId} />
      <input type="hidden" name="toVersionId" value={toVersionId} />
      <input type="hidden" name="departmentCode" value={departmentCode} />
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="confirm"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="mt-1 size-4"
        />
        پیش‌نمایش را بررسی کردم و اعمال «{targetLabel}» را بر این برنامه تأیید
        می‌کنم. شیفت‌ها تغییر نمی‌کنند؛ فقط قوانین سنجش پوشش عوض می‌شود.
      </label>
      {state.status === "error" && (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          {state.message}
        </p>
      )}
      <div>
        <Button type="submit" disabled={!confirmed || pending}>
          <ShieldCheck aria-hidden="true" className="size-4" />
          {pending ? "در حال اعمال…" : "اعمال نسخه بر این برنامه"}
        </Button>
      </div>
    </form>
  );
}
