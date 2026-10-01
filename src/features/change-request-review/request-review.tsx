import { Ban, History, TriangleAlert } from "lucide-react";

import type { ChangeRequestReview } from "@/application/change-requests/queries";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { SHIFT_CODES, type ShiftCode } from "@/domain/shifts/shift-type";
import {
  faNumber,
  formatJalaliDate,
  formatJalaliDateTime,
} from "@/features/calendar/jalali";
import {
  APPLIED_STATE,
  CONSENT_STATUS,
  fieldMessages,
  REJECTION_LABELS,
  REQUEST_STATUS,
  REQUEST_TYPE_LABELS,
  requestErrorMessage,
  requestSummary,
} from "@/features/change-requests/presentation";
import { SCHEDULE_STATUS_LABELS } from "@/features/schedule/labels";
import { dayList } from "@/features/schedule-workflow/presentation";
import { SHIFT_PRESENTATION } from "@/features/shifts/catalog";
import { ShiftChip } from "@/features/shifts/shift-chip";
import { APP_TIMEZONE } from "@/infrastructure/auth/actor";

import { ApplyRequestButton, RejectRequestButton } from "./decision-buttons";
import { PreviewPanel } from "./preview-panel";

const Shift = ({ code }: { code: ShiftCode | null }) =>
  code ? (
    <ShiftChip code={code} size="xs" label />
  ) : (
    <span className="text-muted-foreground">بدون شیفت</span>
  );

const shiftName = (code: ShiftCode | null) =>
  code ? `${SHIFT_PRESENTATION[code].name} (${code})` : "بدون شیفت";

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="flex flex-wrap items-center gap-1.5">{children}</dd>
    </>
  );
}

/**
 * Everything the Head Nurse needs to decide one request without leaving the
 * queue: the request as it was made (snapshot), the CURRENT live shifts, the
 * schedule's version and revision context, the stale-context state, and the
 * validated preview of applying it now. `query` keeps the queue's status in
 * the resolution form (a plain GET form: the server recomputes the preview).
 */
