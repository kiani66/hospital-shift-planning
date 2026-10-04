"use client";

import { Copy, IdCard, KeyRound } from "lucide-react";
import { useState } from "react";

import type { PersonnelDetail } from "@/application/management/read-model";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";

import {
  issueTemporaryPasswordAction,
  setPersonnelNumberAction,
} from "./actions";
import { ManagementInput } from "./form-fields";
import { MutationDialog } from "./mutation-dialog";

type Identity = Pick<
  PersonnelDetail,
  | "id"
  | "displayName"
  | "personnelNumber"
  | "isActive"
  | "hasCredentials"
  | "mustChangePassword"
>;

/**
 * Shows a generated temporary password once. It lives only in this
 * component's state: never in the URL, storage or a later response. Hiding
 * it (or leaving the page) discards it for good.
 */
export function OneTimePassword({
  password,
  onDone,
}: {
  password: string;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <section
      aria-label="رمز موقت"
      className="space-y-3 rounded-xl border border-status-info/40 bg-status-info/8 p-4"
    >
      <p className="text-sm font-semibold">
        رمز موقت (فقط همین یک بار نمایش داده می‌شود):
      </p>
      <p
        dir="ltr"
        data-testid="temporary-password"
        className="rounded-md border bg-card px-3 py-2 text-center font-mono text-lg tracking-wider select-all"
      >
        {password}
      </p>
      <p className="text-xs leading-relaxed text-muted-foreground">
        رمز را مستقیماً و به‌صورت امن به خود کاربر بدهید. در هیچ جای سامانه
        ذخیره یا دوباره نمایش داده نمی‌شود و کاربر در اولین ورود باید آن را
        تغییر دهد.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(password);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
        >
          <Copy aria-hidden="true" className="size-4" />
          {copied ? "کپی شد" : "کپی رمز"}
        </Button>
        <Button onClick={onDone}>تحویل دادم؛ پنهان شود</Button>
      </div>
    </section>
  );
}

function PersonnelNumberDialog({
  user,
  close,
  success,
}: {
  user: Identity;
  close: () => void;
  success: (message: string) => void;
}) {
  const [snapshot] = useState(user);
  const [value, setValue] = useState(snapshot.personnelNumber ?? "");
  const assigning = snapshot.personnelNumber === null;
  return (
    <MutationDialog
      title={assigning ? "ثبت شماره پرسنلی" : "اصلاح شماره پرسنلی"}
      description={snapshot.displayName}
      submitLabel={assigning ? "ثبت شماره پرسنلی" : "ثبت اصلاح"}
      action={setPersonnelNumberAction}
      onClose={close}
      onSuccess={success}
    >
      {(state) => (
        <>
          <input type="hidden" name="userId" value={snapshot.id} />
          <input
            type="hidden"
            name="expectedPersonnelNumber"
            value={snapshot.personnelNumber ?? ""}
          />
          <ManagementInput
            name="personnelNumber"
            label="شماره پرسنلی"
            value={value}
            onChange={setValue}
            error={state.fields?.personnelNumber}
            hint="فقط رقم (۱ تا ۲۰ رقم)؛ صفرهای ابتدایی حفظ می‌شوند. ارقام فارسی پذیرفته می‌شوند."
            maxLength={40}
            dir="ltr"
            inputMode="numeric"
            autoComplete="off"
          />
          <Callout icon={IdCard} tone="attention">
            {assigning
              ? "شماره پرسنلی واقعی این فرد را از سوابق رسمی وارد کنید. پس از ثبت، شماره پرسنلی پاک نمی‌شود و فقط قابل اصلاح است."
              : "شماره قبلی بلافاصله برای ورود کار نمی‌کند و کاربر باید با شماره جدید وارد شود. مقدار قبلی و جدید در سابقه ممیزی ثبت می‌شود؛ شناسه داخلی و سوابق کاربر تغییری نمی‌کنند."}
          </Callout>
        </>
      )}
    </MutationDialog>
  );
}

function TemporaryPasswordDialog({
  user,
  close,
  success,
}: {
  user: Identity;
  close: () => void;
  success: (message: string, password?: string) => void;
}) {
  const [snapshot] = useState(user);
  return (
    <MutationDialog
      title={snapshot.hasCredentials ? "بازنشانی با رمز موقت" : "ساخت رمز موقت"}
      description={snapshot.displayName}
      submitLabel="ساخت رمز موقت"
      action={issueTemporaryPasswordAction}
      onClose={close}
      onSuccess={(message, state) => success(message, state.temporaryPassword)}
      destructive={snapshot.hasCredentials}
    >
      {() => (
        <>
          <input type="hidden" name="userId" value={snapshot.id} />
          <input
            type="hidden"
            name="expectedHasCredentials"
            value={String(snapshot.hasCredentials)}
          />
          <Callout
            icon={KeyRound}
            tone={snapshot.hasCredentials ? "attention" : "info"}
          >
            {snapshot.hasCredentials
              ? "رمز فعلی کاربر از کار می‌افتد و همه نشست‌های باز او بسته می‌شوند. "
              : ""}
            یک رمز تصادفی امن ساخته و فقط یک بار به شما نمایش داده می‌شود. کاربر
            در اولین ورود باید رمز خود را انتخاب کند. وضعیت حساب و عضویت‌ها
            تغییر نمی‌کنند.
          </Callout>
        </>
      )}
    </MutationDialog>
  );
}

export function IdentityControls({
  user,
  actorId,
}: {
  user: Identity;
  actorId: string;
}) {
  const [dialog, setDialog] = useState<"number" | "password" | null>(null);
  const [message, setMessage] = useState("");
  const [password, setPassword] = useState<string | null>(null);
  const self = user.id === actorId;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => setDialog("number")}
          aria-haspopup="dialog"
        >
          {user.personnelNumber === null
            ? "ثبت شماره پرسنلی"
            : "اصلاح شماره پرسنلی"}
        </Button>
        {!self && user.isActive && (
          <Button
            variant="outline"
            onClick={() => setDialog("password")}
            aria-haspopup="dialog"
          >
            {user.hasCredentials ? "بازنشانی با رمز موقت" : "ساخت رمز موقت"}
          </Button>
        )}
      </div>
      {message && (
        <p role="status" className="text-sm text-muted-foreground">
          {message}
        </p>
      )}
      {password && (
        <OneTimePassword password={password} onDone={() => setPassword(null)} />
      )}
      {dialog === "number" && (
        <PersonnelNumberDialog
          user={user}
          close={() => setDialog(null)}
          success={setMessage}
        />
      )}
      {dialog === "password" && (
        <TemporaryPasswordDialog
          user={user}
          close={() => setDialog(null)}
          success={(next, issued) => {
            setMessage(next);
            setPassword(issued ?? null);
          }}
        />
      )}
    </div>
  );
}
