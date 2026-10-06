import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CircleAlert,
  Equal,
  Eye,
  Info,
  Link2,
  Lock,
  Pencil,
  Users,
  Wrench,
} from "lucide-react";
import type { ReactNode } from "react";

import type {
  DayReview,
  ReviewFinding,
  ReviewNurse,
  ReviewShift,
} from "@/application/schedules/review";
import { Badge } from "@/components/ui/badge";
import { Callout } from "@/components/ui/callout";
import { IconWell } from "@/components/ui/icon-well";
import { summarizePreferenceAlignment } from "@/domain/preferences/preference-alignment";
import {
  validationCategory,
  type ValidationCategory,
} from "@/domain/rules/validation-summary";
import type { AssignmentCode } from "@/domain/shifts/shift-type";
import { faNumber } from "@/features/calendar/jalali";
import {
  editDenialLabel,
  nurseRowId,
} from "@/features/schedule-editing/presentation";
import { ROLE_LABELS } from "@/features/schedule/labels";
import {
  COVERAGE_PERIOD_NAMES,
  SHIFT_PRESENTATION,
  shiftHoursLabel,
} from "@/features/shifts/catalog";
import { ShiftChip } from "@/features/shifts/shift-chip";
import { cn } from "@/lib/utils";

import { DayStateBadge, DayStateIcon } from "./day-state-icon";
import { NurseAvatar } from "./nurse-avatar";
import {
  PreferenceAlignmentSummary,
  PreferenceContext,
} from "./preference-alignment";
import {
  CATEGORY_LABELS,
  DAY_STATE_PRESENTATION,
  HOLIDAY_LABEL,
  findingCategoryLabel,
  RULE_TITLES,
  STAFFING_NOT_EVALUATED,
  findingFacts,
  findingMessage,
  findingResolution,
  findingSeverityLabel,
  staffingBoundsLabel,
  staffingIndicator,
  staffingIndicatorLabel,
  type StaffingIndicator,
} from "./presentation";

/**
 * The day's state, every open category, holiday and edit mode as
 * independent badges (icon + text): no category hides another (D103).
 */
export function DayBadges({ day }: { day: DayReview }) {
  const v = day.validation;
  const categories: [
    number,
    string,
    "destructive" | "attention" | "unplanned",
  ][] = [
    [v.ruleViolations, CATEGORY_LABELS.ruleViolation, "destructive"],
    [v.shortages, CATEGORY_LABELS.shortage, "attention"],
    [v.overstaffing, CATEGORY_LABELS.overstaffing, "attention"],
    [v.undecided, CATEGORY_LABELS.undecided, "unplanned"],
  ];
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <DayStateBadge state={v.state} />
      {categories
        .filter(([n]) => n > 0)
        .map(([n, label, tone]) => (
          <Badge key={label} tone={tone} size="sm">
            <span className="font-semibold tabular-nums">{faNumber(n)}</span>
            {label}
          </Badge>
        ))}
      {day.holiday && (
        <Badge tone="holiday">
          {HOLIDAY_LABEL}: {day.holiday.name}
        </Badge>
      )}
      {day.edit.allowed ? (
        <Badge tone="neutral" icon={Pencil}>
          قابل ویرایش
        </Badge>
      ) : (
        <Badge tone="muted" icon={Eye}>
          فقط مشاهده
        </Badge>
      )}
    </span>
  );
}

/** Who a finding is about; in the editor each name jumps to that nurse's row. */
function FindingNurses({
  finding,
  linked,
}: {
  finding: ReviewFinding;
  linked: boolean;
}) {
  return (
    <span className="flex flex-wrap gap-x-2">
      {finding.nurses.map((n) =>
        linked ? (
          <a
            key={n.userId}
            href={`#${nurseRowId(n.userId)}`}
            className="rounded-sm font-semibold underline decoration-health-attention decoration-dotted underline-offset-4 hover:decoration-solid focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none"
          >
            {n.displayName}
          </a>
        ) : (
          <span key={n.userId} className="font-semibold">
            {n.displayName}
          </span>
        ),
      )}
    </span>
  );
}