export function RequestReview({
  review,
  query,
}: {
  review: ChangeRequestReview;
  query: { readonly status: string; readonly requestId: string };
}) {
  const { request: r, schedule, current, stale, previewView } = review;
  const pending = r.status === "PENDING";
  const blockerId = `blocker-${r.id}`;
  const blockerText = review.blocker
    ? (Object.values(fieldMessages(review.blocker))[0] ??
      requestErrorMessage("apply", review.blocker))
    : null;
  const blocked =
    !!review.blocker || !previewView || !previewView.ok || previewView.blocked;
  const otherShift =
    r.type === "OTHER" && review.resolution.requesterShift !== undefined
      ? (review.resolution.requesterShift ?? "")
      : undefined;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:items-start">
      <div className="flex min-w-0 flex-col gap-4">
        <section
          aria-label="درخواست"
          className="flex flex-col gap-2 rounded-xl border bg-card p-4 text-sm shadow-xs"
        >
          <div className="flex flex-wrap gap-1.5">
            <Badge tone={REQUEST_STATUS[r.status].tone}>
              {REQUEST_STATUS[r.status].label}
            </Badge>
            {r.consent && (
              <Badge tone={CONSENT_STATUS[r.consent].tone}>
                {CONSENT_STATUS[r.consent].label}
              </Badge>
            )}
          </div>
          <p className="leading-relaxed">{requestSummary(r)}</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
            <Row label="پرستار">{r.requester.displayName}</Row>
            <Row label="روز">{formatJalaliDate(r.date, { weekday: true })}</Row>
            <Row label="نوع">{REQUEST_TYPE_LABELS[r.type]}</Row>
            <Row label="شیفت هنگام درخواست">
              <Shift code={r.requesterShift} />
            </Row>
            {r.targetShift && (
              <Row label="شیفت درخواستی">
                <Shift code={r.targetShift} />
              </Row>
            )}
            {r.counterpart && (
              <Row label="همکار جابه‌جایی">
                {r.counterpart.displayName} ·{" "}
                <Shift code={r.counterpartShift} />
              </Row>
            )}
            <Row label="علت">{r.reason.label}</Row>
            {r.note && (
              <Row label="توضیح">
                <span className="whitespace-pre-line" dir="auto">
                  {r.note}
                </span>
              </Row>
            )}
            <Row label="ثبت">
              {formatJalaliDateTime(r.createdAt, APP_TIMEZONE)}
            </Row>
            {r.consentAt && (
              <Row label="پاسخ همکار">
                {formatJalaliDateTime(r.consentAt, APP_TIMEZONE)}
              </Row>
            )}
          </dl>
        </section>

        <section
          aria-label="وضعیت فعلی"
          className="flex flex-col gap-2 rounded-xl border bg-card p-4 text-sm shadow-xs"
        >
          <p className="font-medium">وضعیت فعلی برنامه</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
            <Row label={`شیفت فعلی ${r.requester.displayName}`}>
              <Shift code={current.requester} />
            </Row>
            {r.counterpart && (
              <Row label={`شیفت فعلی ${r.counterpart.displayName}`}>
                <Shift code={current.counterpart} />
              </Row>
            )}
            <Row label="برنامه">
              {schedule.label} · {SCHEDULE_STATUS_LABELS[schedule.status]}
            </Row>
            <Row label="نسخه اجرایی">
              {schedule.currentVersionNo
                ? `نسخه ${faNumber(schedule.currentVersionNo)} (آخرین نسخه تأییدشده)`
                : "هنوز نسخه تأییدشده‌ای نیست"}
            </Row>
            {schedule.openRevisionDates && (
              <Row label="بازنگری باز">
                {dayList(schedule.openRevisionDates)}
              </Row>
            )}
          </dl>
        </section>
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        {r.status === "APPLIED" && review.appliedChange && (
          <Callout
            tone={
              review.appliedChange.state === "DISCARDED" ? "attention" : "muted"
            }
            icon={History}
            as="div"
          >
            <p className="font-medium">
              اعمال‌شده توسط {r.appliedBy?.displayName}
              {r.appliedAt
                ? ` (${formatJalaliDateTime(r.appliedAt, APP_TIMEZONE)})`
                : ""}{" "}
              · {APPLIED_STATE[review.appliedChange.state].label}
            </p>
            <p className="mt-1">
              {APPLIED_STATE[review.appliedChange.state].description}
            </p>
            <ul className="mt-2 flex flex-col gap-1">
              {review.appliedChange.cells.map((c) => (
                <li
                  key={`${c.nurseId}-${c.date}`}
                  className="flex flex-wrap items-center gap-1.5"
                >
                  {c.displayName}: <Shift code={c.before} />{" "}
                  <span aria-hidden="true">←</span>
                  <span className="sr-only">به</span> <Shift code={c.after} />
                </li>
              ))}
            </ul>
          </Callout>
        )}
        {r.status === "REJECTED" && r.rejection && (
          <Callout tone="muted" icon={Ban} as="div">
            <p>{REJECTION_LABELS[r.rejection]}</p>
            {r.rejectionNote && (
              <p className="mt-1 whitespace-pre-line" dir="auto">
                توضیح: {r.rejectionNote}
              </p>
            )}
          </Callout>
        )}

        {pending && stale && (
          <Callout tone="attention" icon={TriangleAlert} role="note">
            شیفت {r.requester.displayName} پس از ثبت درخواست تغییر کرده است:
            درخواست برای {shiftName(stale.requestedAgainst)} ثبت شده، شیفت فعلی{" "}
            {shiftName(stale.current)} است. پیش‌نمایش و اعمال بر اساس شیفت فعلی
            است.
          </Callout>
        )}
        {pending && review.swapContextChanged && (
          <Callout tone="attention" icon={Ban} role="note">
            شیفت یکی از دو نفر پس از درخواست یا موافقت تغییر کرده است. تا
            درخواست‌دهنده درخواست را به‌روز نکند و همکار دوباره موافقت نکند،
            جابه‌جایی قابل اعمال نیست.
          </Callout>
        )}

        {pending && (r.type === "UNAVAILABLE" || r.type === "OTHER") && (
          <form
            method="get"
            className="flex flex-col gap-2 rounded-xl border bg-card p-4 text-sm shadow-xs"
          >
            <input type="hidden" name="status" value={query.status} />
            <input type="hidden" name="request" value={query.requestId} />
            {r.type === "UNAVAILABLE" ? (
              <>
                <label htmlFor="replacement" className="font-medium">
                  جانشین (اختیاری)
                </label>
                <select
                  id="replacement"
                  name="replacement"
                  defaultValue={review.resolution.replacementNurseId ?? ""}
                  className="min-h-11 rounded-md border border-input bg-background px-3"
                >
                  <option value="">بدون جانشین</option>
                  {review.replacementCandidates.map((p) => (
                    <option key={p.userId} value={p.userId}>
                      {p.displayName}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  جانشین، شیفت فعلی {r.requester.displayName} را در این روز
                  می‌گیرد.
                </p>
              </>
            ) : (
              <>
                <label htmlFor="resulting-shift" className="font-medium">
                  شیفت نهایی {r.requester.displayName}
                </label>
                <select
                  id="resulting-shift"
                  name="shift"
                  defaultValue={
                    otherShift === undefined ? "" : otherShift || "OFF"
                  }
                  className="min-h-11 rounded-md border border-input bg-background px-3"
                >
                  <option value="" disabled>
                    انتخاب کنید
                  </option>
                  {SHIFT_CODES.map((code) => (
                    <option key={code} value={code}>
                      {shiftName(code)}
                    </option>
                  ))}
                  <option value="OFF">بدون شیفت</option>
                </select>
              </>
            )}
            <button
              type="submit"
              className={buttonClasses("secondary", "self-start")}
            >
              بررسی دوباره
            </button>
          </form>
        )}

        {pending && blockerText && (
          <Callout tone="attention" icon={Ban} id={blockerId} role="status">
            {blockerText}
          </Callout>
        )}
        {pending && previewView && !previewView.ok && (
          <Callout tone="attention" icon={Ban} id={blockerId} role="status">
            {requestErrorMessage("apply", previewView.error)}
          </Callout>
        )}
        {pending && previewView?.ok && <PreviewPanel preview={previewView} />}

        {pending && (
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <ApplyRequestButton
              requestId={r.id}
              revision={schedule.revision}
              replacementNurseId={review.resolution.replacementNurseId ?? null}
              requesterShift={otherShift}
              stale={
                stale
                  ? `می‌دانم شیفت فعلی ${shiftName(stale.current)} است و درخواست بر اساس شیفت فعلی اعمال می‌شود.`
                  : null
              }
              disabled={blocked}
              describedBy={blocked ? blockerId : undefined}
              consequence={
                previewView?.ok
                  ? `${requestSummary(r)} ${
                      previewView.warnings.length > 0
                        ? `${faNumber(previewView.warnings.length)} هشدار وجود دارد که مانع اعمال نیست. `
                        : ""
                    }به پرستار اطلاع داده می‌شود.`
                  : requestSummary(r)
              }
            />
            <RejectRequestButton requestId={r.id} />
          </div>
        )}
      </div>
    </div>
  );
}
