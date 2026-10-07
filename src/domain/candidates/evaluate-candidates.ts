import { preferenceFit } from "../preferences/preference-fit";
import type { StaffingRequirement } from "../rules/staffing";
import type { Violation } from "../rules/violation";
import { assessEdits } from "../schedule/assess-edits";
import type { IsoDate } from "../shared/dates";
import { ValidationError } from "../shared/errors";
import { isInPeriod, type DatePeriod } from "../shared/period";
import { err, ok, type Result } from "../shared/result";
import type { Assignment } from "../shifts/assignment";
import {
  COVERAGE_PERIODS,
  isWorkingShift,
  type AssignmentCode,
  type BaseShift,
  type PreferenceValue,
} from "../shifts/shift-type";

/**
 * Candidate Recommendation V1 (D111): who could fill a coverage shortage.
 * Pure: the caller supplies the qualified universe and the loaded context;
 * nothing here reads data, authorizes, writes or knows the time.
 */

/**
 * The shift offered for a shortage: the coverage period's own code
 * (Morning → M, Evening → E, Night → N). ME is never a candidate target.
 */
export type CandidateShift = BaseShift;

export const isCandidateShift = (value: unknown): value is CandidateShift =>
  typeof value === "string" &&
  (COVERAGE_PERIODS as readonly string[]).includes(value);

/** A candidate's decision on the target day, in priority order (no row first). */
export const CANDIDATE_DAY_STATUSES = ["UNASSIGNED", "OFF_ASSIGNMENT"] as const;
export type CandidateDayStatus = (typeof CANDIDATE_DAY_STATUSES)[number];

/** The stored wish compared with the candidate shift, in priority order. */
export const CANDIDATE_PREFERENCES = [
  "SAME_SHIFT",
  "NONE",
  "DIFFERENT_SHIFT",
  "OFF_PREFERENCE",
] as const;
export type CandidatePreference = (typeof CANDIDATE_PREFERENCES)[number];

/**
 * The target-day status of a nurse, or null when they already work that day
 * (M, E, N or ME): such a nurse is no candidate at all, V1 never reshuffles.
 */
export function candidateDayStatus(
  current: AssignmentCode | null,
): CandidateDayStatus | null {
  if (current === null) return "UNASSIGNED";
  return isWorkingShift(current) ? null : "OFF_ASSIGNMENT";
}

/**
 * The wish compared by exact code with the candidate shift, as
 * `preferenceFit` compares a wish with an assignment: ME is a different
 * shift from M and from E. A preference never blocks anything (D35).
 */
export function candidatePreference(
  shift: CandidateShift,
  preference: PreferenceValue | null,
): CandidatePreference {
  const fit = preferenceFit(preference, shift);
  if (fit === "NONE") return "NONE";
  if (fit === "MATCHES") return "SAME_SHIFT";
  return preference === "OFF" ? "OFF_PREFERENCE" : "DIFFERENT_SHIFT";
}

interface CandidateBase {
  readonly nurseId: string;
  readonly dayStatus: CandidateDayStatus;
  readonly preference: CandidatePreference;
}

/** Passes the hard-rule assessment: may be assigned the candidate shift. */
export interface AvailableCandidate extends CandidateBase {
  readonly group: "AVAILABLE";
  /** The nurse's explicit OFF decision would be replaced (confirmed in the UI). */
  readonly requiresOffReplacement: boolean;
}

/** In the universe, but the hypothetical assignment breaks existing hard rules. */
export interface NotAllowedCandidate extends CandidateBase {
  readonly group: "NOT_ALLOWED";
  /** The new or worse blocking findings of the assignment, as the validator reports them. */
  readonly blocking: readonly Violation[];
}

export type Candidate = AvailableCandidate | NotAllowedCandidate;

export interface CandidateEvaluation {
  readonly date: IsoDate;
  readonly shift: CandidateShift;
  /** Day status, then preference, then nurse id. */
  readonly available: readonly AvailableCandidate[];
  /** Nurse id only. */
  readonly notAllowed: readonly NotAllowedCandidate[];
}

