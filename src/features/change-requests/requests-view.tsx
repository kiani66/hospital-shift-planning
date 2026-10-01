import {
  ArrowLeftRight,
  CalendarClock,
  Inbox,
  ListChecks,
  TriangleAlert,
} from "lucide-react";

import type {
  ChangeRequestOptions,
  MyChangeRequestItem,
} from "@/application/change-requests/queries";
import { Badge } from "@/components/ui/badge";
import { Callout } from "@/components/ui/callout";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/ui/section-header";
import {
  faNumber,
  formatJalaliDate,
  formatJalaliDateTime,
  formatJalaliRange,
} from "@/features/calendar/jalali";
import { ShiftChip } from "@/features/shifts/shift-chip";
import { APP_TIMEZONE } from "@/infrastructure/auth/actor";

import {
  cancelChangeRequestAction,
  refreshSwapAction,
  respondToSwapAction,
} from "./actions";
import { NewRequestDialog } from "./new-request-dialog";
import {
  CONSENT_STATUS,
  REJECTION_LABELS,
  REQUEST_STATUS,
  REQUEST_TYPE_LABELS,
  requestSummary,
} from "./presentation";
import { RequestActionButton } from "./request-action-button";

/**
 * The nurse's requests page (Phase 9): swap requests waiting for their
 * answer, their upcoming shifts (each one a starting point for a new
 * request), and their own requests with status and outcome. Requests never
 * change the schedule themselves; the page says so where it matters.
 */
