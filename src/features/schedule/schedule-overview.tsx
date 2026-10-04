import { CalendarPlus, LockOpen, Users } from "lucide-react";
import type { ReactNode } from "react";

import type {
  PreferenceWindowSummary,
  ScheduleOverview,
} from "@/application/schedules/queries";
import { EmptyState } from "@/components/ui/empty-state";
import { MetadataList } from "@/components/ui/metadata";
import { SectionHeader } from "@/components/ui/section-header";
import {
  faNumber,
  formatJalaliDateTime,
  formatJalaliRange,
} from "@/features/calendar/jalali";
import { APP_TIMEZONE } from "@/infrastructure/auth/actor";

import { closePreferencesAction, openPreferencesAction } from "./actions";
import { ConfirmScheduleAction } from "./confirm-action";
import { ROLE_LABELS, SCHEDULE_STATUS_LABELS } from "./labels";
import { PreferenceStateBadge } from "./status-badges";

/** A department with no schedule at all yet (the page's first state). */
export function EmptySchedules({ action }: { action: ReactNode }) {
  return (
    <EmptyState
      icon={<CalendarPlus aria-hidden="true" />}
      titleId="empty-schedules"
      title="هنوز برنامه‌ای برای این بخش ایجاد نشده است"
      description="با ایجاد برنامه ماهانه، فهرست پرسنل آن ماه (سرپرستار هم) ثبت می‌شود؛ سپس می‌توانید ثبت ترجیحات پرستاران را باز کنید و شیفت‌ها را بچینید."
      action={action}
    />
  );
}

/**
 * The schedule's next preference step, for the page header: open collection
 * (DRAFT) or close it (while open). Nothing when neither applies.
 */
export function PreferenceAction({ schedule }: { schedule: ScheduleOverview }) {
  const range = formatJalaliRange(schedule.period.start, schedule.period.end);
  if (schedule.actions.openPreferences)
    return (
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
    );
  if (schedule.actions.closePreferences)
    return (
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
    );
  return null;
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

function PreferencesSection({ schedule }: { schedule: ScheduleOverview }) {
  const { state, windows } = schedule.preferences;
  const latest = windows[0];
  const range = formatJalaliRange(schedule.period.start, schedule.period.end);

  return (
    <section
      aria-labelledby="preferences-heading"
      className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-xs"
    >
      <SectionHeader
        id="preferences-heading"
        title="ثبت ترجیحات پرستاران"
        icon={<LockOpen aria-hidden="true" />}
      />
      <div aria-live="polite" className="flex flex-col gap-3">
        <MetadataList
          items={[
            ["وضعیت", <PreferenceStateBadge key="s" state={state} size="sm" />],
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
                      ] as const)
                    : []),
                ] as const)
              : []),
          ]}
        />
        <p className="text-xs leading-relaxed text-muted-foreground">
          {state === "NONE" &&
            (schedule.actions.openPreferences
              ? `با باز کردن ثبت ترجیحات (دکمه بالای صفحه)، همه ${faNumber(schedule.roster.total)} نفر پرسنل برنامه می‌توانند برای تمام روزهای ${range} ترجیحات خود را ثبت کنند.`
              : "در وضعیت فعلی برنامه، ثبت ترجیحات باز نمی‌شود.")}
          {state === "OPEN" &&
            "پرستاران تا زمان بستن، می‌توانند ترجیحات خود را ثبت و ویرایش کنند. ترجیح هر نفر در ویرایش روز کنار نامش دیده می‌شود."}
          {state === "CLOSED" &&
            "ثبت ترجیحات بسته است و پرستاران دیگر نمی‌توانند ترجیحات خود را تغییر دهند؛ ترجیحات ثبت‌شده همچنان در ویرایش روز دیده می‌شوند."}
        </p>
      </div>
    </section>
  );
}

function RosterSection({
  schedule,
  rosterAction,
}: {
  schedule: ScheduleOverview;
  rosterAction?: ReactNode;
}) {
  const { roster } = schedule;
  return (
    <section
      aria-labelledby="roster-heading"
      className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-xs"
    >
      <SectionHeader
        id="roster-heading"
        title="پرسنل برنامه"
        icon={<Users aria-hidden="true" />}
      />
      <MetadataList
        items={[
          ["تعداد پرسنل برنامه", `${faNumber(roster.total)} نفر`],
          [
            "ترکیب",
            `${faNumber(roster.nurses)} ${ROLE_LABELS.NURSE}، ${faNumber(roster.headNurses)} ${ROLE_LABELS.HEAD_NURSE}`,
          ],
        ]}
      />
      <p className="text-xs leading-relaxed text-muted-foreground">
        سرپرستار هم عضو برنامه است و مانند بقیه شیفت می‌گیرد. این فهرست هنگام
        ایجاد برنامه از عضویت‌های مؤثر در همین بازه ثبت شده است و با تغییر
        عضویت‌ها به‌طور خودکار تغییر نمی‌کند؛ افراد تازه عضو را پیش از
        نهایی‌سازی می‌توانید به‌صورت صریح اضافه کنید.
      </p>
      {rosterAction}
      {roster.members.length === 0 ? (
        <p className="rounded-md border border-dashed bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          فهرست پرسنل این برنامه خالی است.
        </p>
      ) : (
        <details className="group rounded-md border">
          <summary className="flex min-h-11 cursor-pointer items-center rounded-md px-3 text-sm font-medium text-primary group-open:rounded-b-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none">
            مشاهده فهرست پرسنل
          </summary>
          <ul className="max-h-80 divide-y overflow-y-auto border-t text-sm">
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
      )}
    </section>
  );
}

/** Below the calendar: preference collection and the roster, side by side on desktop. */
export function ScheduleDetails({
  schedule,
  rosterAction,
}: {
  schedule: ScheduleOverview;
  /** The Head Nurse's explicit roster addition (DRAFT / PLANNING only). */
  rosterAction?: ReactNode;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <PreferencesSection schedule={schedule} />
      <RosterSection schedule={schedule} rosterAction={rosterAction} />
    </div>
  );
}
