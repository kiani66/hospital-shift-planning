"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { issueInitialTemporaryPasswords } from "@/application/management/credentials";
import {
  commitPersonnelImport,
  previewPersonnelImport,
  type ImportOutcome,
} from "@/application/personnel-import/import";
import {
  decodeImportFile,
  IMPORT_LIMITS,
} from "@/application/personnel-import/rows";
import { ApplicationError } from "@/application/errors";
import type {
  ImportAction,
  ImportField,
  ImportRowError,
} from "@/domain/management/personnel-import";
import { DomainError } from "@/domain/shared/errors";
import { requireRequestContext } from "@/features/auth/guards";
import { parseJalaliInput } from "@/features/calendar/jalali-input";

import { IMPORT_FILE_ERRORS } from "./presentation";

export interface PreviewRow {
  readonly line: number;
  readonly action: ImportAction;
  readonly errors: readonly ImportRowError[];
  readonly conflicts: readonly ImportField[];
  /** Normalized values when valid, else the cells as written. */
  readonly values: Partial<Record<ImportField, string>>;
}

export interface CommitPayload {
  readonly departmentId: string;
  readonly startedOn: string;
  readonly expectedFingerprint: string;
  readonly rows: readonly {
    line: number;
    personnelNumber: string;
    displayName: string;
    email: string | null;
    mobile: string | null;
    role: string;
  }[];
}

export type PreviewState =
  | { readonly status: "idle" }
  | { readonly status: "error"; readonly message: string; readonly at: number }
  | {
      readonly status: "preview";
      readonly department: { id: string; name: string };
      readonly startedOn: string;
      readonly counts: Readonly<Record<ImportAction, number>>;
      readonly committable: boolean;
      readonly hasChanges: boolean;
      readonly rows: readonly PreviewRow[];
      readonly ignoredColumns: readonly string[];
      /** Re-validated in full by the server on commit; never trusted as is. */
      readonly payload: CommitPayload;
      readonly at: number;
    };

const FAILED = "بررسی فایل ممکن نشد. دوباره تلاش کنید.";

function errorMessage(error: unknown): string {
  if (error instanceof DomainError && error.code === "FORBIDDEN")
    return "اجازه این عملیات را ندارید. ورود گروهی فقط برای مدیر فعال بیمارستان است.";
  if (error instanceof ApplicationError && error.code === "NOT_FOUND")
    return "بخش انتخاب‌شده در دسترس یا فعال نیست.";
  if (error instanceof DomainError && error.code === "VALIDATION")
    return "بخش و تاریخ شروع عضویت را انتخاب کنید.";
  return FAILED;
}

/** Upload → full validation → per-row preview. Writes nothing. */
export async function previewImportAction(
  _previous: PreviewState,
  form: FormData,
): Promise<PreviewState> {
  const ctx = await requireRequestContext();
  const at = Date.now();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0)
    return { status: "error", message: "یک فایل CSV انتخاب کنید.", at };
  if (file.size > IMPORT_LIMITS.maxBytes)
    return { status: "error", message: IMPORT_FILE_ERRORS.TOO_LARGE, at };
  const startedOn = parseJalaliInput(form.get("startedOn"));
  if (!startedOn)
    return {
      status: "error",
      message: "تاریخ شروع عضویت را به‌صورت سال/ماه/روز شمسی وارد کنید.",
      at,
    };
  const decoded = decodeImportFile(new Uint8Array(await file.arrayBuffer()));
  if (!decoded.ok)
    return { status: "error", message: IMPORT_FILE_ERRORS[decoded.error], at };

  try {
    const preview = await previewPersonnelImport(ctx, {
      departmentId: form.get("departmentId"),
      startedOn,
      text: decoded.text,
    });
    if (!preview.ok) {
      const base =
        IMPORT_FILE_ERRORS[
          preview.fileError as keyof typeof IMPORT_FILE_ERRORS
        ] ?? FAILED;
      const fields = (preview.fields ?? []).map(
        (f) =>
          ({
            personnelNumber: "شماره پرسنلی",
            displayName: "نام و نام خانوادگی",
            email: "ایمیل",
            mobile: "موبایل",
            role: "نقش",
          })[f] ?? f,
      );
      return {
        status: "error",
        message: fields.length ? `${base} ${fields.join("، ")}` : base,
        at,
      };
    }
    const rows = preview.plan.rows.map((row, i): PreviewRow => ({
      line: row.line,
      action: row.action,
      errors: row.errors,
      conflicts: row.conflicts,
      values: row.person
        ? {
            personnelNumber: row.person.personnelNumber,
            displayName: row.person.displayName,
            email: row.person.email ?? "",
            mobile: row.person.mobile ?? "",
            role: row.person.role,
          }
        : Object.fromEntries(
            Object.entries(preview.raw[i] ?? {}).map(([k, v]) => [
              k,
              (v ?? "").slice(0, 200),
            ]),
          ),
    }));
    return {
      status: "preview",
      department: { id: preview.department.id, name: preview.department.name },
      startedOn: preview.startedOn,
      counts: preview.plan.counts,
      committable: preview.plan.committable,
      hasChanges: preview.plan.hasChanges,
      rows,
      ignoredColumns: preview.ignoredColumns,
      payload: {
        departmentId: preview.department.id,
        startedOn: preview.startedOn,
        expectedFingerprint: preview.fingerprint,
        rows: preview.plan.rows.flatMap((r) =>
          r.person ? [{ line: r.line, ...r.person }] : [],
        ),
      },
      at,
    };
  } catch (error) {
    return { status: "error", message: errorMessage(error), at };
  }
}

