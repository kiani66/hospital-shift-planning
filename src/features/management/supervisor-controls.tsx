"use client";

import { Info } from "lucide-react";
import { useState } from "react";

import type { AccessRelation } from "@/application/management/read-model";
import type { getMembershipFormOptions } from "@/application/management/personnel-queries";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { formatJalaliInput } from "@/features/calendar/jalali-input";

import { assignSupervisorAction, endSupervisorAction } from "./actions";
import { ManagementInput, ManagementSelect } from "./form-fields";
import { MutationDialog } from "./mutation-dialog";
import { RelationsSection } from "./relations";

type Options = Awaited<ReturnType<typeof getMembershipFormOptions>>;
type Selection =
  { operation: "add" } | { operation: "end"; relation: AccessRelation };

function SupervisorDialog({
  userId,
  selection,
  options,
  close,
  success,
}: {
  userId: string;
  selection: Selection;
  options: Options;
  close: () => void;
  success: (message: string) => void;
}) {
  const [snapshot] = useState(selection);
  const ending = snapshot.operation === "end";
  const [department, setDepartment] = useState("");
  const [start, setStart] = useState(formatJalaliInput(options.today));
  const [end, setEnd] = useState(
    ending ? formatJalaliInput(options.today) : "",
  );
  const title = ending ? "پایان نظارت" : "افزودن سوپروایزر";
  return (
    <MutationDialog
      title={title}
      description={
        ending
          ? snapshot.relation.department.name
          : "دسترسی نظارت مستقل از عضویت بخش ثبت می‌شود."
      }
      submitLabel={ending ? "ثبت پایان نظارت" : "ثبت دسترسی سوپروایزر"}
      action={ending ? endSupervisorAction : assignSupervisorAction}
      onClose={close}
      onSuccess={success}
    >
      {(state) => (
        <>
          {ending ? (
            <>
              <input
                type="hidden"
                name="relationId"
                value={snapshot.relation.id}
              />
              <input
                type="hidden"
                name="expectedEndedOn"
                value={snapshot.relation.endedOn ?? ""}
              />
            </>
          ) : (
            <>
              <input type="hidden" name="userId" value={userId} />
              <ManagementSelect
                name="departmentId"
                label="بخش نظارت"
                value={department}
                onChange={setDepartment}
                error={state.fields?.departmentId}
              >
                <option value="">انتخاب بخش فعال</option>
                {options.departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </ManagementSelect>
              <ManagementInput
                name="startedOn"
                label="تاریخ شروع نظارت (شمسی)"
                value={start}
                onChange={setStart}
                error={state.fields?.startedOn}
                dir="ltr"
                maxLength={10}
                hint="قالب: سال/ماه/روز، مانند ۱۴۰۵/۰۷/۱۱"
              />
            </>
          )}
          <ManagementInput
            name="endedOn"
            label={
              ending
                ? "تاریخ پایان نظارت (شمسی)"
                : "تاریخ پایان نظارت (شمسی، اختیاری)"
            }
            value={end}
            onChange={setEnd}
            error={state.fields?.endedOn}
            dir="ltr"
            maxLength={10}
            hint={
              ending
                ? "روز انتخاب‌شده آخرین روز دسترسی نظارت است و شامل این دسترسی می‌شود."
                : "خالی یعنی بدون تاریخ پایان؛ تاریخ شروع امروز یا آینده و مدت ثابت قابل ثبت است."
            }
          />
          <Callout icon={Info}>
            {ending
              ? "دسترسی تا پایان روز انتخاب‌شده برقرار می‌ماند و سپس در تاریخچه حفظ می‌شود. حساب، نقش مدیریتی سیستم، عضویت‌های بخش و برنامه‌های تاریخی تغییر نمی‌کنند."
              : "سوپروایزر دسترسی نظارت بر بخش می‌گیرد و نقش پرستار یا سرپرستار دریافت نمی‌کند. حساب غیرفعال با ثبت نظارت فعال نمی‌شود؛ روابط قبلی حفظ می‌شوند."}
          </Callout>
        </>
      )}
    </MutationDialog>
  );
}

export function SupervisorControls({
  userId,
  relations,
  options,
}: {
  userId: string;
  relations: readonly AccessRelation[];
  options: Options;
}) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [message, setMessage] = useState("");
  const relationActions = Object.fromEntries(
    relations.map((relation) => [
      relation.id,
      <Button
        key={relation.id}
        variant="outline"
        onClick={() => setSelection({ operation: "end", relation })}
        aria-haspopup="dialog"
        aria-label={`پایان نظارت در ${relation.department.name}`}
      >
        پایان نظارت
      </Button>,
    ]),
  );
  return (
    <div className="space-y-3">
      <RelationsSection
        id="current-supervisors"
        title="نظارت‌های جاری"
        relations={relations}
        relationActions={relationActions}
        actions={
          <Button
            onClick={() => setSelection({ operation: "add" })}
            aria-haspopup="dialog"
          >
            افزودن سوپروایزر
          </Button>
        }
      />
      <p className="text-sm text-muted-foreground">
        دسترسی سوپروایزر مستقل از عضویت بخش است. پایان فقط برای نظارت جاری مجاز
        است؛ نظارت‌های آینده و پایان‌یافته در تاریخچه فقط نمایش داده می‌شوند.
      </p>
      {message && (
        <p role="status" className="text-sm text-muted-foreground">
          {message}
        </p>
      )}
      {selection && (
        <SupervisorDialog
          userId={userId}
          selection={selection}
          options={options}
          close={() => setSelection(null)}
          success={setMessage}
        />
      )}
    </div>
  );
}
