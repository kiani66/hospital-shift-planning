"use client";

import { useRouter } from "next/navigation";
import { useActionState, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { createAccountAction } from "./actions";
import { FormFeedback, ManagementInput } from "./form-fields";
import type { ManagementFormState } from "./mutation-result";

export function CreateAccountForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const password = useRef<HTMLInputElement>(null);
  const passwordId = useId();
  const [state, formAction, pending] = useActionState(
    async (previous: ManagementFormState, form: FormData) => {
      // React already captured FormData. Clear the secret immediately; never keep/echo it in state.
      if (password.current) password.current.value = "";
      const next = await createAccountAction(previous, form);
      if (next.status === "success" && next.userId)
        router.push(`/admin/personnel/${next.userId}`);
      return next;
    },
    { status: "idle" },
  );
  return (
    <form
      action={formAction}
      noValidate
      aria-label="ایجاد حساب کاربر"
      className="max-w-xl space-y-5 rounded-xl border bg-card p-5"
    >
      <fieldset disabled={pending} className="space-y-4">
        <ManagementInput
          name="displayName"
          label="نام نمایشی"
          value={name}
          onChange={setName}
          maxLength={200}
          error={state.fields?.displayName}
          autoComplete="off"
        />
        <ManagementInput
          name="email"
          label="ایمیل / شناسه ورود"
          type="email"
          dir="ltr"
          value={email}
          onChange={setEmail}
          maxLength={320}
          error={state.fields?.email}
          autoComplete="off"
        />
        <div className="space-y-2">
          <Label htmlFor={passwordId}>رمز عبور اولیه</Label>
          <Input
            ref={password}
            id={passwordId}
            name="password"
            type="password"
            dir="ltr"
            autoComplete="new-password"
            maxLength={256}
            aria-invalid={!!state.fields?.password}
            aria-describedby={`${passwordId}-help`}
          />
          <p
            id={`${passwordId}-help`}
            className={
              state.fields?.password
                ? "text-sm text-destructive"
                : "text-xs text-muted-foreground"
            }
          >
            {state.fields?.password ??
              "حداقل ۱۲ و حداکثر ۲۵۶ نویسه؛ پس از ارسال نمایش داده نمی‌شود."}
          </p>
        </div>
      </fieldset>
      <FormFeedback state={state} />
      <Button type="submit" disabled={pending}>
        {pending ? "در حال ایجاد…" : "ایجاد حساب"}
      </Button>
    </form>
  );
}
