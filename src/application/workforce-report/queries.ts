import { unwrap } from "../../domain/shared/result";
import {
  summarizeWorkforce,
  type WorkforcePersonSummary,
  type WorkforceSummary,
} from "../../domain/workforce-report/summary";
import {
  withScheduleReportSnapshot,
  type ScheduleReportInput,
  type ScheduleReportSource,
  type ScheduleReportProvenance,
  type ReportApprovedVersion,
  type ScheduleReportMetadata,
} from "../reporting/schedule-snapshot";
import type { AppContext } from "../use-case";

export type WorkforceReportSource = ScheduleReportSource;
export type WorkforceReportInput = ScheduleReportInput;
export type WorkforceApprovedVersion = ReportApprovedVersion;
export type WorkforceReportProvenance = ScheduleReportProvenance;

export interface WorkforceReportRow extends WorkforcePersonSummary {
  /** Current identity fields; the role remains the schedule roster's snapshot. */
  readonly displayName: string;
  readonly personnelNumber: string | null;
  readonly isActive: boolean;
}

export interface WorkforceReport
  extends Omit<WorkforceSummary, "rows">, ScheduleReportMetadata {
  readonly rows: readonly WorkforceReportRow[];
}

/** The workforce contract and errors remain D127; only snapshot loading is shared. */
export async function getWorkforceReport(
  ctx: AppContext,
  input: WorkforceReportInput,
): Promise<WorkforceReport> {
  return withScheduleReportSnapshot(
    ctx,
    input,
    {
      invalidSourceMessage: "Unknown workforce report source",
      approvedVersionReason: "WORKFORCE_APPROVED_VERSION_INCONSISTENT",
      revisionDraftReason: "WORKFORCE_REVISION_DRAFT_UNAVAILABLE",
    },
    async (_tx, { schedule, roster, assignments, metadata }) => {
      const summary = unwrap(
        summarizeWorkforce({ period: schedule.period, roster, assignments }),
      );
      const identities = new Map(
        roster.map((member) => [member.userId, member]),
      );
      return {
        ...summary,
        ...metadata,
        rows: summary.rows.map((row) => {
          const member = identities.get(row.userId)!;
          return {
            ...row,
            displayName: member.displayName,
            personnelNumber: member.personnelNumber,
            isActive: member.isActive,
          };
        }),
      };
    },
  );
}
