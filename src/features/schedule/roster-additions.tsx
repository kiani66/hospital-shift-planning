"use client";

import { UserPlus } from "lucide-react";
import { useActionState, useId, useState } from "react";

import type { RosterCandidate } from "@/application/schedules/roster";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Dialog } from "@/components/ui/dialog";
import { faNumber } from "@/features/calendar/jalali";

import { addRosterMembersAction, type ScheduleFormState } from "./actions";
import { ROLE_LABELS } from "./labels";

/**
 * Head Nurse: add department members who joined after the roster snapshot
 * (DRAFT / PLANNING only). Lists only eligible people; the server checks
 * membership, account status, schedule status and revision again.
 */
export function RosterAdditions({
  scheduleId,
  revision,
  candidates,
}: {
  scheduleId: string;
  revision: number;
  candidates: readonly RosterCandidate[];
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const allId = useId();
  const [state, formAction, pending] = useActionState(
    async (previous: ScheduleFormState, formData: FormData) => {
      const next = await addRosterMembersAction(previous, formData);
      if (next.status === "success") {
        setOpen(false);
        setSelected(new Set());
      }
      return next;
    },
    { status: "idle" },
  );
  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const all = candidates.length > 0 && selected.size === candidates.length;

  if (candidates.length === 0)
    return (
      <p className="text-xs leading-relaxed text-muted-foreground">
        همه اعضای فعال بخش که در این بازه عضویت دارند در فهرست برنامه هستند.
      </p>
    );

  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="outline"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="w-full sm:w-auto"
      >
        <UserPlus aria-hidden="true" className="size-5" />
        افزودن پرسنل به برنامه ({faNumber(candidates.length)} نفر واجد شرایط)
      </Button>
      {state.status !== "idle" && !open && (
        <p
          role={state.status === "error" ? "alert" : "status"}
          className={
            state.status === "error"
              ? "text-sm text-destructive"
              : "text-sm text-muted-foreground"
          }
        >
          {state.message}
        </p>
      )}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        preventClose={pending}
        title="افزودن پرسنل به فهرست برنامه"
        description="اعضای فعال بخش که در این بازه عضویت دارند ولی هنگام ایجاد برنامه در فهرست نبوده‌اند."
        stickyHeader
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
      >
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="scheduleId" value={scheduleId} />
          <input type="hidden" name="expectedRevision" value={revision} />
          <Callout icon={UserPlus} tone="info">
            افراد انتخاب‌شده بدون هیچ شیفتی به برنامه اضافه می‌شوند؛ شیفت‌ها و
            ترجیحات دیگران تغییر نمی‌کند. اگر ثبت ترجیحات برای همه باز است،
            آن‌ها هم می‌توانند ترجیح ثبت کنند.
          </Callout>
          <div className="flex items-center gap-3 border-b pb-2">
            <input
              id={allId}
              type="checkbox"
              checked={all}
              onChange={() =>
                setSelected(
                  all ? new Set() : new Set(candidates.map((c) => c.userId)),
                )
              }
              className="size-4 accent-primary"
            />
            <label htmlFor={allId} className="text-sm font-medium">
              انتخاب همه
            </label>
          </div>
          <fieldset disabled={pending}>
            <legend className="sr-only">افراد واجد شرایط</legend>
            <ul className="max-h-80 divide-y overflow-y-auto">
              {candidates.map((c) => (
                <li key={c.userId}>
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 px-1 py-2">
                    <input
                      type="checkbox"
                      name="userId"
                      value={c.userId}
                      checked={selected.has(c.userId)}
                      onChange={() => toggle(c.userId)}
                      className="size-4 shrink-0 accent-primary"
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {c.displayName}
                    </span>
                    {c.personnelNumber && (
                      <span
                        dir="ltr"
                        className="shrink-0 font-mono text-xs text-muted-foreground"
                      >
                        {c.personnelNumber}
                      </span>
                    )}
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {ROLE_LABELS[c.role]}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
          <div
            role="alert"
            className={
              state.status === "error"
                ? "rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-sm leading-relaxed text-destructive"
                : "sr-only"
            }
          >
            {state.status === "error" ? state.message : null}
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => setOpen(false)}>
              انصراف
            </Button>
            <Button type="submit" disabled={pending || selected.size === 0}>
              {pending
                ? "در حال افزودن…"
                : `افزودن ${faNumber(selected.size)} نفر`}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
