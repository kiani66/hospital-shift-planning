"use client";

import { useId, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import type { ManagementFormState } from "./mutation-result";

export const MANAGEMENT_SELECT =
  "min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none aria-invalid:border-destructive";

export function ManagementInput({
  name,
  label,
  value,
  onChange,
  error,
  hint,
  type = "text",
  maxLength,
  dir,
  autoComplete,
}: {
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  type?: "text" | "email";
  maxLength?: number;
  dir?: "ltr";
  autoComplete?: string;
}) {
  const id = useId();
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={name}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        maxLength={maxLength}
        dir={dir}
        autoComplete={autoComplete}
        aria-invalid={!!error}
        aria-describedby={error || hint ? `${id}-help` : undefined}
      />
      {(error || hint) && (
        <p
          id={`${id}-help`}
          className={
            error ? "text-sm text-destructive" : "text-xs text-muted-foreground"
          }
        >
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

export function ManagementSelect({
  name,
  label,
  value,
  onChange,
  error,
  children,
}: {
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        name={name}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={MANAGEMENT_SELECT}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
      >
        {children}
      </select>
      {error && (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export function FormFeedback({
  state,
  review,
}: {
  state: ManagementFormState;
  review?: () => void;
}) {
  const router = useRouter();
  if (state.status !== "error") return null;
  return (
    <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
      <p role="alert" className="text-sm leading-relaxed text-destructive">
        {state.message}
      </p>
      <Button
        variant="outline"
        onClick={() => {
          review?.();
          router.refresh();
        }}
      >
        بازخوانی اطلاعات
      </Button>
    </div>
  );
}
