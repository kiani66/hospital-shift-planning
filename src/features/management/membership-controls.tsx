"use client";

import { Info } from "lucide-react";
import { useState } from "react";

import type { MembershipView } from "@/application/management/read-model";
import type { getMembershipFormOptions } from "@/application/management/personnel-queries";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { formatJalaliDate } from "@/features/calendar/jalali";
import { formatJalaliInput } from "@/features/calendar/jalali-input";

import {
  addMembershipAction,
  changeMembershipRoleAction,
  endMembershipAction,
  transferMembershipAction,
} from "./actions";
import { ManagementInput, ManagementSelect } from "./form-fields";
import { MutationDialog } from "./mutation-dialog";
import { MEMBERSHIP_LABELS } from "./presentation";
import { RelationsSection } from "./relations";

type Options = Awaited<ReturnType<typeof getMembershipFormOptions>>;
type Selection =
  | { operation: "add" }
  | { operation: "end" | "transfer" | "role"; relation: MembershipView };
const titles = {
  add: "افزودن عضویت",
  end: "پایان عضویت",
  transfer: "انتقال به بخش دیگر",
  role: "تغییر نقش عضویت",
} as const;
const actions = {
  add: addMembershipAction,
  end: endMembershipAction,
  transfer: transferMembershipAction,
  role: changeMembershipRoleAction,
} as const;

function MembershipDialog({
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
  const operation = snapshot.operation;
  const relation = "relation" in snapshot ? snapshot.relation : null;
  const [departmentId, setDepartmentId] = useState(
    operation === "role" ? relation!.department.id : "",
  );
  const [role, setRole] = useState(
    operation === "role"
      ? relation!.role === "NURSE"
        ? "HEAD_NURSE"
        : "NURSE"
      : "NURSE",
  );
  const [start, setStart] = useState(formatJalaliInput(options.today));
  const [end, setEnd] = useState(
    operation === "end"
      ? formatJalaliInput(options.today)
      : relation?.endedOn
        ? formatJalaliInput(relation.endedOn)
        : "",
  );
  const departments = options.departments.filter(
    (d) => operation !== "transfer" || d.id !== relation?.department.id,
  );
  return (
    <MutationDialog
      title={titles[operation]}
      description={
        relation
          ? `${relation.department.name} · ${MEMBERSHIP_LABELS[relation.role]}`
          : "عضویت مستقل از وضعیت حساب ثبت می‌شود."
      }
      submitLabel={
        operation === "end"
          ? "ثبت پایان عضویت"
          : operation === "transfer"
            ? "ثبت انتقال"
            : operation === "role"
              ? "ثبت تغییر نقش"
              : "ثبت عضویت"
      }
      action={actions[operation]}
      onClose={close}
      onSuccess={success}
    >
      {(state) => (
        <>
          {operation === "add" ? (
            <input type="hidden" name="userId" value={userId} />
          ) : (
            <>
              <input type="hidden" name="relationId" value={relation!.id} />
              <input
                type="hidden"
                name="expectedEndedOn"
                value={relation!.endedOn ?? ""}
              />
            </>
          )}
          {operation !== "end" && (
            <>
              {operation === "role" ? (
                <input type="hidden" name="departmentId" value={departmentId} />
              ) : (
                <ManagementSelect
                  name="departmentId"
                  label={operation === "transfer" ? "بخش مقصد" : "بخش"}
                  value={departmentId}
                  onChange={setDepartmentId}
                  error={state.fields?.departmentId}
                >
                  <option value="">انتخاب بخش فعال</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </ManagementSelect>
              )}
              <ManagementSelect
                name="role"
                label={
                  operation === "role"
                    ? "نقش جدید"
                    : operation === "transfer"
                      ? "نقش در بخش مقصد"
                      : "نقش عضویت"
                }
                value={role}
                onChange={setRole}
                error={state.fields?.role}
              >
                <option value="NURSE">پرستار</option>
                <option value="HEAD_NURSE">سرپرستار</option>
              </ManagementSelect>
              <ManagementInput
                name="startedOn"
                label={
                  operation === "add"
                    ? "تاریخ شروع (شمسی)"
                    : "تاریخ مؤثر تغییر (شمسی)"
                }
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
              operation === "end"
                ? "تاریخ پایان (شمسی)"
                : "تاریخ پایان عضویت جدید (شمسی، اختیاری)"
            }
            value={end}
            onChange={setEnd}
            error={state.fields?.endedOn}
            dir="ltr"
            maxLength={10}
            hint={
              operation === "end"
                ? "روز انتخاب‌شده آخرین روز عضویت است و شامل عضویت می‌شود."
                : "خالی یعنی بدون تاریخ پایان؛ برای مدت ثابت، تاریخ پایان را وارد کنید."
            }
          />
          {operation === "end" ? (
            <Callout icon={Info}>
              عضویت تا پایان {end || "روز انتخاب‌شده"} برقرار می‌ماند و سپس در
              تاریخچه حفظ می‌شود. حساب کاربر غیرفعال نمی‌شود؛ برنامه‌های تاریخی
              تغییر نمی‌کنند.
            </Callout>
          ) : operation === "add" ? (
            <Callout icon={Info}>
              شروع گذشته، امروز یا آینده و عضویت با مدت ثابت قابل ثبت است. حساب
              غیرفعال با ثبت عضویت فعال نمی‌شود.
            </Callout>
          ) : (
            <Callout icon={Info}>
              عضویت قبلی روز قبل از تاریخ تغییر بسته می‌شود و عضویت جدید از آن
              تاریخ آغاز می‌شود. بخش و نقش قبلی و برنامه‌های تاریخی حفظ می‌شوند.
              تغییر باید بعد از اولین روز عضویت قبلی باشد؛ شروع قبلی:{" "}
              {formatJalaliDate(relation!.startedOn)}.
            </Callout>
          )}
        </>
      )}
    </MutationDialog>
  );
}

export function MembershipControls({
  userId,
  memberships,
  options,
}: {
  userId: string;
  memberships: readonly MembershipView[];
  options: Options;
}) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [message, setMessage] = useState("");
  const relationActions = Object.fromEntries(
    memberships.map((relation) => [
      relation.id,
      <div key={relation.id} className="flex flex-wrap gap-2">
        {(["end", "transfer", "role"] as const).map((operation) => (
          <Button
            key={operation}
            variant="outline"
            onClick={() => setSelection({ operation, relation })}
            aria-haspopup="dialog"
            aria-label={`${titles[operation]} در ${relation.department.name}`}
          >
            {titles[operation]}
          </Button>
        ))}
      </div>,
    ]),
  );
  return (
    <div className="space-y-3">
      <RelationsSection
        id="current-memberships"
        title="عضویت‌های جاری"
        relations={memberships}
        relationActions={relationActions}
        actions={
          <Button
            onClick={() => setSelection({ operation: "add" })}
            aria-haspopup="dialog"
          >
            افزودن عضویت
          </Button>
        }
      />
      <p className="text-sm text-muted-foreground">
        پایان، انتقال و تغییر نقش فقط برای عضویت جاری مجاز است. روابط آینده و
        پایان‌یافته در تاریخچه فقط نمایش داده می‌شوند.
      </p>
      {message && (
        <p role="status" className="text-sm text-muted-foreground">
          {message}
        </p>
      )}
      {selection && (
        <MembershipDialog
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
