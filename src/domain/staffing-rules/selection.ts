import { compareIsoDates, type IsoDate } from "../shared/dates";
import { ValidationError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import type { RuleSetVersionHead } from "./model";

/**
 * Which version applies when (D105, D106). The effective state of a published
 * version is derived from its `effective_from`, its siblings and today; no
 * timer ever rewrites a status, so future and historical semantics survive.
 */

/** A version's state as people read it; only DRAFT/PUBLISHED/RETIRED are stored. */
export type EffectiveState =
  "DRAFT" | "SCHEDULED" | "EFFECTIVE" | "SUPERSEDED" | "RETIRED";

const isPublished = (
  v: RuleSetVersionHead,
): v is RuleSetVersionHead & { effectiveFrom: IsoDate } =>
  v.status === "PUBLISHED" && v.effectiveFrom !== null;

/**
 * The version of one lineage selected for `date`: the PUBLISHED version with
 * the latest `effective_from` on or before it. RETIRED and DRAFT versions are
 * never selected. Unambiguous because no two published versions of a lineage
 * share an `effective_from` (unique index).
 */
export function selectEffective(
  lineage: readonly RuleSetVersionHead[],
  date: IsoDate,
): RuleSetVersionHead | null {
  let selected: (RuleSetVersionHead & { effectiveFrom: IsoDate }) | null = null;
  for (const version of lineage) {
    if (!isPublished(version)) continue;
    if (compareIsoDates(version.effectiveFrom, date) > 0) continue;
    if (
      !selected ||
      compareIsoDates(version.effectiveFrom, selected.effectiveFrom) > 0
    )
      selected = version;
  }
  return selected;
}

/** The derived state of `version` within its lineage on `today`. */
export function effectiveState(
  version: RuleSetVersionHead,
  lineage: readonly RuleSetVersionHead[],
  today: IsoDate,
): EffectiveState {
  if (version.status === "DRAFT") return "DRAFT";
  if (version.status === "RETIRED") return "RETIRED";
  if (compareIsoDates(version.effectiveFrom!, today) > 0) return "SCHEDULED";
  return selectEffective(lineage, today)?.id === version.id
    ? "EFFECTIVE"
    : "SUPERSEDED";
}

/** `ValidationError.reason` when no published version covers a schedule's start. */
export const NO_EFFECTIVE_RULE_SET = "NO_EFFECTIVE_RULE_SET";

/**
 * The version a new schedule pins (D106): the Department Override effective
 * on `periodStart`, else the Hospital Default effective on it. A version that
 * becomes effective later in the period does not change the choice.
 */
export function selectForSchedule(input: {
  readonly department: readonly RuleSetVersionHead[];
  readonly hospital: readonly RuleSetVersionHead[];
  readonly periodStart: IsoDate;
}): Result<RuleSetVersionHead, ValidationError> {
  const selected =
    selectEffective(input.department, input.periodStart) ??
    selectEffective(input.hospital, input.periodStart);
  return selected
    ? ok(selected)
    : err(
        new ValidationError(
          "No published staffing rule set is effective on the period start",
          "periodStart",
          NO_EFFECTIVE_RULE_SET,
        ),
      );
}
