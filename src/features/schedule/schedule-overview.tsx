import {
  CalendarDays,
  CalendarPlus,
  CircleCheck,
  CircleDashed,
  Lock,
  LockOpen,
  Users,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import type {
  PreferenceWindowSummary,
  ScheduleListItem,
  ScheduleOverview,
} from "@/application/schedules/queries";
import type { PreferenceCollectionState } from "@/domain/preferences/preference-window";
import type { ScheduleStatus } from "@/domain/schedule/status";
import {
  faNumber,
  formatJalaliDateTime,
  formatJalaliRange,
} from "@/features/calendar/jalali";
import { APP_TIMEZONE } from "@/infrastructure/auth/actor";
import { cn } from "@/lib/utils";

import { closePreferencesAction, openPreferencesAction } from "./actions";
import { ConfirmScheduleAction } from "./confirm-action";
import {
  PREFERENCE_STATE_LABELS,
  ROLE_LABELS,
  SCHEDULE_STATUS_LABELS,
} from "./labels";

function Card({
  id,
  title,
  icon,
  children,
  className,
}: {
  id: string;
  title: string;
  icon: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-labelledby={id}
      className={cn(
        "flex flex-col gap-4 rounded-lg border bg-card p-4 sm:p-5",
        className,
      )}
    >
      <h2 id={id} className="flex items-center gap-2 font-semibold">
        {icon}
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Status as icon + text; color is only a secondary cue. */
export function ScheduleStatusBadge({ status }: { status: ScheduleStatus }) {
  const draft = status === "DRAFT";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium whitespace-nowrap",
        draft
          ? "bg-muted text-muted-foreground"
          : "border-primary/30 bg-primary/10 text-primary",
      )}
    >
      {draft ? (
        <CircleDashed aria-hidden="true" className="size-3.5" />
      ) : (
        <CircleCheck aria-hidden="true" className="size-3.5" />
      )}
      {SCHEDULE_STATUS_LABELS[status]}
    </span>
  );
}

function PreferenceStateBadge({ state }: { state: PreferenceCollectionState }) {
  const Icon =
    state === "OPEN" ? LockOpen : state === "CLOSED" ? Lock : CircleDashed;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
        state === "OPEN" &&
          "border-emerald-600/30 bg-emerald-600/10 text-emerald-800 dark:text-emerald-300",
        state === "CLOSED" && "bg-muted text-foreground",
        state === "NONE" && "bg-muted text-muted-foreground",
      )}
    >
      <Icon aria-hidden="true" className="size-3.5" />
      {PREFERENCE_STATE_LABELS[state]}
    </span>
  );
}

