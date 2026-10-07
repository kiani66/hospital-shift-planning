import { ArrowLeft, Wrench } from "lucide-react";
import type { ReviewFinding } from "@/application/schedules/review";
import { Badge } from "@/components/ui/badge";
import {
  validationCategory,
  type ValidationCategory,
} from "@/domain/rules/validation-summary";
import { nurseRowId } from "@/features/schedule-editing/presentation";
import { ShiftChip } from "@/features/shifts/shift-chip";
import { cn } from "@/lib/utils";
import {
  findingCategoryLabel,
  RULE_TITLES,
  findingFacts,
  findingMessage,
  findingResolution,
  findingSeverityLabel,
} from "./presentation";

/** Who a finding is about; in the editor each name jumps to that nurse's row. */
export function FindingNurses({
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
export function FindingFacts({ finding }: { finding: ReviewFinding }) {
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
export function FindingItem({
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
