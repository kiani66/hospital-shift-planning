import { CircleAlert, CircleCheck, CircleDashed } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { DayHealth } from "@/domain/schedule/day-health";
import { cn } from "@/lib/utils";

import { HEALTH_PRESENTATION } from "./presentation";

const ICONS = {
  UNPLANNED: CircleDashed,
  VALID: CircleCheck,
  NEEDS_ATTENTION: CircleAlert,
} as const satisfies Record<DayHealth, unknown>;

const TONE: Record<DayHealth, string> = {
  UNPLANNED: "text-health-unplanned-foreground",
  VALID: "text-health-valid-foreground",
  NEEDS_ATTENTION: "text-health-attention-foreground",
};

/** Each health state has its own icon shape, so it reads without color. */
export function HealthIcon({
  health,
  className,
}: {
  health: DayHealth;
  className?: string;
}) {
  const Icon = ICONS[health];
  return (
    <Icon
      aria-hidden="true"
      className={cn("size-4 shrink-0", TONE[health], className)}
    />
  );
}

/** A day's health as a badge: icon + label (+ an optional count). */
export function HealthBadge({
  health,
  count,
  size,
}: {
  health: DayHealth;
  count?: string;
  size?: "sm" | "md";
}) {
  const p = HEALTH_PRESENTATION[health];
  return (
    <Badge tone={p.tone} size={size}>
      <HealthIcon health={health} className="size-3.5 text-current" />
      {p.label}
      {count && <span className="font-semibold tabular-nums">{count}</span>}
    </Badge>
  );
}
