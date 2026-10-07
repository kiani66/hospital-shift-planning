import {
  BadgeCheck,
  Clock,
  Info,
  Lock,
  MessageSquareWarning,
  OctagonAlert,
  Undo2,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";

import { RETURN_COMMENT_MAX_LENGTH } from "@/application/schedules/lifecycle";
import type {
  ScheduleWorkflow,
  WorkflowAction,
  WorkflowSubmission,
} from "@/application/schedules/workflow";
import { Callout } from "@/components/ui/callout";
import type { IsoDate } from "@/domain/shared/dates";
import { faNumber, formatJalaliDateTime } from "@/features/calendar/jalali";
import { ConfirmScheduleAction } from "@/features/schedule/confirm-action";
import { SCHEDULE_STATUS_LABELS } from "@/features/schedule/labels";
import { APP_TIMEZONE } from "@/infrastructure/auth/actor";

import {
  approveScheduleAction,
  finalizeScheduleAction,
  returnScheduleAction,
  submitScheduleAction,
  withdrawSubmissionAction,
  discardRevisionAction,
  startRevisionAction,
} from "./actions";
import {
  blockerLabel,
  shortJalaliDay,
  validationBlockerLines,
} from "./presentation";

/**
 * The approval workflow on the schedule pages (Phase 8). Every button here
 * comes from `ScheduleWorkflow.actions`, which the server derived from the
 * state machine and the policies; the use cases check everything again.
 * One next step at a time (progressive disclosure): the Head Nurse sees
 * finalize, submit or withdraw (never two of them), the Supervisor approve
 * and return, and only in SUBMITTED.
 */

/** Referenced by a blocked action's `aria-describedby`. */
export const WORKFLOW_BLOCKERS_ID = "workflow-blockers";

interface ScheduleRef {
  readonly scheduleId: string;
  /** The revision the page's data was read at (review.month.revision). */
  readonly revision: number;
  readonly label: string;
}

const when = (instant: Date) => formatJalaliDateTime(instant, APP_TIMEZONE);

const blocked = (action: WorkflowAction) => action.blockers.length > 0;

/** The Head Nurse's lifecycle step for the header: finalize, submit or withdraw. */
export function HeadNurseLifecycleAction({
  schedule,
  workflow,
}: {
  schedule: ScheduleRef;
  workflow: ScheduleWorkflow;
}) {
  const { finalize, submit, withdraw, discardRevision, startRevision } =
    workflow.actions;
  const common = {
    scheduleId: schedule.scheduleId,
    revision: schedule.revision,
  };
  const label = `«${schedule.label}»`;

  if (finalize)
    return (
      <ConfirmScheduleAction
        {...common}
        action={finalizeScheduleAction}
        icon="finalize"
        triggerLabel="نهایی‌سازی برنامه"
        title={`نهایی‌سازی برنامه ${label}؟`}
        description={
          <>
            برنامه از مرحله برنامه‌ریزی خارج و «
            {SCHEDULE_STATUS_LABELS.FINALIZED}» می‌شود تا برای تأیید سوپروایزر
            ارسال شود. شیفت‌ها تغییری نمی‌کنند و تا پیش از ارسال همچنان قابل
            اصلاح‌اند؛ اما بازگشت به مرحله برنامه‌ریزی ممکن نیست.
            {workflow.preferenceWindowOpen &&
              " ثبت ترجیحات باز می‌ماند؛ پیش از ارسال باید آن را ببندید."}
          </>
        }
        confirmLabel="بله، نهایی شود"
        disabled={blocked(finalize)}
        describedBy={blocked(finalize) ? WORKFLOW_BLOCKERS_ID : undefined}
      />
    );
  // An approved schedule changes only through an explicit revision (D109).
  if (startRevision)
    return (
      <ConfirmScheduleAction
        {...common}
        action={startRevisionAction}
        icon="discard"
        secondary
        triggerLabel="شروع بازنگری"
        title={`شروع بازنگری برنامه ${label}؟`}
        description="نسخه تأییدشده تغییر نمی‌کند و تا تأیید بازنگری اجرایی می‌ماند. در بازنگری می‌توانید روزهای مشخصی را اصلاح کنید و سوپروایزر یا مدیر بیمارستان می‌تواند نسخه دیگری از قوانین پوشش را اعمال کند؛ سپس برنامه دوباره برای تأیید ارسال می‌شود."
        confirmLabel="بله، بازنگری آغاز شود"
        comment={{
          label: "دلیل بازنگری",
          hint: "برای نمونه: اعمال قوانین پوشش جدید بخش.",
          maxLength: 500,
        }}
      />
    );
  // A revision of an approved schedule can also be abandoned (Phase 9).
  const discard = discardRevision && (
    <ConfirmScheduleAction
      {...common}
      action={discardRevisionAction}
      icon="discard"
      destructive
      triggerLabel="کنار گذاشتن بازنگری"
      title={`کنار گذاشتن بازنگری برنامه ${label}؟`}
      description={`همه تغییرهای این بازنگری برگردانده می‌شوند و شیفت‌ها دوباره همان آخرین نسخه تأییدشده می‌شوند، که اجرایی می‌ماند. سابقه بازنگری، تغییرها و درخواست‌های اعمال‌شده حفظ می‌شود و به پرستارانی که درخواستشان در این بازنگری اعمال شده بود اطلاع داده می‌شود.`}
      confirmLabel="بله، کنار گذاشته شود"
    />
  );
  if (submit) {
    const again = workflow.status === "RETURNED";
    return (
      <>
        <ConfirmScheduleAction
          {...common}
          action={submitScheduleAction}
          icon="submit"
          triggerLabel={again ? "ارسال دوباره برای تأیید" : "ارسال برای تأیید"}
          title={`ارسال برنامه ${label} برای تأیید؟`}
          description="برنامه برای بررسی به سوپروایزر ارسال و به او اطلاع داده می‌شود. از این لحظه تا تصمیم سوپروایزر شیفت‌ها قفل می‌شوند؛ تا پیش از اقدام او می‌توانید ارسال را پس بگیرید."
          confirmLabel="بله، ارسال شود"
          disabled={blocked(submit)}
          describedBy={blocked(submit) ? WORKFLOW_BLOCKERS_ID : undefined}
        />
        {discard}
      </>
    );
  }
  if (withdraw)
    return (
      <ConfirmScheduleAction
        {...common}
        action={withdrawSubmissionAction}
        icon="withdraw"
        secondary
        triggerLabel="پس گرفتن ارسال"
        title={`پس گرفتن ارسال برنامه ${label}؟`}
        description={`برنامه از صف بررسی سوپروایزر خارج می‌شود و به «${SCHEDULE_STATUS_LABELS.FINALIZED}» برمی‌گردد تا دوباره اصلاح و ارسال کنید. سابقه این ارسال حفظ می‌شود. اگر سوپروایزر پیش‌تر اقدام کرده باشد، پس گرفتن انجام نمی‌شود.`}
        confirmLabel="بله، پس گرفته شود"
      />
    );
  return null;
}

/** The Supervisor's decision in SUBMITTED: approve (primary) and return (with a comment). */
export function SupervisorDecisionActions({
  schedule,
  departmentName,
  workflow,
}: {
  schedule: ScheduleRef;
  departmentName: string;
  workflow: ScheduleWorkflow;
}) {
  const { approve, return: giveBack } = workflow.actions;
  if (!approve && !giveBack) return null;
  const common = {
    scheduleId: schedule.scheduleId,
    revision: schedule.revision,
  };
  const label = `«${schedule.label}» (${departmentName})`;
  return (
    <>
      {giveBack && (
        <ConfirmScheduleAction
          {...common}
          action={returnScheduleAction}
          icon="return"
          destructive
          triggerLabel="برگشت برای اصلاح"
          title={`برگشت برنامه ${label} برای اصلاح؟`}
          description="برنامه به سرپرستار برگشت داده و به او اطلاع داده می‌شود. توضیح شما در صفحه برنامه به سرپرستار نمایش داده می‌شود؛ بنویسید چه چیزی و در کدام روزها باید اصلاح شود."
          confirmLabel="برگشت داده شود"
          comment={{
            label: "توضیح برای سرپرستار (الزامی)",
            hint: "مثلاً: پوشش شب ۱۲ آبان کافی نیست.",
            maxLength: RETURN_COMMENT_MAX_LENGTH,
          }}
        />
      )}
      {approve && (
        <ConfirmScheduleAction
          {...common}
          action={approveScheduleAction}
          icon="approve"
          triggerLabel="تأیید برنامه"
          title={`تأیید برنامه ${label}؟`}
          description="نسخه تأییدشده برنامه همان‌طور که ارسال شده ثبت و به سرپرستار اطلاع داده می‌شود. پس از تأیید، برنامه قفل است و در این مرحله تغییر نمی‌کند."
          confirmLabel="بله، تأیید شود"
        />
      )}
    </>
  );
}

function Blockers({
  workflow,
  dayHref,
  action,
}: {
  workflow: ScheduleWorkflow;
  dayHref: (date: IsoDate) => Route;
  action: "finalize" | "submit";
}) {
  const state = workflow.actions[action]!;
  const v = workflow.validation;
  return (
    <Callout
      as="div"
      tone="attention"
      icon={OctagonAlert}
      id={WORKFLOW_BLOCKERS_ID}
      data-workflow="blocked"
    >
      <p className="font-semibold">
        {action === "finalize"
          ? "نهایی‌سازی فعلاً ممکن نیست، چون:"
          : "ارسال برای تأیید فعلاً ممکن نیست، چون:"}
      </p>
      <ul className="mt-1 list-disc ps-5">
        {state.blockers.includes("VALIDATION") &&
          VALIDATION_ROWS.map(({ key, label, dates }) => {
            const line = label(v);
            if (!line) return null;
            const days = dates(v);
            return (
              <li key={key} data-blocker={key}>
                {line}
                {days.length > 0 && (
                  <span className="ms-1 inline-flex flex-wrap items-center gap-x-1.5">
                    —
                    {days.slice(0, 6).map((date) => (
                      <Link
                        key={date}
                        href={dayHref(date)}
                        scroll={false}
                        className="rounded-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none"
                      >
                        {shortJalaliDay(date)}
                      </Link>
                    ))}
                    {days.length > 6 && (
                      <span>و {faNumber(days.length - 6)} روز دیگر</span>
                    )}
                  </span>
                )}
              </li>
            );
          })}
        {state.blockers
          .filter((b) => b !== "VALIDATION")
          .map((b) => (
            <li key={b}>{blockerLabel(b, v)}</li>
          ))}
      </ul>
      {state.blockers.includes("VALIDATION") && (
        <p className="mt-2 text-xs">
          {faNumber(v.readyDays)} روز از {faNumber(v.totalDays)} روز آماده است.
          ذخیره برنامه ناقص همچنان ممکن است؛ این موارد فقط مانع نهایی‌سازی و
          ارسال‌اند.
        </p>
      )}
    </Callout>
  );
}

/** One row per open category, each with the days it affects (D104). */
const VALIDATION_ROWS: readonly {
  key: string;
  label: (v: ScheduleWorkflow["validation"]) => string | null;
  dates: (v: ScheduleWorkflow["validation"]) => readonly IsoDate[];
}[] = [
  {
    key: "undecided",
    label: (v) =>
      v.undecided > 0
        ? `${faNumber(v.undecided)} تصمیم تعیین‌نشده در ${faNumber(v.undecidedDays)} روز`
        : null,
    dates: (v) => v.dates.undecided,
  },
  {
    key: "coverage",
    label: (v) =>
      v.coverageProblems > 0
        ? validationBlockerLines({ ...v, undecided: 0, ruleViolations: 0 })[0]!
        : null,
    dates: (v) => v.dates.coverage,
  },
  {
    key: "ruleViolations",
    label: (v) =>
      v.ruleViolations > 0 ? `${faNumber(v.ruleViolations)} نقض قانون` : null,
    dates: (v) => v.dates.ruleViolations,
  },
];

/** The Supervisor's comment on a returned submission, as the Head Nurse reads it. */
function ReturnComment({ submission }: { submission: WorkflowSubmission }) {
  return (
    <section
      aria-labelledby="return-comment-title"
      data-workflow="returned"
      className="flex flex-col gap-2 rounded-xl border border-status-warning/40 bg-status-warning/8 p-3 sm:p-4"
    >
      <h2
        id="return-comment-title"
        className="flex items-center gap-2 text-sm font-semibold text-status-warning-foreground"
      >
        <Undo2 aria-hidden="true" className="size-4 rtl:-scale-x-100" />
        برنامه برای اصلاح برگشت داده شد
      </h2>
      <figure className="flex flex-col gap-1.5">
        <blockquote
          dir="auto"
          className="rounded-md border-s-4 border-status-warning bg-card px-3 py-2 text-sm leading-relaxed whitespace-pre-line text-foreground"
        >
          {submission.comment}
        </blockquote>
        <figcaption className="text-xs text-muted-foreground">
          {submission.decidedBy?.displayName ?? "سوپروایزر"}
          {submission.decidedAt && ` · ${when(submission.decidedAt)}`}
        </figcaption>
      </figure>
    </section>
  );
}

/**
 * Where the schedule stands for the Head Nurse, under the header: what
 * blocks the next step (with links to the days to fix), that it waits for
 * the Supervisor, the return comment, or that it is approved. Nothing in
 * DRAFT (its next step, opening preferences, needs no explanation).
 */
export function HeadNurseWorkflowNotice({
  workflow,
  dayHref,
}: {
  workflow: ScheduleWorkflow;
  dayHref: (date: IsoDate) => Route;
}) {
  const { actions, pending, lastDecision } = workflow;
  const blockedAction =
    actions.finalize && blocked(actions.finalize)
      ? "finalize"
      : actions.submit && blocked(actions.submit)
        ? "submit"
        : null;

  return (
    <div className="flex flex-col gap-3 empty:hidden">
      {workflow.status === "RETURNED" &&
        lastDecision?.decision === "RETURNED" && (
          <ReturnComment submission={lastDecision} />
        )}
      {blockedAction && (
        <Blockers
          workflow={workflow}
          dayHref={dayHref}
          action={blockedAction}
        />
      )}
      {workflow.status === "RETURNED" && actions.submit && !blockedAction && (
        <Callout role="note" tone="info" icon={Info}>
          شیفت‌ها را بر اساس توضیح سوپروایزر اصلاح کنید و سپس برنامه را دوباره
          برای تأیید ارسال کنید.
        </Callout>
      )}
      {workflow.status === "FINALIZED" && !blockedAction && (
        <Callout role="note" tone="info" icon={Lock}>
          برنامه نهایی شده است. گام بعد: ارسال برای تأیید سوپروایزر. تا پیش از
          ارسال، اصلاح شیفت‌ها همچنان ممکن است.
          {lastDecision?.decision === "WITHDRAWN" &&
            lastDecision.decidedAt &&
            ` (ارسال قبلی در ${when(lastDecision.decidedAt)} پس گرفته شد.)`}
        </Callout>
      )}
      {workflow.status === "SUBMITTED" && pending && (
        <Callout
          role="note"
          tone="review"
          icon={Clock}
          data-workflow="submitted"
        >
          در انتظار بررسی سوپروایزر — ارسال‌شده توسط{" "}
          {pending.submittedBy.displayName} در {when(pending.submittedAt)}.
          شیفت‌ها تا تصمیم سوپروایزر قفل‌اند
          {actions.withdraw &&
            "؛ تا پیش از اقدام او می‌توانید ارسال را پس بگیرید"}
          .
        </Callout>
      )}
      {workflow.status === "APPROVED" && (
        <Callout
          role="note"
          tone="success"
          icon={BadgeCheck}
          data-workflow="approved"
        >
          برنامه تأیید شده است
          {lastDecision?.decision === "APPROVED" &&
            lastDecision.decidedBy &&
            lastDecision.decidedAt &&
            ` — توسط ${lastDecision.decidedBy.displayName} در ${when(lastDecision.decidedAt)}`}
          . نسخه تأییدشده ثبت شده و برنامه در این مرحله قابل ویرایش نیست.
        </Callout>
      )}
    </div>
  );
}

/** Submission metadata and the decision context for the Supervisor's review. */
export function SupervisorWorkflowNotice({
  workflow,
}: {
  workflow: ScheduleWorkflow;
}) {
  const { pending, lastDecision, validation } = workflow;
  return (
    <div className="flex flex-col gap-3 empty:hidden">
      {workflow.status === "SUBMITTED" && pending && (
        <Callout
          role="note"
          tone="review"
          icon={Clock}
          data-workflow="submitted"
        >
          ارسال‌شده برای تأیید توسط {pending.submittedBy.displayName} در{" "}
          {when(pending.submittedAt)}.{" "}
          {workflow.ownSubmission
            ? "این برنامه را خودتان ارسال کرده‌اید؛ تأیید یا برگشت آن با سوپروایزر دیگری است."
            : "برنامه را بررسی کنید و آن را تأیید یا با توضیح برای اصلاح برگشت دهید. شیفت‌ها در این صفحه فقط قابل مشاهده‌اند."}
        </Callout>
      )}
      {workflow.status === "SUBMITTED" && !validation.ready && (
        <Callout role="note" tone="attention" icon={OctagonAlert}>
          این برنامه طبق قوانین فعلی‌اش کامل و معتبر نیست:{" "}
          {validationBlockerLines(validation).join("؛ ")} (روزها در تقویم
          مشخص‌اند).
        </Callout>
      )}
      {workflow.status === "FINALIZED" && (
        <Callout role="note" tone="muted" icon={Lock}>
          این برنامه نهایی شده اما هنوز برای تأیید ارسال نشده است؛ فعلاً فقط
          قابل مشاهده است.
        </Callout>
      )}
      {workflow.status === "RETURNED" &&
        lastDecision?.decision === "RETURNED" && (
          <Callout
            as="div"
            role="note"
            tone="attention"
            icon={MessageSquareWarning}
          >
            <p>
              برای اصلاح برگشت داده شد
              {lastDecision.decidedBy &&
                ` توسط ${lastDecision.decidedBy.displayName}`}
              {lastDecision.decidedAt && ` در ${when(lastDecision.decidedAt)}`}.
              توضیح:
            </p>
            <p dir="auto" className="mt-1 whitespace-pre-line">
              {lastDecision.comment}
            </p>
          </Callout>
        )}
      {workflow.status === "APPROVED" && (
        <Callout
          role="note"
          tone="success"
          icon={BadgeCheck}
          data-workflow="approved"
        >
          تأیید شده
          {lastDecision?.decision === "APPROVED" &&
            lastDecision.decidedBy &&
            lastDecision.decidedAt &&
            ` توسط ${lastDecision.decidedBy.displayName} در ${when(lastDecision.decidedAt)}`}
          .
        </Callout>
      )}
    </div>
  );
}
