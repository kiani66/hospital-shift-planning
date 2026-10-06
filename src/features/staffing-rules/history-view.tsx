import { History } from "lucide-react";

import type {
  ApplicationHistoryEntry,
  RuleSetHistoryEntry,
} from "@/application/staffing-rules/history";
import { formatJalaliDateTime } from "@/features/calendar/jalali";
import { APP_TIMEZONE } from "@/infrastructure/auth/actor";

import {
  applicationEntryText,
  historyEntryText,
  scopeLabel,
} from "./presentation";

/**
 * Read-only history (D110): rule-set lifecycle events and every Apply to a
 * schedule, newest first, each with who and when. Nothing here is editable.
 */
export function RuleSetHistory({
  title,
  entries,
  applications = [],
  names,
  departmentName,
  scheduleLabel,
  versionName,
}: {
  title: string;
  entries: readonly RuleSetHistoryEntry[];
  applications?: readonly ApplicationHistoryEntry[];
  names: ReadonlyMap<string, string>;
  /** The department name of a scope (null: the Hospital Default). */
  departmentName: (departmentId: string | null) => string | null;
  scheduleLabel?: (scheduleId: string) => string;
  versionName?: (versionId: string) => string;
}) {
  const rows = [
    ...entries.map((e) => ({
      key: `${e.kind}-${e.versionId}-${e.at.getTime()}`,
      at: e.at,
      actorId: e.actorId,
      text: historyEntryText(e, scopeLabel(departmentName(e.departmentId))),
    })),
    ...applications.map((a) => ({
      key: `apply-${a.id}`,
      at: a.at,
      actorId: a.actorId,
      text: applicationEntryText(a, {
        scheduleLabel: scheduleLabel?.(a.scheduleId) ?? "—",
        from: versionName?.(a.fromVersionId) ?? "—",
        to: versionName?.(a.toVersionId) ?? "—",
      }),
    })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());
  return (
    <section aria-labelledby="rule-set-history" className="flex flex-col gap-3">
      <h2
        id="rule-set-history"
        className="flex items-center gap-2 text-lg font-semibold"
      >
        <History aria-hidden="true" className="size-5 text-muted-foreground" />
        {title}
      </h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">رویدادی ثبت نشده است.</p>
      ) : (
        <ol className="flex flex-col divide-y rounded-xl border bg-card">
          {rows.map((r) => (
            <li
              key={r.key}
              data-history-entry
              className="flex flex-col gap-0.5 px-3 py-2 text-sm"
            >
              <span>{r.text}</span>
              <span className="text-xs text-muted-foreground">
                {names.get(r.actorId) ?? "—"} ·{" "}
                {formatJalaliDateTime(r.at, APP_TIMEZONE)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
