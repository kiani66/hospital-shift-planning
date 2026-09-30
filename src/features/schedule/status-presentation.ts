import {
  BadgeCheck,
  CircleDashed,
  History,
  Lock,
  LockOpen,
  PencilLine,
  Send,
  Undo2,
  type LucideIcon,
} from "lucide-react";

import type { BadgeTone } from "@/components/ui/badge";
import type { PreferenceCollectionState } from "@/domain/preferences/preference-window";
import type { ScheduleStatus } from "@/domain/schedule/status";

import { PREFERENCE_STATE_LABELS, SCHEDULE_STATUS_LABELS } from "./labels";

export interface StatusPresentation {
  readonly label: string;
  /** One distinct shape per state, so the state reads without color. */
  readonly icon: LucideIcon;
  readonly tone: BadgeTone;
  /** The icon has a direction (send, undo) and is mirrored in RTL. */
  readonly mirrored?: boolean;
}

/**
 * The schedule lifecycle as a badge: every status its own icon and tone, so
 * neighbouring states never look alike (D56). DRAFT is quiet, PLANNING an
 * info blue, FINALIZED the solid brand blue (settled), SUBMITTED the review
 * violet (with the supervisor), RETURNED the warning orange (asks the Head
 * Nurse to act), REVISING amber (reopened work). Only APPROVED gets a check
 * and success green: a check on any earlier status would suggest the month
 * is done.
 */
export const SCHEDULE_STATUS_PRESENTATION: Readonly<
  Record<ScheduleStatus, StatusPresentation>
> = {
  DRAFT: {
    label: SCHEDULE_STATUS_LABELS.DRAFT,
    icon: CircleDashed,
    tone: "muted",
  },
  PLANNING: {
    label: SCHEDULE_STATUS_LABELS.PLANNING,
    icon: PencilLine,
    tone: "info",
  },
  FINALIZED: {
    label: SCHEDULE_STATUS_LABELS.FINALIZED,
    icon: Lock,
    tone: "brand",
  },
  SUBMITTED: {
    label: SCHEDULE_STATUS_LABELS.SUBMITTED,
    icon: Send,
    tone: "review",
    mirrored: true,
  },
  RETURNED: {
    label: SCHEDULE_STATUS_LABELS.RETURNED,
    icon: Undo2,
    tone: "warning",
    mirrored: true,
  },
  APPROVED: {
    label: SCHEDULE_STATUS_LABELS.APPROVED,
    icon: BadgeCheck,
    tone: "success",
  },
  REVISING: {
    label: SCHEDULE_STATUS_LABELS.REVISING,
    icon: History,
    tone: "attention",
  },
};

/** Preference collection (the window), independent of the lifecycle status. */
export const PREFERENCE_STATE_PRESENTATION: Readonly<
  Record<PreferenceCollectionState, StatusPresentation>
> = {
  NONE: {
    label: PREFERENCE_STATE_LABELS.NONE,
    icon: CircleDashed,
    tone: "muted",
  },
  OPEN: { label: PREFERENCE_STATE_LABELS.OPEN, icon: LockOpen, tone: "active" },
  CLOSED: {
    label: PREFERENCE_STATE_LABELS.CLOSED,
    icon: Lock,
    tone: "neutral",
  },
};
