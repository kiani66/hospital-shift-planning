import type { ReactNode } from "react";

import type { RuleSetVersionView } from "@/application/staffing-rules/queries";
import { Badge } from "@/components/ui/badge";
import {
  faNumber,
  formatJalaliDate,
  formatJalaliDateTime,
} from "@/features/calendar/jalali";
import { APP_TIMEZONE } from "@/infrastructure/auth/actor";

import {
  RULE_SET_STATE_LABELS,
  RULE_SET_STATE_TONES,
  dayTypeSummary,
  effectiveFromText,
  versionLabel,
} from "./presentation";
import type { ShiftLabels } from "@/features/shifts/catalog";

/**
 * One rule-set version, read-only: its state, when it applies, every
 * bound (normal days, holidays, date exceptions), who created / published /
 * retired it, and how many schedules are pinned to it. `actions` are the
 * Hospital Admin's controls; others see the same card without them.
 */
export function RuleSetVersionCard({
  version,
  names,
  actions,
  highlight,
  shiftLabels,
}: {
  version: RuleSetVersionView;
  names: ReadonlyMap<string, string>;
  actions?: ReactNode;
  /** A short marker, e.g. «برنامه به این نسخه متصل است». */
  highlight?: string;
  /** Descriptive shift names (`shift_types.label`). */
  shiftLabels: ShiftLabels;
}) {
  const who = (id: string | null) => (id ? (names.get(id) ?? "—") : "سامانه");
  const c = version.content;
  return (
    <article
      data-rule-set-version={version.versionNo}
      data-state={version.state}
      aria-label={`${versionLabel(version.versionNo)}، ${RULE_SET_STATE_LABELS[version.state]}`}
      className="flex flex-col gap-2 rounded-xl border bg-card p-3 shadow-xs"
    >
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">{versionLabel(version.versionNo)}</h3>
        <Badge tone={RULE_SET_STATE_TONES[version.state]} size="sm">
          {RULE_SET_STATE_LABELS[version.state]}
        </Badge>
        {highlight && (
          <Badge tone="brand-soft" size="sm">
            {highlight}
          </Badge>
        )}
        <span className="text-xs text-muted-foreground">
          {effectiveFromText(version)}
        </span>
      </header>
      <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_minmax(0,1fr)]">
        <dt className="text-muted-foreground">روزهای عادی</dt>
        <dd>{dayTypeSummary(c.normal, shiftLabels)}</dd>
        <dt className="text-muted-foreground">روزهای تعطیل</dt>
        <dd>
          {Object.keys(c.holiday).length > 0
            ? dayTypeSummary(c.holiday, shiftLabels)
            : "مانند روزهای عادی"}
        </dd>
        <dt className="text-muted-foreground">استثنای تاریخ</dt>
        <dd>
          {c.exceptions.length === 0 ? (
            "ندارد"
          ) : (
            <ul className="flex flex-col">
              {c.exceptions.map((e) => (
                <li key={`${e.date}${e.period}`}>
                  {formatJalaliDate(e.date)} · {shiftLabels[e.period]}{" "}
                  {dayTypeSummary(
                    { [e.period]: e.bounds },
                    shiftLabels,
                  ).replace(`${shiftLabels[e.period]} `, "")}
                  {e.note && ` (${e.note})`}
                </li>
              ))}
            </ul>
          )}
        </dd>
      </dl>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {`پوشش هر نوبت: شیفت ${shiftLabels.ME} (ME) یک نفر در ${shiftLabels.M} و یک نفر در ${shiftLabels.E} شمرده می‌شود؛ ${shiftLabels.OFF} در پوشش شمرده نمی‌شود.`}
      </p>
      {version.note && (
        <p dir="auto" className="text-sm">
          یادداشت: {version.note}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        ساخته‌شده توسط {who(version.createdBy)}
        {version.publishedAt &&
          ` · منتشرشده توسط ${who(version.publishedBy)} در ${formatJalaliDateTime(version.publishedAt, APP_TIMEZONE)}`}
        {version.retiredAt &&
          ` · بازنشسته توسط ${who(version.retiredBy)} در ${formatJalaliDateTime(version.retiredAt, APP_TIMEZONE)} (${version.retiredReason === "REPLACED" ? "جایگزین با انتشار نسخه دیگر" : "کنار گذاشته شد"})`}
        {" · "}
        {faNumber(version.pins.schedules)} برنامه متصل
        {version.pins.approvedVersions > 0 &&
          ` · ${faNumber(version.pins.approvedVersions)} نسخه تأییدشده با این قوانین`}
      </p>
      {actions && (
        <div className="flex flex-wrap items-start gap-2 border-t pt-2">
          {actions}
        </div>
      )}
    </article>
  );
}