export interface CandidateEvaluationInput {
  readonly period: DatePeriod;
  readonly date: IsoDate;
  readonly shift: CandidateShift;
  /**
   * The candidate universe, already qualified by the caller: on the roster,
   * with an active account and a membership effective on `date` (D111).
   * Repeated ids count once.
   */
  readonly nurseIds: readonly string[];
  /** The schedule's working copy (the same baseline for every candidate). */
  readonly assignments: readonly Assignment[];
  /**
   * The neighbouring schedules' assignments for the whole universe, the
   * night-rest context across the period boundary (D7, D20).
   */
  readonly adjacentAssignments: readonly Assignment[];
  /** The pinned rule-set version's bounds (D106). */
  readonly staffingRequirements: ReadonlyMap<IsoDate, StaffingRequirement>;
  /** Each nurse's stored preference for `date`; absent means none (D35). */
  readonly preferences: ReadonlyMap<string, PreferenceValue>;
}

/**
 * `users.id` ascending: plain code-unit order, never locale-dependent. For
 * canonical (lower-case) UUIDs this is PostgreSQL's `uuid` order.
 */
export const compareCandidateIds = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;

const rank =
  <T extends string>(order: readonly T[]) =>
  (a: T, b: T): number =>
    order.indexOf(a) - order.indexOf(b);
const byDayStatus = rank<CandidateDayStatus>(CANDIDATE_DAY_STATUSES);
const byPreference = rank<CandidatePreference>(CANDIDATE_PREFERENCES);

/** Available order: day status, then preference, then nurse id. No score. */
export const compareAvailableCandidates = (
  a: AvailableCandidate,
  b: AvailableCandidate,
): number =>
  byDayStatus(a.dayStatus, b.dayStatus) ||
  byPreference(a.preference, b.preference) ||
  compareCandidateIds(a.nurseId, b.nurseId);

/**
 * Evaluates every nurse of the universe for the candidate shift on `date`:
 * nurses already working that day are left out; each other nurse is assessed
 * on their own as the hypothetical single-cell change "nurse → shift" (an OFF
 * decision replaced) against the same unchanged baseline, with the shared
 * hard-rule assessment (`assessEdits`, D111). Blocked → Not Allowed with the
 * blocking findings; otherwise Available.
 *
 * Refuses a target that is not a candidate shift or a date outside the period.
 */
export function evaluateCandidates(
  input: CandidateEvaluationInput,
): Result<CandidateEvaluation, ValidationError> {
  const { period, date, shift } = input;
  if (!isCandidateShift(shift))
    return err(
      new ValidationError("The candidate shift must be M, E or N", "shift"),
    );
  if (!isInPeriod(period, date))
    return err(
      new ValidationError("The date is outside the schedule period", "date"),
    );

  const current = new Map<string, AssignmentCode>();
  for (const a of input.assignments)
    if (a.date === date) current.set(a.nurseId, a.shift);

  const available: AvailableCandidate[] = [];
  const notAllowed: NotAllowedCandidate[] = [];
  for (const nurseId of new Set(input.nurseIds)) {
    const dayStatus = candidateDayStatus(current.get(nurseId) ?? null);
    if (dayStatus === null) continue;
    const preference = candidatePreference(
      shift,
      input.preferences.get(nurseId) ?? null,
    );
    const { assessment } = assessEdits({
      period,
      assignments: input.assignments,
      edits: [{ nurseId, date, shift }],
      adjacentAssignments: input.adjacentAssignments,
      staffingRequirements: input.staffingRequirements,
    });
    if (assessment.blocked)
      notAllowed.push({
        group: "NOT_ALLOWED",
        nurseId,
        dayStatus,
        preference,
        blocking: assessment.blocking,
      });
    else
      available.push({
        group: "AVAILABLE",
        nurseId,
        dayStatus,
        preference,
        requiresOffReplacement: dayStatus === "OFF_ASSIGNMENT",
      });
  }

  return ok({
    date,
    shift,
    available: available.sort(compareAvailableCandidates),
    notAllowed: notAllowed.sort((a, b) =>
      compareCandidateIds(a.nurseId, b.nurseId),
    ),
  });
}
