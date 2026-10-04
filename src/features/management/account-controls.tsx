"use client";

import { Info } from "lucide-react";
import { useState } from "react";

import type { PersonnelUser } from "@/application/management/read-model";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";

import { setAccountActiveAction, updateProfileAction } from "./actions";
import { ManagementInput } from "./form-fields";
import { MutationDialog } from "./mutation-dialog";

type Account = Pick<
  PersonnelUser,
  "id" | "displayName" | "email" | "mobile" | "personnelNumber" | "isActive"
>;

function AccountDialog({
  user,
  operation,
  close,
  success,
}: {
  user: Account;
  operation: "profile" | "status";
  close: () => void;
  success: (message: string) => void;
}) {
  // Freeze expected fields when the form opens, even if its surrounding page refreshes.
  const [snapshot] = useState(user);
  const [name, setName] = useState(snapshot.displayName);
  const [email, setEmail] = useState(snapshot.email ?? "");
  const [mobile, setMobile] = useState(snapshot.mobile ?? "");
  const deactivate = snapshot.isActive;
  const title =
    operation === "profile"
      ? "ویرایش اطلاعات حساب"
      : deactivate
        ? "غیرفعال‌سازی حساب"
        : "فعال‌سازی حساب";
  return (
    <MutationDialog
      title={title}
      description={snapshot.displayName}
      submitLabel={operation === "profile" ? "ذخیره اطلاعات" : title}
      action={
        operation === "profile" ? updateProfileAction : setAccountActiveAction
      }
      onClose={close}
      onSuccess={success}
      destructive={operation === "status" && deactivate}
    >
      {(state) => (
        <>
          <input type="hidden" name="userId" value={snapshot.id} />
          {operation === "profile" ? (
            <>
              <input
                type="hidden"
                name="expectedEmail"
                value={snapshot.email ?? ""}
              />
              <input
                type="hidden"
                name="expectedMobile"
                value={snapshot.mobile ?? ""}
              />
              <input
                type="hidden"
                name="expectedDisplayName"
                value={snapshot.displayName}
              />
              <ManagementInput
                name="displayName"
                label="نام نمایشی"
                value={name}
                onChange={setName}
                error={state.fields?.displayName}
                maxLength={200}
              />
              <ManagementInput
                name="email"
                label="ایمیل (اختیاری)"
                value={email}
                onChange={setEmail}
                error={state.fields?.email}
                maxLength={320}
                dir="ltr"
                type="email"
              />
              <ManagementInput
                name="mobile"
                label="شماره موبایل (اختیاری)"
                value={mobile}
                onChange={setMobile}
                error={state.fields?.mobile}
                maxLength={40}
                dir="ltr"
                type="tel"
                inputMode="tel"
              />
              <Callout icon={Info}>
                {snapshot.personnelNumber
                  ? "ورود با شماره پرسنلی و در صورت ثبت، با ایمیل ممکن است. موبایل شناسه ورود نیست. رمز عبور در این فرم تغییر نمی‌کند."
                  : "این حساب هنوز شماره پرسنلی ندارد؛ ایمیل تنها شناسه ورود آن است و حذف آن مجاز نیست. رمز عبور در این فرم تغییر نمی‌کند."}
              </Callout>
            </>
          ) : (
            <>
              <input
                type="hidden"
                name="expectedIsActive"
                value={String(snapshot.isActive)}
              />
              <input
                type="hidden"
                name="isActive"
                value={String(!snapshot.isActive)}
              />
              <Callout icon={Info} tone={deactivate ? "attention" : "info"}>
                {deactivate
                  ? "کاربر دیگر امکان ورود و دریافت شیفت جدید ندارد. عضویت‌ها، برنامه‌ها و فهرست‌های تاریخی حفظ می‌شوند؛ عضویت‌ها خودکار پایان نمی‌یابند."
                  : "کاربر با توجه به روابطی که هنوز جاری هستند دوباره دسترسی خواهد داشت. فهرست‌های تاریخی برنامه تغییر نمی‌کنند."}
              </Callout>
              <p className="text-sm">
                {deactivate
                  ? "آیا حساب این کاربر غیرفعال شود؟"
                  : "آیا حساب این کاربر فعال شود؟"}
              </p>
            </>
          )}
        </>
      )}
    </MutationDialog>
  );
}

export function AccountControls({ user }: { user: Account }) {
  const [operation, setOperation] = useState<"profile" | "status" | null>(null);
  const [message, setMessage] = useState("");
  return (
    <div className="space-y-3 border-t pt-4">
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => setOperation("profile")}
          aria-haspopup="dialog"
        >
          ویرایش اطلاعات حساب
        </Button>
        <Button
          variant="outline"
          onClick={() => setOperation("status")}
          aria-haspopup="dialog"
        >
          {user.isActive ? "غیرفعال‌سازی حساب" : "فعال‌سازی حساب"}
        </Button>
      </div>
      {message && (
        <p role="status" className="text-sm text-muted-foreground">
          {message}
        </p>
      )}
      {operation && (
        <AccountDialog
          user={user}
          operation={operation}
          close={() => setOperation(null)}
          success={setMessage}
        />
      )}
    </div>
  );
}
