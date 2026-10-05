import { toDiagnostic } from "../../domain/rules/diagnostic";
import type { DayStaffingImpact } from "../../domain/rules/assess-change";
import type { Violation } from "../../domain/rules/violation";
import type { ScheduleChangeMode } from "../../domain/schedule/schedule-change";
import type { ScheduleStatus } from "../../domain/schedule/status";
import type { IsoDate } from "../../domain/shared/dates";
import type { DatePeriod } from "../../domain/shared/period";
import type { AssignmentCode } from "../../domain/shifts/shift-type";
import type { DbExecutor } from "../../infrastructure/db/database";
import { listDisplayNames } from "../../infrastructure/repositories/users";
import type { ActionError } from "../result";
import type { ReviewFinding } from "./review";
import type { AssignmentEdit } from "../../domain/schedule/assignment-editing";
import { findScheduleById } from "../../infrastructure/repositories/schedules";
import type { AppContext } from "../use-case";
import {
  previewScheduleAdjustment,
  type ChangePreview,
} from "./schedule-changes";

/**
 * A change preview as the screens show it: plain data (no domain objects
 * to rebuild on the client), people named, findings in the review's
 * `ReviewFinding` form so the existing Persian finding wording applies.
 */

export interface PreviewCell {
  readonly nurseId: string;
  readonly displayName: string;
  readonly date: IsoDate;
  readonly before: AssignmentCode | null;
  readonly after: AssignmentCode | null;
}

export type ChangePreviewView =
  | {
      readonly ok: true;
      /** Where the change goes (working copy, new revision, extended revision). */
      readonly mode: ScheduleChangeMode;
      /** The schedule status after it (REVISING when a revision is opened). */
      readonly targetStatus: ScheduleStatus;
      /** Days the revision scope would gain. */
      readonly addedRevisionDates: readonly IsoDate[];
      readonly cells: readonly PreviewCell[];
      /** New or worse hard findings on the changed cells: applying is blocked. */
      readonly blocking: readonly ReviewFinding[];
      /** New or worse soft findings: shown, never blocking. */
      readonly warnings: readonly ReviewFinding[];
      /** Findings already there on the changed cells, not made worse. */
      readonly persisting: readonly ReviewFinding[];
      readonly staffing: readonly DayStaffingImpact[];
      readonly blocked: boolean;
    }
  | { readonly ok: false; readonly error: ActionError };

/** Names the people of a preview (one query) and shapes it for the screens. */
export async function describePreview(
  db: DbExecutor,
  period: DatePeriod,
  preview: ChangePreview,
): Promise<ChangePreviewView> {
  if (!preview.ok) return preview;
  const { target, changes, assessment, staffing } = preview.evaluation;
  const findings = [
    ...assessment.blocking,
    ...assessment.warnings,
    ...assessment.persisting,
  ];
  const names = await listDisplayNames(db, [
    ...changes.map((c) => c.nurseId),
    ...findings.flatMap((v) => ("nurseId" in v ? [v.nurseId] : [])),
  ]);
  const named = (violations: readonly Violation[]): ReviewFinding[] =>
    violations.map((v) => {
      const diagnostic = toDiagnostic(v, period);
      return {
        ...diagnostic,
        nurses: diagnostic.nurseIds.map((userId) => ({
          userId,
          displayName: names.get(userId) ?? "—",
        })),
      };
    });
  return {
    ok: true,
    mode: target.mode,
    targetStatus: target.status,
    addedRevisionDates: target.addedRevisionDates,
    cells: changes.map((c) => ({
      ...c,
      displayName: names.get(c.nurseId) ?? "—",
    })),
    blocking: named(assessment.blocking),
    warnings: named(assessment.warnings),
    persisting: named(assessment.persisting),
    staffing,
    blocked: assessment.blocked,
  };
}

/**
 * The adjustment preview as the screens show it (Head Nurse of the
 * schedule's department only; anyone else gets NotFoundError).
 */
export async function getAdjustmentPreview(
  ctx: AppContext,
  input: { scheduleId: string; changes: readonly AssignmentEdit[] },
): Promise<ChangePreviewView> {
  const preview = await previewScheduleAdjustment(ctx, input);
  const schedule = (await findScheduleById(ctx.db, input.scheduleId))!;
  return describePreview(ctx.db, schedule.period, preview);
}
