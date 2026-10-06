import {
  CircleCheck,
  CircleDashed,
  CircleQuestionMark,
  OctagonAlert,
  TriangleAlert,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { DayState } from "@/domain/rules/validation-summary";
import { cn } from "@/lib/utils";

import { DAY_STATE_PRESENTATION } from "./presentation";

const ICONS = {
  NOT_STARTED: CircleDashed,
  UNDECIDED: CircleQuestionMark,
  COVERAGE: TriangleAlert,
  RULE_VIOLATION: OctagonAlert,
  READY: CircleCheck,
} as const satisfies Record<DayState, unknown>;

const TONE: Record<DayState, string> = {
  NOT_STARTED: "text-health-unplanned-foreground",
  UNDECIDED: "text-health-unplanned-foreground",
  COVERAGE: "text-health-attention-foreground",
  RULE_VIOLATION: "text-destructive",
  READY: "text-health-valid-foreground",
};

/** Each day state has its own icon shape, so it reads without color (D103). */
export function DayStateIcon({
  state,
  className,
}: {
  state: DayState;
  className?: string;
}) {
  const Icon = ICONS[state];
  return (
    <Icon
      aria-hidden="true"
      className={cn("size-4 shrink-0", TONE[state], className)}
    />
  );
}

/** A day's primary state as a badge: icon + label. */
export function DayStateBadge({
  state,
  size,
}: {
  state: DayState;
  size?: "sm" | "md";
}) {
  const p = DAY_STATE_PRESENTATION[state];
  return (
    <Badge tone={p.tone} size={size}>
      <DayStateIcon state={state} className="size-3.5 text-current" />
      {p.label}
    </Badge>
  );
}