export function RequestsView({
  options,
  requests,
}: {
  options: ChangeRequestOptions;
  requests: readonly MyChangeRequestItem[];
}) {
  const toAnswer = requests.filter(
    (r) => r.role === "COUNTERPART" && r.status === "PENDING",
  );
  const mine = requests.filter((r) => r.role === "REQUESTER");
  const answered = requests.filter(
    (r) => r.role === "COUNTERPART" && r.status !== "PENDING",
  );

  return (
    <div className="flex flex-col gap-10">
      {toAnswer.length > 0 && (
        <section aria-labelledby="swap-inbox" className="flex flex-col gap-4">
          <SectionHeader
            id="swap-inbox"
            title="درخواست‌های جابه‌جایی منتظر پاسخ شما"
            icon={<ArrowLeftRight className="size-4" />}
            tone="attention"
            meta={`${faNumber(toAnswer.length)} مورد`}
          />
          <ul className="flex flex-col gap-3">
            {toAnswer.map((r) => (
              <li key={r.id}>
                <RequestCard request={r} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section
        aria-labelledby="upcoming-shifts"
        className="flex flex-col gap-4"
      >
        <SectionHeader
          id="upcoming-shifts"
          title="شیفت‌های پیش رو"
          icon={<CalendarClock className="size-4" />}
        />
        <p className="text-sm leading-relaxed text-muted-foreground">
          پس از نهایی شدن برنامه، ترجیحات بسته می‌شود. اگر در شیفتی نیاز به
          تغییر دارید، برای همان روز درخواست ثبت کنید؛ سرپرستار آن را بررسی
          می‌کند.
        </p>
        {options.schedules.length === 0 ? (
          <EmptyState
            icon={<CalendarClock className="size-6" />}
            title="فعلاً شیفتی برای درخواست تغییر نیست"
            headingLevel={3}
            description="درخواست تغییر فقط برای شیفت‌های آینده در برنامه‌های نهایی‌شده ممکن است."
          />
        ) : (
          options.schedules.map((s) => (
            <section
              key={s.scheduleId}
              aria-label={s.label}
              className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-xs"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-semibold">{s.label}</h3>
                <span className="text-sm text-muted-foreground">
                  {s.departmentName} ·{" "}
                  {formatJalaliRange(s.period.start, s.period.end)}
                </span>
              </div>
              {s.assignments.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  در این برنامه شیفت آینده‌ای ندارید.
                </p>
              ) : (
                <ul className="divide-y">
                  {s.assignments.map((a) => {
                    const dateLabel = formatJalaliDate(a.date, {
                      weekday: true,
                    });
                    return (
                      <li
                        key={a.date}
                        aria-label={dateLabel}
                        className="flex flex-wrap items-center justify-between gap-3 py-3"
                      >
                        <span className="flex items-center gap-3">
                          <ShiftChip code={a.shift} size="sm" label />
                          <span className="text-sm font-medium">
                            {dateLabel}
                          </span>
                        </span>
                        {a.hasActiveRequest ? (
                          <Badge tone="review" size="sm">
                            درخواست در جریان
                          </Badge>
                        ) : (
                          <NewRequestDialog
                            scheduleId={s.scheduleId}
                            date={a.date}
                            dateLabel={dateLabel}
                            shift={a.shift}
                            reasons={options.reasons}
                            swapCandidates={s.swapCandidates[a.date] ?? []}
                          />
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          ))
        )}
      </section>

      <section aria-labelledby="my-requests" className="flex flex-col gap-4">
        <SectionHeader
          id="my-requests"
          title="درخواست‌های من"
          icon={<ListChecks className="size-4" />}
          meta={
            mine.length > 0 ? `${faNumber(mine.length)} درخواست` : undefined
          }
        />
        {mine.length === 0 ? (
          <EmptyState
            icon={<Inbox className="size-6" />}
            title="هنوز درخواستی ثبت نکرده‌اید"
            headingLevel={3}
            description="درخواست‌های شما و نتیجه بررسی آن‌ها اینجا نمایش داده می‌شود."
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {mine.map((r) => (
              <li key={r.id}>
                <RequestCard request={r} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {answered.length > 0 && (
        <section
          aria-labelledby="answered-swaps"
          className="flex flex-col gap-4"
        >
          <SectionHeader
            id="answered-swaps"
            title="جابه‌جایی‌هایی که در آن‌ها نام شما آمده"
            icon={<ArrowLeftRight className="size-4" />}
            tone="muted"
          />
          <ul className="flex flex-col gap-3">
            {answered.map((r) => (
              <li key={r.id}>
                <RequestCard request={r} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function RequestCard({ request: r }: { request: MyChangeRequestItem }) {
  const status = REQUEST_STATUS[r.status];
  const title = `${REQUEST_TYPE_LABELS[r.type]} · ${formatJalaliDate(r.date, { weekday: true })}`;
  const headingId = `request-${r.id}`;
  const showConsent = r.type === "SWAP" && r.consent && r.status === "PENDING";

  return (
    <article
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-xs"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 id={headingId} className="font-semibold">
          {title}
        </h3>
        <div className="flex flex-wrap gap-1.5">
          <Badge tone={status.tone}>{status.label}</Badge>
          {showConsent && (
            <Badge tone={CONSENT_STATUS[r.consent!].tone}>
              {CONSENT_STATUS[r.consent!].label}
            </Badge>
          )}
        </div>
      </div>

      <p className="text-sm leading-relaxed">{requestSummary(r)}</p>

      <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="text-muted-foreground">برنامه</dt>
        <dd>
          {r.scheduleLabel} · {r.departmentName}
        </dd>
        <dt className="text-muted-foreground">شیفت</dt>
        <dd className="flex flex-wrap items-center gap-1.5">
          <ShiftChip code={r.requesterShift} size="xs" label />
          {r.targetShift && (
            <>
              <span aria-hidden="true">←</span>
              <span className="sr-only">به</span>
              <ShiftChip code={r.targetShift} size="xs" label />
            </>
          )}
        </dd>
        <dt className="text-muted-foreground">علت</dt>
        <dd>{r.reason.label}</dd>
        {r.note && (
          <>
            <dt className="text-muted-foreground">توضیح</dt>
            <dd className="whitespace-pre-line" dir="auto">
              {r.note}
            </dd>
          </>
        )}
        <dt className="text-muted-foreground">ثبت</dt>
        <dd>{formatJalaliDateTime(r.createdAt, APP_TIMEZONE)}</dd>
      </dl>

      {r.status === "REJECTED" && r.rejection && (
        <Callout tone="muted" icon={TriangleAlert} as="div">
          <p>{REJECTION_LABELS[r.rejection]}</p>
          {r.rejectionNote && (
            <p className="mt-1 whitespace-pre-line" dir="auto">
              توضیح: {r.rejectionNote}
            </p>
          )}
        </Callout>
      )}
      {r.status === "APPLIED" && (
        <Callout tone="success" icon={ListChecks}>
          سرپرستار این تغییر را در برنامه اعمال کرد
          {r.appliedAt
            ? ` (${formatJalaliDateTime(r.appliedAt, APP_TIMEZONE)})`
            : ""}
          .
        </Callout>
      )}
      {r.status === "PENDING" && r.swapContextChanged && (
        <Callout tone="attention" icon={TriangleAlert}>
          {r.role === "REQUESTER"
            ? "شیفت شما یا همکار در این روز تغییر کرده است. برای ادامه، درخواست را با شیفت‌های فعلی به‌روز کنید؛ همکار باید دوباره موافقت کند."
            : "شیفت یکی از شما در این روز تغییر کرده است؛ تا درخواست‌دهنده آن را به‌روز نکند، امکان موافقت نیست."}
        </Callout>
      )}

      {(r.canCancel || r.canRespond || r.canRefresh) && (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {r.canRespond && !r.swapContextChanged && (
            <RequestActionButton
              action={respondToSwapAction}
              requestId={r.id}
              answer="accept"
              icon="accept"
              variant="default"
              triggerLabel="موافقت با جابه‌جایی"
              title="موافقت با جابه‌جایی"
              description={`${requestSummary(r)} با موافقت شما، درخواست برای سرپرستار قابل بررسی می‌شود؛ تا او اعمالش نکند، برنامه تغییری نمی‌کند.`}
              confirmLabel="بله، موافقم"
            />
          )}
          {r.canRespond && (
            <RequestActionButton
              action={respondToSwapAction}
              requestId={r.id}
              answer="decline"
              icon="decline"
              destructive
              triggerLabel="مخالفت"
              title="مخالفت با جابه‌جایی"
              description="با مخالفت شما، این درخواست بسته می‌شود و به درخواست‌دهنده اطلاع داده می‌شود."
              confirmLabel="بله، مخالفم"
            />
          )}
          {r.canRefresh && (
            <RequestActionButton
              action={refreshSwapAction}
              requestId={r.id}
              icon="refresh"
              variant="default"
              triggerLabel="به‌روزرسانی با شیفت‌های فعلی"
              title="به‌روزرسانی درخواست جابه‌جایی"
              description="درخواست با شیفت‌های فعلی شما و همکار به‌روز می‌شود و موافقت قبلی همکار دیگر معتبر نیست؛ دوباره از او موافقت خواسته می‌شود."
              confirmLabel="به‌روزرسانی"
            />
          )}
          {r.canCancel && (
            <RequestActionButton
              action={cancelChangeRequestAction}
              requestId={r.id}
              icon="cancel"
              destructive
              triggerLabel="لغو درخواست"
              title="لغو درخواست"
              description={`درخواست «${title}» لغو می‌شود و در سابقه شما می‌ماند. برای درخواست دوباره، یک درخواست جدید ثبت کنید.`}
              confirmLabel="بله، لغو شود"
            />
          )}
        </div>
      )}
    </article>
  );
}
