import { CircleAlert, CircleCheck, CircleDashed } from "lucide-react";

import type { DayHealth } from "@/domain/schedule/day-health";
import { cn } from "@/lib/utils";

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