export type CommitState =
  | { readonly status: "idle" }
  | { readonly status: "error"; readonly message: string; readonly at: number }
  | {
      readonly status: "committed";
      readonly outcome: ImportOutcome;
      readonly at: number;
    };

const COMMIT_REASONS: Record<string, string> = {
  IMPORT_PLAN_CHANGED:
    "اطلاعات از زمان پیش‌نمایش تغییر کرده است (مثلاً همین افراد قبلاً ثبت شده‌اند). فایل را دوباره بارگذاری و بررسی کنید؛ هیچ تغییری ثبت نشد.",
  IMPORT_HAS_ERRORS:
    "برخی ردیف‌ها خطا دارند؛ هیچ تغییری ثبت نشد. فایل را اصلاح و دوباره بارگذاری کنید.",
};

const payloadSchema = z.string().max(512 * 1024);

/** Confirmed commit of the previewed plan; all or nothing. */
export async function commitImportAction(
  _previous: CommitState,
  form: FormData,
): Promise<CommitState> {
  const ctx = await requireRequestContext();
  const at = Date.now();
  if (form.get("confirm") !== "on")
    return {
      status: "error",
      message: "برای ثبت، بررسی پیش‌نمایش را تأیید کنید.",
      at,
    };
  const raw = payloadSchema.safeParse(form.get("payload"));
  let payload: unknown;
  try {
    payload = raw.success ? JSON.parse(raw.data) : null;
  } catch {
    payload = null;
  }
  const result = await commitPersonnelImport(ctx, payload);
  if (result.ok) {
    revalidatePath("/", "layout");
    return { status: "committed", outcome: result.data, at };
  }
  const { code, reason } = result.error;
  return {
    status: "error",
    message:
      (reason && COMMIT_REASONS[reason]) ??
      (code === "FORBIDDEN"
        ? "اجازه این عملیات را ندارید."
        : code === "NOT_FOUND"
          ? "بخش انتخاب‌شده در دسترس یا فعال نیست."
          : code === "CONFLICT"
            ? COMMIT_REASONS.IMPORT_PLAN_CHANGED!
            : code === "VALIDATION"
              ? "داده‌های پیش‌نمایش معتبر نیست. فایل را دوباره بارگذاری کنید."
              : "ثبت ممکن نشد و هیچ تغییری اعمال نشد. دوباره تلاش کنید."),
    at,
  };
}

export type InitialPasswordsState =
  | { readonly status: "idle" }
  | { readonly status: "error"; readonly message: string; readonly at: number }
  | {
      readonly status: "issued";
      /** Shown once; never stored or sent again. */
      readonly results: readonly {
        personnelNumber: string | null;
        displayName: string;
        status: string;
        temporaryPassword?: string;
      }[];
      readonly at: number;
    };

/** Temporary passwords for the accounts this import created (only those without any). */
export async function issueImportPasswordsAction(
  _previous: InitialPasswordsState,
  form: FormData,
): Promise<InitialPasswordsState> {
  const at = Date.now();
  const ids = form.getAll("userId").filter((v) => typeof v === "string");
  const ctx = await requireRequestContext();
  const result = await issueInitialTemporaryPasswords(ctx, { userIds: ids });
  if (!result.ok)
    return {
      status: "error",
      message:
        result.error.code === "FORBIDDEN"
          ? "اجازه این عملیات را ندارید."
          : "ساخت رمزهای موقت ممکن نشد و هیچ رمزی تغییر نکرد. دوباره تلاش کنید.",
      at,
    };
  revalidatePath("/", "layout");
  return {
    status: "issued",
    results: result.data.map((r) => ({
      personnelNumber: r.personnelNumber,
      displayName: r.displayName,
      status: r.status,
      ...(r.status === "ISSUED" && { temporaryPassword: r.temporaryPassword }),
    })),
    at,
  };
}
