import { z } from "zod";

import { isIsoDate, type IsoDate } from "../../domain/shared/dates";
import { unwrap } from "../../domain/shared/result";
import {
  summarizeStaffing,
  type StaffingSummary,
} from "../../domain/staffing-report/summary";
import { validateRuleSetContent } from "../../domain/staffing-rules/model";
import type { Transaction } from "../../infrastructure/db/database";
import {
  findRuleSetVersion,
  loadRuleSetContent,
} from "../../infrastructure/repositories/staffing-rules";
import { NO_HOLIDAY_DATA } from "../calendar/holidays";
import { ConflictError } from "../errors";
import {
  withScheduleReportSnapshot,
  type ScheduleReportInput,
  type ScheduleReportMetadata,
  type ScheduleReportSource,
  type ScheduleReportProvenance,
} from "../reporting/schedule-snapshot";
import { holidayDates } from "../staffing-rules/pinned";
import type { AppContext } from "../use-case";

export type StaffingReportInput = ScheduleReportInput;
export type StaffingReportSource = ScheduleReportSource;
export type StaffingReportProvenance = ScheduleReportProvenance;

export interface StaffingReportRuleSet {
  readonly versionId: string;
  readonly ruleSetId: string;
  readonly versionNo: number;
  readonly scope: "HOSPITAL_DEFAULT" | "DEPARTMENT_OVERRIDE";
  readonly departmentId: string | null;
  readonly effectiveFrom: IsoDate;
  readonly status: "PUBLISHED" | "RETIRED";
}

export interface StaffingReport
  extends StaffingSummary, ScheduleReportMetadata {
  readonly ruleSet: StaffingReportRuleSet;
}

/** A pin may be retired or explicitly applied; never reselect by today's date. */
async function loadReportRuleSet(
  tx: Transaction,
  versionId: string,
  departmentId: string,
) {
  const inconsistent = () =>
    new ConflictError(
      "The staffing rule-set pin is inconsistent",
      "STAFFING_REPORT_RULE_SET_INCONSISTENT",
    );
  if (!z.uuid().safeParse(versionId).success) throw inconsistent();
  const version = await findRuleSetVersion(tx, versionId);
  if (
    !version ||
    version.id !== versionId ||
    (version.departmentId !== null && version.departmentId !== departmentId) ||
    (version.status !== "PUBLISHED" && version.status !== "RETIRED") ||
    !Number.isInteger(version.versionNo) ||
    version.versionNo < 1 ||
    !isIsoDate(version.effectiveFrom) ||
    !(version.publishedAt instanceof Date) ||
    !Number.isFinite(version.publishedAt.getTime())
  )
    throw inconsistent();
  const content = validateRuleSetContent(
    await loadRuleSetContent(tx, versionId),
  );
  if (!content.ok) throw inconsistent();
  const metadata: StaffingReportRuleSet = {
    versionId: version.id,
    ruleSetId: version.ruleSetId,
    versionNo: version.versionNo,
    scope:
      version.departmentId === null
        ? "HOSPITAL_DEFAULT"
        : "DEPARTMENT_OVERRIDE",
    departmentId: version.departmentId,
    effectiveFrom: version.effectiveFrom,
    status: version.status,
  };
  return { content: content.value, metadata };
}

/**
 * One authorized schedule, source and matching rule pin in one read-only snapshot.
 * No neighbouring schedules, locks, writes, audits, notifications or readiness.
 * Domain calculations stay in summarizeStaffing (D129).
 */
export async function getStaffingReport(
  ctx: AppContext,
  input: StaffingReportInput,
): Promise<StaffingReport> {
  return withScheduleReportSnapshot(
    ctx,
    input,
    {
      invalidSourceMessage: "Unknown staffing report source",
      approvedVersionReason: "STAFFING_APPROVED_VERSION_INCONSISTENT",
      revisionDraftReason: "STAFFING_REVISION_DRAFT_UNAVAILABLE",
    },
    async (tx, snapshot) => {
      const {
        schedule,
        version,
        revision,
        metadata,
        staffingRuleSetVersionId,
      } = snapshot;
      if (
        metadata.provenance.source === "REVISION_DRAFT" &&
        (!["REVISING", "SUBMITTED", "RETURNED"].includes(schedule.status) ||
          !revision ||
          !z.uuid().safeParse(revision.id).success ||
          revision.dates.some((date) => !isIsoDate(date)))
      )
        throw new ConflictError(
          "No eligible open revision draft exists",
          "STAFFING_REVISION_DRAFT_UNAVAILABLE",
        );
      const rules = await loadReportRuleSet(
        tx,
        staffingRuleSetVersionId,
        schedule.departmentId,
      );
      // An explicit draft also needs a valid official baseline, even when its pin differs.
      if (
        metadata.provenance.source === "REVISION_DRAFT" &&
        version!.staffingRuleSetVersionId !== staffingRuleSetVersionId
      )
        await loadReportRuleSet(
          tx,
          version!.staffingRuleSetVersionId,
          schedule.departmentId,
        );
      const officialHolidays = await holidayDates(
        ctx.holidays ?? NO_HOLIDAY_DATA,
        schedule.period,
      );
      const summary = unwrap(
        summarizeStaffing({
          period: schedule.period,
          roster: snapshot.roster,
          assignments: snapshot.assignments,
          ruleSet: rules.content,
          officialHolidays,
        }),
      );
      return { ...summary, ...metadata, ruleSet: rules.metadata };
    },
  );
}
