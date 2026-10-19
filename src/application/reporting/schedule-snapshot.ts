import { z } from "zod";

import { decide } from "../../domain/authz/policies";
import { ValidationError } from "../../domain/shared/errors";
import { isInPeriod } from "../../domain/shared/period";
import type { Assignment } from "../../domain/shifts/assignment";
import type { Transaction } from "../../infrastructure/db/database";
import { listAssignments } from "../../infrastructure/repositories/assignments";
import {
  listExportRoster,
  type ExportRosterEntry,
} from "../../infrastructure/repositories/excel-templates";
import {
  findOpenRevision,
  type RevisionRecord,
} from "../../infrastructure/repositories/revisions";
import {
  findScheduleById,
  type ScheduleRecord,
} from "../../infrastructure/repositories/schedules";
import {
  findVersionById,
  listVersionAssignments,
  type VersionRecord,
} from "../../infrastructure/repositories/versions";
import { ConflictError, NotFoundError } from "../errors";
import type { AppContext } from "../use-case";

export type ScheduleReportSource = "DEFAULT" | "REVISION_DRAFT";

export interface ScheduleReportInput {
  readonly departmentId: string;
  readonly scheduleId: string;
  readonly source: ScheduleReportSource;
}

export interface ReportApprovedVersion {
  readonly id: string;
  readonly versionNo: number;
  readonly approvedAt: Date;
}

export type ScheduleReportProvenance =
  | {
      readonly source: "WORKING_COPY";
      readonly isProvisional: true;
      readonly approvedVersion: null;
      readonly revisionId: null;
    }
  | {
      readonly source: "APPROVED_VERSION";
      readonly isProvisional: false;
      readonly approvedVersion: ReportApprovedVersion;
      readonly revisionId: null;
    }
  | {
      readonly source: "REVISION_DRAFT";
      readonly isProvisional: true;
      readonly approvedVersion: ReportApprovedVersion;
      readonly revisionId: string;
    };

export interface ScheduleReportMetadata {
  readonly schedule: Pick<
    ScheduleRecord,
    "id" | "departmentId" | "label" | "status" | "revision"
  >;
  readonly requestedSource: ScheduleReportSource;
  readonly provenance: ScheduleReportProvenance;
}

interface ScheduleReportSnapshot {
  readonly schedule: ScheduleRecord;
  readonly version: VersionRecord | null;
  readonly revision: RevisionRecord | null;
  readonly metadata: ScheduleReportMetadata;
  /** Matched to assignments here; report-specific code validates/loads the pin. */
  readonly staffingRuleSetVersionId: string;
  readonly assignments: readonly Assignment[];
  readonly roster: readonly ExportRosterEntry[];
}

interface ReportErrors {
  readonly invalidSourceMessage: string;
  readonly approvedVersionReason: string;
  readonly revisionDraftReason: string;
}

const identityInput = z.object({
  departmentId: z.uuid(),
  scheduleId: z.uuid(),
});
const sourceInput = z.enum(["DEFAULT", "REVISION_DRAFT"]);

/**
 * Small shared boundary for Head Nurse schedule reports (D127, D130). Authorize
 * before source validation, then read exactly one assignment source and the
 * complete historical roster in one read-only REPEATABLE READ snapshot. The
 * callback must use tx for additional reads, without starting another snapshot.
 * Report calculations, rule content, holidays and extra eligibility stay local
 * to the report. Error reasons remain report-specific, including D127's contract.
 */
export async function withScheduleReportSnapshot<T>(
  ctx: AppContext,
  input: ScheduleReportInput,
  errors: ReportErrors,
  read: (tx: Transaction, snapshot: ScheduleReportSnapshot) => Promise<T>,
): Promise<T> {
  const identity = identityInput.safeParse(input);
  if (
    !identity.success ||
    !decide(ctx.actor, "department.manage", {
      departmentId: identity.data.departmentId,
    }).allowed
  )
    throw new NotFoundError("Schedule");

  return ctx.db.transaction(
    async (tx) => {
      const schedule = await findScheduleById(tx, identity.data.scheduleId);
      if (!schedule || schedule.departmentId !== identity.data.departmentId)
        throw new NotFoundError("Schedule");
      const selected = sourceInput.safeParse(input.source);
      if (!selected.success)
        throw new ValidationError(errors.invalidSourceMessage, "source");

      const inconsistentVersion = () =>
        new ConflictError(
          "The approved version metadata is inconsistent",
          errors.approvedVersionReason,
        );
      if (
        schedule.currentVersionId !== null &&
        !z.uuid().safeParse(schedule.currentVersionId).success
      )
        throw inconsistentVersion();
      const version = schedule.currentVersionId
        ? await findVersionById(tx, schedule.currentVersionId)
        : null;
      if (
        schedule.currentVersionId !== null &&
        (!version ||
          version.id !== schedule.currentVersionId ||
          version.scheduleId !== schedule.id ||
          !Number.isInteger(version.versionNo) ||
          version.versionNo < 1 ||
          !(version.approvedAt instanceof Date) ||
          !Number.isFinite(version.approvedAt.getTime()))
      )
        throw inconsistentVersion();
      const approvedVersion: ReportApprovedVersion | null = version
        ? {
            id: version.id,
            versionNo: version.versionNo,
            approvedAt: version.approvedAt,
          }
        : null;

      let revision: RevisionRecord | null = null;
      let provenance: ScheduleReportProvenance;
      if (selected.data === "REVISION_DRAFT") {
        revision = approvedVersion
          ? await findOpenRevision(tx, schedule.id)
          : null;
        if (
          !approvedVersion ||
          !revision ||
          revision.scheduleId !== schedule.id ||
          revision.status !== "OPEN" ||
          revision.dates.some((date) => !isInPeriod(schedule.period, date))
        )
          throw new ConflictError(
            "No eligible open revision draft exists",
            errors.revisionDraftReason,
          );
        provenance = {
          source: "REVISION_DRAFT",
          isProvisional: true,
          approvedVersion,
          revisionId: revision.id,
        };
      } else {
        provenance = approvedVersion
          ? {
              source: "APPROVED_VERSION",
              isProvisional: false,
              approvedVersion,
              revisionId: null,
            }
          : {
              source: "WORKING_COPY",
              isProvisional: true,
              approvedVersion: null,
              revisionId: null,
            };
      }

      // No active-account, current-membership or exporter eligibility filters.
      const roster = await listExportRoster(tx, schedule.id);
      const assignments =
        provenance.source === "APPROVED_VERSION"
          ? await listVersionAssignments(tx, provenance.approvedVersion.id)
          : await listAssignments(tx, schedule.id);
      return read(tx, {
        schedule,
        version,
        revision,
        roster,
        assignments,
        staffingRuleSetVersionId:
          provenance.source === "APPROVED_VERSION"
            ? version!.staffingRuleSetVersionId
            : schedule.staffingRuleSetVersionId,
        metadata: {
          schedule: {
            id: schedule.id,
            departmentId: schedule.departmentId,
            label: schedule.label,
            status: schedule.status,
            revision: schedule.revision,
          },
          requestedSource: selected.data,
          provenance,
        },
      });
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
