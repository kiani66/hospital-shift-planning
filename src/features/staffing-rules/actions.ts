"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import {
  createRuleSetDraft,
  discardRuleSetDraft,
  publishRuleSetVersion,
  retireRuleSetVersion,
  updateRuleSetDraft,
} from "@/application/staffing-rules/commands";
import { applyRuleSetToSchedule } from "@/application/staffing-rules/apply";
import {
  previewRuleSetPublication,
  type PublishPreview,
} from "@/application/staffing-rules/queries";
import type { ActionResult } from "@/application/result";
import { requireRequestContext } from "@/features/auth/guards";
import { parseJalaliInput } from "@/features/calendar/jalali-input";
import { APP_TIMEZONE, todayIn } from "@/infrastructure/auth/actor";

import {
  applyErrorMessage,
  parseContentForm,
  ruleSetErrorMessage,
} from "./presentation";

/**
 * Thin adapters for Hospital Admin rule-set management: parse the form,
 * load the trusted actor, call the command. Authorization, lifecycle and
 * concurrency live in the commands (D108).
 */

export interface RuleSetFormState {
  readonly status: "idle" | "success" | "error";
  readonly message?: string;
  /** The publication check (conflicts) of a draft, when asked for. */
  readonly preview?: PublishPreview;
  readonly at?: number;
}

const failure = (message: string): RuleSetFormState => ({
  status: "error",
  message,
  at: Date.now(),
});

function respond(
  result: ActionResult<unknown>,
  success: string,
): RuleSetFormState {
  if (!result.ok) return failure(ruleSetErrorMessage(result.error));
  refresh();
  return { status: "success", message: success, at: Date.now() };
}

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
};

const ids = z.object({
  versionId: z.uuid(),
  expectedRevision: z.coerce.number().int().nonnegative(),
});

export async function createDraftAction(
  _previous: RuleSetFormState,
  form: FormData,
): Promise<RuleSetFormState> {
  const ctx = await requireRequestContext();
  const departmentId = text(form, "departmentId") || null;
  const basedOnVersionId = text(form, "basedOnVersionId") || null;
  return respond(
    await createRuleSetDraft(ctx, { departmentId, basedOnVersionId }),
    "پیش‌نویس تازه ساخته شد.",
  );
}

export async function updateDraftAction(
  _previous: RuleSetFormState,
  form: FormData,
): Promise<RuleSetFormState> {
  const parsed = ids.safeParse({
    versionId: text(form, "versionId"),
    expectedRevision: text(form, "expectedRevision"),
  });
  if (!parsed.success) return failure("اطلاعات فرم معتبر نیست.");
  const content = parseContentForm(form);
  if (!content.ok) return failure(content.message);
  const ctx = await requireRequestContext();
  return respond(
    await updateRuleSetDraft(ctx, {
      ...parsed.data,
      content: content.value,
      note: text(form, "note") || null,
    }),
    "پیش‌نویس ذخیره شد.",
  );
}

export async function discardDraftAction(
  _previous: RuleSetFormState,
  form: FormData,
): Promise<RuleSetFormState> {
  const parsed = ids.safeParse({
    versionId: text(form, "versionId"),
    expectedRevision: text(form, "expectedRevision"),
  });
  if (!parsed.success) return failure("اطلاعات فرم معتبر نیست.");
  const ctx = await requireRequestContext();
  return respond(
    await discardRuleSetDraft(ctx, parsed.data),
    "پیش‌نویس حذف شد.",
  );
}

/** "now" is today (Tehran); otherwise the Jalali date typed by the admin. */
function effectiveFrom(form: FormData): string | null {
  if (text(form, "mode") === "now") return todayIn(APP_TIMEZONE);
  return parseJalaliInput(text(form, "effectiveFrom"));
}

/** Checks what publishing would replace, without writing anything (K). */
export async function previewPublishAction(
  _previous: RuleSetFormState,
  form: FormData,
): Promise<RuleSetFormState> {
  const date = effectiveFrom(form);
  if (!date) return failure("تاریخ اجرا را به شکل ۱۴۰۵/۰۸/۰۱ وارد کنید.");
  const ctx = await requireRequestContext();
  try {
    const preview = await previewRuleSetPublication(ctx, {
      versionId: text(form, "versionId"),
      effectiveFrom: date,
    });
    if (preview.inPast)
      return failure("تاریخ اجرا نمی‌تواند پیش از امروز باشد.");
    return { status: "idle", preview, at: Date.now() };
  } catch {
    return failure(
      "بررسی انتشار ممکن نشد. صفحه را تازه کنید و دوباره تلاش کنید.",
    );
  }
}

export async function publishAction(
  _previous: RuleSetFormState,
  form: FormData,
): Promise<RuleSetFormState> {
  const parsed = ids.safeParse({
    versionId: text(form, "versionId"),
    expectedRevision: text(form, "expectedRevision"),
  });
  const date = effectiveFrom(form);
  if (!parsed.success || !date)
    return failure("تاریخ اجرا را به شکل ۱۴۰۵/۰۸/۰۱ وارد کنید.");
  const ctx = await requireRequestContext();
  const confirmReplaceVersionIds = form
    .getAll("confirmReplace")
    .filter((v): v is string => typeof v === "string");
  return respond(
    await publishRuleSetVersion(ctx, {
      ...parsed.data,
      effectiveFrom: date,
      confirmReplaceVersionIds,
    }),
    "نسخه منتشر شد. برنامه‌های موجود همچنان به نسخه قبلی خود متصل‌اند.",
  );
}

export async function retireAction(
  _previous: RuleSetFormState,
  form: FormData,
): Promise<RuleSetFormState> {
  const versionId = text(form, "versionId");
  const ctx = await requireRequestContext();
  return respond(
    await retireRuleSetVersion(ctx, {
      versionId,
      note: text(form, "note") || null,
    }),
    "نسخه کنار گذاشته شد. برنامه‌های متصل به آن تغییری نمی‌کنند.",
  );
}

const applyForm = z.object({
  scheduleId: z.uuid(),
  expectedRevision: z.coerce.number().int().nonnegative(),
  fromVersionId: z.uuid(),
  toVersionId: z.uuid(),
  /** Only used to return to the page; never trusted for authorization. */
  departmentCode: z.string().regex(/^[a-z0-9-]{1,64}$/),
});

/**
 * Applies the previewed version (D107): only with the explicit confirmation
 * box ticked; the command re-checks the revision and pin it was shown.
 */
export async function applyRuleSetAction(
  _previous: RuleSetFormState,
  form: FormData,
): Promise<RuleSetFormState> {
  const parsed = applyForm.safeParse(Object.fromEntries(form));
  if (!parsed.success) return failure("اطلاعات فرم معتبر نیست.");
  if (form.get("confirm") !== "on")
    return failure("برای اعمال، تأیید پیش‌نمایش را علامت بزنید.");
  const { departmentCode, ...input } = parsed.data;
  const ctx = await requireRequestContext();
  const result = await applyRuleSetToSchedule(ctx, { ...input, confirm: true });
  if (!result.ok) return failure(applyErrorMessage(result.error));
  redirect(
    `/departments/${departmentCode}/coverage-rules?applied=${input.scheduleId}`,
  );
}
