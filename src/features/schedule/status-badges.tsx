import { Badge } from "@/components/ui/badge";
import type { PreferenceCollectionState } from "@/domain/preferences/preference-window";
import type { ScheduleStatus } from "@/domain/schedule/status";
import { cn } from "@/lib/utils";

import {
  PREFERENCE_STATE_PRESENTATION,
  SCHEDULE_STATUS_PRESENTATION,
  type StatusPresentation,
} from "./status-presentation";

function StatusBadge({
  presentation: p,
  prefix,
  size,
}: {
  presentation: StatusPresentation;
  prefix?: string;
  size?: "sm" | "md";
}) {
  const Icon = p.icon;
  return (
    <Badge tone={p.tone} size={size}>
      <Icon
        aria-hidden="true"
        className={cn("size-3.5 shrink-0", p.mirrored && "rtl:-scale-x-100")}
      />
      {prefix && <span className="font-normal opacity-80">{prefix}</span>}
      {p.label}
    </Badge>
  );
}

/** The schedule's lifecycle status: icon + text; color is only a secondary cue. */
export function ScheduleStatusBadge({
  status,
  size,
}: {
  status: ScheduleStatus;
  size?: "sm" | "md";
}) {
  return (
    <StatusBadge
      presentation={SCHEDULE_STATUS_PRESENTATION[status]}
      size={size}
    />
  );
}

/** Whether nurses can enter preferences now («ترجیحات: باز»). */
export function PreferenceStateBadge({
  state,
  withPrefix = false,
  size,
}: {
  state: PreferenceCollectionState;
  withPrefix?: boolean;
  size?: "sm" | "md";
}) {
  return (
    <StatusBadge
      presentation={PREFERENCE_STATE_PRESENTATION[state]}
      prefix={withPrefix ? "ترجیحات:" : undefined}
      size={size}
    />
  );
}