function Facts({ items }: { items: readonly [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
      {items.map(([term, value]) => (
        <div key={term} className="contents">
          <dt className="text-muted-foreground">{term}</dt>
          <dd className="min-w-0 font-medium break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Other schedules of the department, as links (the selected one is current). */
export function ScheduleSwitcher({
  departmentCode,
  schedules,
  selectedId,
}: {
  departmentCode: string;
  schedules: readonly ScheduleListItem[];
  selectedId: string;
}) {
  if (schedules.length < 2) return null;
  return (
    <nav aria-label="برنامه‌های بخش">
      <ul className="flex flex-wrap gap-2">
        {schedules.map((s) => {
          const current = s.id === selectedId;
          return (
            <li key={s.id}>
              <Link
                href={`/departments/${departmentCode}/schedule?schedule=${s.id}`}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-11 items-center rounded-md border px-3 text-sm focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none",
                  current
                    ? "border-primary bg-primary text-primary-foreground"
                    : "bg-background hover:bg-accent",
                )}
              >
                {s.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function EmptySchedules({ action }: { action: ReactNode }) {
  return (
    <section
      aria-labelledby="empty-schedules"
      className="flex flex-col items-center gap-4 rounded-lg border border-dashed px-6 py-12 text-center"
    >
      <CalendarPlus
        aria-hidden="true"
        className="size-10 text-muted-foreground"
      />
      <div className="flex max-w-md flex-col gap-2">
        <h2 id="empty-schedules" className="text-lg font-semibold">
          هنوز برنامه‌ای برای این بخش ایجاد نشده است
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          با ایجاد برنامه ماهانه، فهرست پرسنل آن ماه ثبت می‌شود و می‌توانید ثبت
          ترجیحات پرستاران را باز کنید.
        </p>
      </div>
      {action}
    </section>
  );
}

function windowScope(window: PreferenceWindowSummary) {
  const range = formatJalaliRange(window.firstDate, window.lastDate);
  return window.coversWholePeriod
    ? `کل دوره (${range})`
    : `${range} — ${faNumber(window.dateCount)} روز`;
}

function windowNurses(window: PreferenceWindowSummary) {
  return window.allRoster
    ? `همه پرسنل برنامه (${faNumber(window.nurseCount)} نفر)`
    : `${faNumber(window.nurseCount)} نفر منتخب`;
}

function PreferencesCard({ schedule }: { schedule: ScheduleOverview }) {
  const { state, windows } = schedule.preferences;
  const latest = windows[0];
  const range = formatJalaliRange(schedule.period.start, schedule.period.end);

  return (
    <Card
      id="preferences-heading"
      title="ثبت ترجیحات پرستاران"
      icon={
        <LockOpen aria-hidden="true" className="size-5 text-muted-foreground" />
      }
    >
      <div aria-live="polite" className="flex flex-col gap-4">
        <Facts
          items={[
            ["وضعیت", <PreferenceStateBadge key="s" state={state} />],
            ...(latest
              ? ([
                  ["دامنه تاریخ", windowScope(latest)],
                  ["پرستاران", windowNurses(latest)],
                  [
                    "باز شده",
                    `${formatJalaliDateTime(latest.openedAt, APP_TIMEZONE)} — ${latest.openedBy}`,
                  ],
                  ...(latest.closedAt
                    ? ([
                        [
                          "بسته شده",
                          `${formatJalaliDateTime(latest.closedAt, APP_TIMEZONE)} — ${latest.closedBy}`,
                        ],
                      ] as [string, ReactNode][])
                    : []),
                ] as [string, ReactNode][])
              : []),
          ]}
        />

        {state === "NONE" && (
          <p className="text-sm leading-relaxed text-muted-foreground">
            {schedule.actions.openPreferences
              ? `با باز کردن ثبت ترجیحات، همه ${faNumber(schedule.roster.total)} نفر پرسنل برنامه می‌توانند برای تمام روزهای ${range} ترجیحات خود را ثبت کنند.`
              : "در وضعیت فعلی برنامه، ثبت ترجیحات باز نمی‌شود."}
          </p>
        )}
        {state === "OPEN" && (
          <p className="text-sm leading-relaxed text-muted-foreground">
            پرستاران تا زمان بستن، می‌توانند ترجیحات خود را ثبت و ویرایش کنند.
          </p>
        )}
        {state === "CLOSED" && (
          <p className="text-sm leading-relaxed text-muted-foreground">
            ثبت ترجیحات بسته است و پرستاران دیگر نمی‌توانند ترجیحات خود را تغییر
            دهند.
          </p>
        )}
      </div>

      {(schedule.actions.openPreferences ||
        schedule.actions.closePreferences) && (
        <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-center">
          {schedule.actions.openPreferences && (
            <ConfirmScheduleAction
              action={openPreferencesAction}
              scheduleId={schedule.id}
              revision={schedule.revision}
              icon="open"
              triggerLabel="باز کردن ثبت ترجیحات"
              title="باز کردن ثبت ترجیحات؟"
              description={`ثبت ترجیحات برای همه پرسنل برنامه (${faNumber(schedule.roster.total)} نفر) و تمام روزهای ${range} باز می‌شود و به پرستاران اطلاع داده می‌شود. وضعیت برنامه به «${SCHEDULE_STATUS_LABELS.PLANNING}» تغییر می‌کند.`}
              confirmLabel="بله، باز شود"
            />
          )}
          {schedule.actions.closePreferences && (
            <ConfirmScheduleAction
              action={closePreferencesAction}
              scheduleId={schedule.id}
              revision={schedule.revision}
              icon="close"
              destructive
              triggerLabel="بستن ثبت ترجیحات"
              title="بستن ثبت ترجیحات؟"
              description="پس از بستن، پرستاران دیگر نمی‌توانند ترجیحات خود را ثبت یا ویرایش کنند. بازگشایی دوباره فقط به‌صورت محدود و در مراحل بعدی ممکن خواهد بود."
              confirmLabel="بله، بسته شود"
            />
          )}
        </div>
      )}
    </Card>
  );
}

function RosterCard({ schedule }: { schedule: ScheduleOverview }) {
  const { roster } = schedule;
  return (
    <Card
      id="roster-heading"
      title="پرسنل برنامه"
      icon={
        <Users aria-hidden="true" className="size-5 text-muted-foreground" />
      }
    >
      <Facts
        items={[
          ["تعداد پرسنل برنامه", faNumber(roster.total)],
          ["پرستار", faNumber(roster.nurses)],
          ["سرپرستار", faNumber(roster.headNurses)],
        ]}
      />
      <p className="text-xs leading-relaxed text-muted-foreground">
        این فهرست هنگام ایجاد برنامه از عضویت‌های مؤثر در همین بازه ثبت شده است
        و با تغییر عضویت‌ها به‌طور خودکار تغییر نمی‌کند.
      </p>
      <details className="group rounded-md border">
        <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm font-medium focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none">
          مشاهده فهرست پرسنل
        </summary>
        <ul className="divide-y border-t text-sm">
          {roster.members.map((m) => (
            <li
              key={m.userId}
              className="flex items-center justify-between gap-3 px-3 py-2"
            >
              <span className="min-w-0 truncate">{m.displayName}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {ROLE_LABELS[m.role]}
              </span>
            </li>
          ))}
        </ul>
      </details>
    </Card>
  );
}

export function ScheduleOverviewView({
  schedule,
}: {
  schedule: ScheduleOverview;
}) {
  return (
    <div className="flex flex-col gap-4">
      <section
        aria-labelledby="schedule-heading"
        className="flex flex-col gap-4 rounded-lg border bg-card p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5"
      >
        <div className="flex min-w-0 items-start gap-3">
          <CalendarDays
            aria-hidden="true"
            className="mt-1 size-6 shrink-0 text-muted-foreground"
          />
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-xs text-muted-foreground">برنامه ماهانه</p>
            <h2 id="schedule-heading" className="text-xl font-bold">
              {schedule.label}
            </h2>
            <p className="text-sm text-muted-foreground">
              {formatJalaliRange(schedule.period.start, schedule.period.end)} ·{" "}
              {faNumber(schedule.dayCount)} روز
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">وضعیت برنامه:</span>
          <ScheduleStatusBadge status={schedule.status} />
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <PreferencesCard schedule={schedule} />
        <RosterCard schedule={schedule} />
      </div>
    </div>
  );
}