/** When and which shift, as a short chain: "شب · چهارشنبه ۶ آبان ← صبح · پنجشنبه ۷ آبان". */
function FindingFacts({ finding }: { finding: ReviewFinding }) {
  const facts = findingFacts(finding);
  return (
    <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
      {facts.map((fact, i) => (
        <span key={fact.date} className="inline-flex items-center gap-1.5">
          {i > 0 && (
            // Points along the reading direction (left in RTL).
            <ArrowLeft
              aria-hidden="true"
              className="size-3.5 text-muted-foreground ltr:-scale-x-100"
            />
          )}
          {fact.shift && <ShiftChip code={fact.shift} size="xs" />}
          <span>{fact.dateLabel}</span>
        </span>
      ))}
    </span>
  );
}

/**
 * One finding, scannable: rule and severity, then who, when and which
 * shift, the plain-Persian explanation, and how to resolve it.
 */
function FindingItem({
  finding,
  linked,
}: {
  finding: ReviewFinding;
  linked: boolean;
}) {
  return (
    <li
      data-category={validationCategory(finding.violation)}
      className={cn(
        "flex flex-col gap-1.5 rounded-lg border border-s-3 bg-background p-3 shadow-xs",
        CATEGORY_EDGE[validationCategory(finding.violation)],
      )}
    >
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold">
        {RULE_TITLES[finding.code]}
        <Badge
          tone={CATEGORY_TONE[validationCategory(finding.violation)]}
          size="sm"
        >
          {findingCategoryLabel(finding)} · {findingSeverityLabel(finding)}
        </Badge>
      </p>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <FindingNurses finding={finding} linked={linked} />
        <FindingFacts finding={finding} />
      </p>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {findingMessage(finding)}
      </p>
      <p className="flex items-start gap-1.5 text-xs leading-relaxed font-medium">
        <Wrench
          aria-hidden="true"
          className="mt-0.5 size-3.5 shrink-0 text-primary"
        />
        {findingResolution(finding)}
      </p>
    </li>
  );
}

const CATEGORY_TONE = {
  RULE_VIOLATION: "destructive",
  COVERAGE: "attention",
  UNDECIDED: "unplanned",
} as const satisfies Record<ValidationCategory, string>;

const CATEGORY_EDGE: Record<ValidationCategory, string> = {
  RULE_VIOLATION: "border-destructive/30 border-s-destructive",
  COVERAGE: "border-health-attention/30 border-s-health-attention",
  UNDECIDED: "border-health-unplanned/30 border-s-health-unplanned",
};

/** The categories in the order the day lists them (severity first, D103). */
const CATEGORY_SECTIONS: readonly {
  category: ValidationCategory;
  title: string;
}[] = [
  { category: "RULE_VIOLATION", title: "نقض قوانین" },
  { category: "COVERAGE", title: "مشکلات پوشش" },
  { category: "UNDECIDED", title: "تصمیم‌های تعیین‌نشده" },
];

/**
 * The day's findings, first, grouped by category (D102): rule violations,
 * coverage problems and undecided decisions are separate sections and an
 * undecided nurse-day is never called a conflict. A READY or NOT STARTED day
 * without findings shows one quiet line saying what its state means.
 */
