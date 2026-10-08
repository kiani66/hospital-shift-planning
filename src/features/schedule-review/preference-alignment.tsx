import {
  Bed,
  CircleCheck,
  CircleDashed,
  CircleMinus,
  EqualNot,
  HeartHandshake,
} from "lucide-react";
import type { ComponentType } from "react";

import { IconWell } from "@/components/ui/icon-well";
import type { PreferenceAlignment } from "@/domain/preferences/preference-alignment";
import {
  preferenceFit,
  type PreferenceFit,
} from "@/domain/preferences/preference-fit";
import type {
  PreferenceValue,
  AssignmentCode,
} from "@/domain/shifts/shift-type";
import { faNumber } from "@/features/calendar/jalali";
import type { ShiftLabels } from "@/features/shifts/catalog";
import {
  NO_PREFERENCE_LABEL,
  preferenceFitLabel,
} from "@/features/schedule-editing/presentation";
import { cn } from "@/lib/utils";

import {
  ALIGNMENT_ADVISORY_NOTE,
  ALIGNMENT_LABELS,
  ALIGNMENT_OVERLAP_NOTE,
  alignmentPartitionNote,
  preferenceLabel,
} from "./presentation";

type Icon = ComponentType<{ className?: string; "aria-hidden"?: boolean }>;

/** Icon and text tone per fit; every state also has its own words (never color alone). */
const FIT_STYLE: Readonly<
  Record<Exclude<PreferenceFit, "NONE">, { icon: Icon; className: string }>
> = {
  MATCHES: {
    icon: CircleCheck,
    className: "font-medium text-status-success-foreground",
  },
  DIFFERS: {
    icon: EqualNot,
    className: "font-medium text-status-warning-foreground",
  },
  PENDING: { icon: CircleDashed, className: "text-muted-foreground" },
};

/**
 * A nurse's recorded wish for the day and how their shift relates to it, on
 * one short line: «ترجیح: شب · مغایر ترجیح». An explicit rest wish
 * («ترجیح: استراحت», bed icon) and no preference at all («ترجیحی ثبت نشده»,
 * dashed and muted) look and read differently. Context only (D35).
 */
export function PreferenceContext({
  preference,
  shift,
  id,
  hideMissing = false,
  shiftLabels,
}: {
  preference: PreferenceValue | null;
  shift: AssignmentCode | null;
  /** Descriptive shift names (`shift_types.label`). */
  shiftLabels: ShiftLabels;
  id?: string;
  /** Read-only lists say nothing for a nurse without a preference. */
  hideMissing?: boolean;
}) {
  const fit = preferenceFit(preference, shift);
  if (fit === "NONE" && hideMissing) return null;
  const fitLabel = preferenceFitLabel(fit);
  const style = fit === "NONE" ? null : FIT_STYLE[fit];
  return (
    <span
      id={id}
      data-fit={fit}
      className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs"
    >
      {preference === null ? (
        <span
          data-preference="NONE"
          className="inline-flex items-center gap-1 rounded border border-dashed border-border px-1.5 text-muted-foreground"
        >
          <CircleMinus aria-hidden className="size-3 shrink-0" />
          {NO_PREFERENCE_LABEL}
        </span>
      ) : (
        <span
          data-preference={preference}
          className="inline-flex items-center gap-1 rounded border border-primary/15 bg-brand-soft/70 px-1.5 text-brand-soft-foreground"
        >
          {preference === "OFF" && (
            <Bed aria-hidden className="size-3 shrink-0" />
          )}
          {preferenceLabel(preference, shiftLabels)}
        </span>
      )}
      {style && fitLabel && (
        <span className={cn("inline-flex items-center gap-1", style.className)}>
          <style.icon aria-hidden className="size-3.5 shrink-0" />
          {fitLabel}
        </span>
      )}
    </span>
  );
}

function Count({
  icon: Icon,
  label,
  value,
  tone,
  name,
}: {
  icon: Icon;
  label: string;
  value: number;
  tone: string;
  name: string;
}) {
  return (
    <div
      data-alignment={name}
      className="flex min-w-0 flex-col gap-0.5 rounded-lg bg-muted/50 px-2 py-1.5"
    >
      <dt className="flex min-w-0 items-start gap-1 text-xs leading-snug text-muted-foreground">
        <Icon aria-hidden className={cn("mt-px size-3.5 shrink-0", tone)} />
        {label}
      </dt>
      <dd className="text-lg leading-tight font-semibold tabular-nums">
        {faNumber(value)}{" "}
        <span className="text-xs font-normal text-muted-foreground">نفر</span>
      </dd>
    </div>
  );
}

/**
 * «انطباق با ترجیحات»: how the day's assignments relate to the recorded
 * wishes. The four fit counts partition the roster and say so; «تعیین‌نشده»
 * is another dimension that overlaps them and is shown apart, so no figure
 * suggests a total it is not. Advisory: a conflict never invalidates the
 * schedule (D35), and nothing here is green "approval".
 */
export function PreferenceAlignmentSummary({
  alignment,
}: {
  alignment: PreferenceAlignment;
}) {
  const a = alignment;
  return (
    <section
      aria-labelledby="day-preference-alignment"
      className="flex flex-col gap-2 rounded-xl border bg-card p-3 shadow-xs"
    >
      <h3
        id="day-preference-alignment"
        className="flex items-center gap-2 text-sm font-semibold"
      >
        <IconWell>
          <HeartHandshake />
        </IconWell>
        {ALIGNMENT_LABELS.title}
      </h3>
      <dl
        aria-describedby="day-preference-alignment-partition"
        className="grid grid-cols-2 gap-1.5"
      >
        <Count
          name="matches"
          icon={CircleCheck}
          tone="text-status-success-foreground"
          label={ALIGNMENT_LABELS.matches}
          value={a.matches}
        />
        <Count
          name="differs"
          icon={EqualNot}
          tone="text-status-warning-foreground"
          label={ALIGNMENT_LABELS.differs}
          value={a.differs}
        />
        <Count
          name="pending"
          icon={CircleDashed}
          tone="text-muted-foreground"
          label={ALIGNMENT_LABELS.pending}
          value={a.pending}
        />
        <Count
          name="noPreference"
          icon={CircleMinus}
          tone="text-muted-foreground"
          label={ALIGNMENT_LABELS.noPreference}
          value={a.noPreference}
        />
      </dl>
      <p
        id="day-preference-alignment-partition"
        className="text-[0.6875rem] leading-snug text-muted-foreground"
      >
        {alignmentPartitionNote(a.rostered)}
      </p>
      <dl
        data-alignment="unassigned"
        className="flex flex-wrap items-baseline gap-x-1.5 border-t border-dashed pt-2 text-xs"
      >
        <dt className="text-muted-foreground">
          {ALIGNMENT_LABELS.unassigned}:
        </dt>
        <dd className="font-semibold tabular-nums">
          {faNumber(a.unassigned)} نفر
        </dd>
        <dd className="basis-full text-[0.6875rem] leading-snug text-muted-foreground">
          {ALIGNMENT_OVERLAP_NOTE}
        </dd>
      </dl>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {ALIGNMENT_ADVISORY_NOTE}
      </p>
    </section>
  );
}