function Findings({ day, linked }: { day: DayReview; linked: boolean }) {
  const state = day.validation.state;
  if (day.findings.length === 0)
    return (
      <p
        role="note"
        data-state={state}
        className={cn(
          "flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm leading-relaxed",
          state === "READY"
            ? "border-health-valid/25 bg-health-valid/5"
            : "bg-muted/60 text-muted-foreground",
        )}
      >
        <DayStateIcon state={state} className="mt-0.5" />
        {DAY_STATE_PRESENTATION[state].description}
      </p>
    );
  return (
    <div className="flex flex-col gap-3">
      {state === "NOT_STARTED" && (
        <p
          role="note"
          className="flex items-start gap-2 rounded-lg border bg-muted/60 px-3 py-2.5 text-sm leading-relaxed text-muted-foreground"
        >
          <DayStateIcon state="NOT_STARTED" className="mt-0.5" />
          {DAY_STATE_PRESENTATION.NOT_STARTED.description}
        </p>
      )}
      {CATEGORY_SECTIONS.map(({ category, title }) => {
        const findings = day.findings.filter(
          (f) => validationCategory(f.violation) === category,
        );
        if (findings.length === 0) return null;
        const id = `day-findings-${category.toLowerCase()}`;
        return (
          <section
            key={category}
            aria-labelledby={id}
            data-category={category}
            className="flex flex-col gap-2 rounded-xl border bg-card p-3"
          >
            <h3
              id={id}
              className="flex items-center gap-2 text-sm font-semibold"
            >
              <DayStateIcon state={category} />
              {title}
              <span className="font-normal tabular-nums">
                ({faNumber(findings.length)} مورد)
              </span>
            </h3>
            {category === "UNDECIDED" && state === "NOT_STARTED" ? (
              <p className="text-xs leading-relaxed text-muted-foreground">
                برای {faNumber(findings.length)} نفر از پرسنل هنوز تصمیمی ثبت
                نشده است.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {findings.map((f, i) => (
                  <FindingItem
                    key={`${f.code}-${f.nurseIds.join()}-${i}`}
                    finding={f}
                    linked={linked}
                  />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

/**
 * Findings reported on the neighbouring day that involve this one (the
 * Night before a violating shift), so either day explains the conflict.
 */
function RelatedFindings({ day, linked }: { day: DayReview; linked: boolean }) {
  if (day.relatedFindings.length === 0) return null;
  return (
    <section
      aria-labelledby="day-related-findings"
      className="flex flex-col gap-2 rounded-xl border border-dashed border-health-attention/45 bg-card p-3"
    >
      <h3
        id="day-related-findings"
        className="flex items-center gap-2 text-sm font-semibold"
      >
        <IconWell tone="muted">
          <Link2 />
        </IconWell>
        مرتبط با روز دیگر ({faNumber(day.relatedFindings.length)} مورد)
      </h3>
      <ul className="flex flex-col gap-2">
        {day.relatedFindings.map((f, i) => (
          <li
            key={`${f.code}-${f.nurseIds.join()}-${i}`}
            className="flex flex-col gap-1 text-sm"
          >
            <span className="font-medium">{RULE_TITLES[f.code]}</span>
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <FindingNurses finding={f} linked={linked} />
              <FindingFacts finding={f} />
            </span>
            <span className="text-xs leading-relaxed text-muted-foreground">
              {findingMessage(f)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A period's staffing status: icon + words, never color alone and never green. */
function StaffingMark({ indicator }: { indicator: StaffingIndicator }) {
  const style = {
    NOT_EVALUATED: { icon: Info, className: "text-muted-foreground" },
    WITHIN: { icon: Equal, className: "text-muted-foreground" },
    SHORTAGE: {
      icon: ArrowDown,
      className: "font-medium text-health-attention-foreground",
    },
    EXCESS: {
      icon: ArrowUp,
      className: "font-medium text-status-warning-foreground",
    },
  }[indicator.kind];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[0.6875rem] leading-snug",
        style.className,
      )}
    >
      <style.icon aria-hidden="true" className="size-3 shrink-0" />
      {staffingIndicatorLabel(indicator)}
    </span>
  );
}

/** Where the day's bounds came from inside the pinned version (D106). */
const SOURCE_LABELS = {
  NORMAL: null,
  HOLIDAY: "قانون روز تعطیل",
  EXCEPTION: "استثنای این تاریخ",
} as const;

/**
 * Coverage per bucket (ME counts toward M and E, OFF toward none) against the
 * bounds of the schedule's pinned rule-set version (D106): count, required
 * range, and a shortage or overstaffing mark with its amount. A bucket within
 * bounds stays neutral (no green, no check).
 */
export function CoverageSummary({ day }: { day: DayReview }) {
  const evaluated = day.coverage.some((c) => c.status !== "NOT_CONFIGURED");
  return (
    <section
      aria-labelledby="day-coverage"
      className="flex flex-col gap-2 rounded-xl border bg-card p-3 shadow-xs"
    >
      <h3
        id="day-coverage"
        className="flex items-center gap-2 text-sm font-semibold"
      >
        <IconWell>
          <Users />
        </IconWell>
        پوشش نفرات
      </h3>
      <ul className="grid grid-cols-3 gap-2">
        {day.coverage.map((c) => {
          const direct = day.shifts.find((s) => s.code === c.period)!.nurses
            .length;
          const fromLong = c.covered - direct;
          const indicator = staffingIndicator(c);
          const source = SOURCE_LABELS[c.source];
          return (
            <li
              key={c.period}
              data-period={c.period}
              data-staffing={indicator.kind}
              className={cn(
                "flex min-w-0 flex-col gap-0.5 rounded-lg px-2 py-1.5",
                SHIFT_PRESENTATION[c.period].softClass,
              )}
            >
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <span
                  dir="ltr"
                  className={cn(
                    "font-bold",
                    SHIFT_PRESENTATION[c.period].accentClass,
                  )}
                >
                  {c.period}
                </span>
                پوشش {COVERAGE_PERIOD_NAMES[c.period]}
              </span>
              <span className="text-lg leading-tight font-semibold tabular-nums">
                {faNumber(c.covered)}{" "}
                <span className="text-xs font-normal text-muted-foreground">
                  نفر
                </span>
              </span>
              {fromLong > 0 && (
                <span className="text-[0.6875rem] leading-snug text-muted-foreground">
                  {faNumber(fromLong)} نفر از شیفت طولانی
                </span>
              )}
              {evaluated && c.bounds && (
                <span className="text-[0.6875rem] leading-snug text-muted-foreground tabular-nums">
                  {staffingBoundsLabel(c.bounds)}
                </span>
              )}
              {source && (
                <span className="text-[0.6875rem] leading-snug text-muted-foreground">
                  {source}
                </span>
              )}
              {evaluated && <StaffingMark indicator={indicator} />}
            </li>
          );
        })}
      </ul>
      {!evaluated && (
        <p
          role="note"
          className="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground"
        >
          <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          {STAFFING_NOT_EVALUATED}
        </p>
      )}
    </section>
  );
}

function ReadOnlyNurseRow({
  nurse,
  shift,
  flagged,
}: {
  nurse: ReviewNurse;
  shift: AssignmentCode | null;
  flagged: boolean;
}) {
  return (
    <li className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 py-1.5">
      <NurseAvatar displayName={nurse.displayName} />
      <span
        title={nurse.displayName}
        className="max-w-full min-w-0 truncate text-sm"
      >
        {nurse.displayName}
      </span>
      {nurse.role === "HEAD_NURSE" && (
        <Badge tone="muted" size="sm">
          {ROLE_LABELS.HEAD_NURSE}
        </Badge>
      )}
      {flagged && (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-destructive">
          <CircleAlert aria-hidden="true" className="size-3.5" />
          {CATEGORY_LABELS.ruleViolation}
        </span>
      )}
      {nurse.preference && (
        <span className="ms-auto min-w-0">
          <PreferenceContext preference={nurse.preference} shift={shift} />
        </span>
      )}
    </li>
  );
}

function ShiftSection({
  shift,
  flagged,
}: {
  shift: ReviewShift;
  flagged: ReadonlySet<string>;
}) {
  const p = SHIFT_PRESENTATION[shift.code];
  const id = `shift-${shift.code}`;
  return (
    <section
      aria-labelledby={id}
      className="flex min-w-0 flex-col gap-1 rounded-xl border bg-card p-3 shadow-xs"
    >
      <h3 id={id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <ShiftChip code={shift.code} size="md" />
        <span className="font-semibold">{p.fullName}</span>
        <span className="text-xs text-muted-foreground">
          {shiftHoursLabel(shift.code)}
        </span>
        <span className="ms-auto text-sm font-semibold whitespace-nowrap tabular-nums">
          {faNumber(shift.nurses.length)} نفر
        </span>
      </h3>
      {shift.nurses.length === 0 ? (
        <p className="py-1 text-sm text-muted-foreground">
          کسی برای این شیفت ثبت نشده است.
        </p>
      ) : (
        <ul aria-label={`پرستاران شیفت ${p.name}`} className="divide-y">
          {shift.nurses.map((n) => (
            <ReadOnlyNurseRow
              key={n.userId}
              nurse={n}
              shift={shift.code}
              flagged={flagged.has(n.userId)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/** Everyone a finding of this day (or one involving it) is about. */
export const flaggedNurses = (day: DayReview): ReadonlySet<string> =>
  new Set([...day.findings, ...day.relatedFindings].flatMap((f) => f.nurseIds));

/**
 * Layer 2: one day. A side column (first on phones) says what the day's
 * state is: why it is locked, its findings with who / when / how to fix,
 * related findings and coverage. The main column is the work: with
 * `editor` (the Head Nurse may edit this day) the editing list of every
 * rostered nurse; otherwise the four shifts with their nurses and who has
 * no shift, read-only.
 */
export function DayDetail({
  day,
  editor,
  adjustment,
  directSwap,
}: {
  day: DayReview;
  editor?: ReactNode;
  /** Phase 9: the Head Nurse's operational adjustment, where the editor cannot act. */
  adjustment?: ReactNode;
  directSwap?: ReactNode;
}) {
  const flagged = flaggedNurses(day);
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:items-start">
      <div className="flex min-w-0 flex-col gap-3">
        {!day.edit.allowed && (
          <Callout tone="muted" icon={Lock}>
            {editDenialLabel(day.edit.reason)}
          </Callout>
        )}
        {adjustment}
        {directSwap}
        <Findings day={day} linked={!!editor} />
        <RelatedFindings day={day} linked={!!editor} />
        <CoverageSummary day={day} />
        <PreferenceAlignmentSummary
          alignment={summarizePreferenceAlignment(day.roster)}
        />
      </div>

      <div className="min-w-0">
        {editor ?? (
          <div className="flex flex-col gap-3">
            <div className="grid gap-3 xl:grid-cols-2">
              {day.shifts.map((shift) => (
                <ShiftSection
                  key={shift.code}
                  shift={shift}
                  flagged={flagged}
                />
              ))}
            </div>
            <details className="rounded-xl border bg-card shadow-xs">
              <summary className="min-h-11 cursor-pointer px-3 py-3 text-sm font-medium focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none">
                استراحت ({faNumber(day.off.length)} نفر)
              </summary>
              <ul className="divide-y border-t px-3">
                {day.off.map((n) => (
                  <ReadOnlyNurseRow
                    key={n.userId}
                    nurse={n}
                    shift="OFF"
                    flagged={flagged.has(n.userId)}
                  />
                ))}
              </ul>
            </details>
            <details className="rounded-xl border bg-card shadow-xs">
              <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-3 text-sm font-medium focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none">
                <Users
                  aria-hidden="true"
                  className="size-4 text-muted-foreground"
                />
                تعیین‌نشده در این روز ({faNumber(day.unassigned.length)} نفر)
              </summary>
              {day.unassigned.length === 0 ? (
                <p className="border-t px-3 py-2 text-sm text-muted-foreground">
                  برای همه پرسنل این روز تصمیم ثبت شده است.
                </p>
              ) : (
                <ul className="divide-y border-t px-3">
                  {day.unassigned.map((n) => (
                    <ReadOnlyNurseRow
                      key={n.userId}
                      nurse={n}
                      shift={null}
                      flagged={flagged.has(n.userId)}
                    />
                  ))}
                </ul>
              )}
            </details>
          </div>
        )}
      </div>
    </div>
  );
}
