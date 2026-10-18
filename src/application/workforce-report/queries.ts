import { z } from "zod";

import { decide } from "../../domain/authz/policies";
import { ValidationError } from "../../domain/shared/errors";
import { isInPeriod } from "../../domain/shared/period";
import { unwrap } from "../../domain/shared/result";
import {
  summarizeWorkforce,
  type WorkforcePersonSummary,
  type WorkforceSummary,
} from "../../domain/workforce-report/summary";
import { listAssignments } from "../../infrastructure/repositories/assignments";
import { listExportRoster } from "../../infrastructure/repositories/excel-templates";
import { findOpenRevision } from "../../infrastructure/repositories/revisions";
import {
  findScheduleById,
  type ScheduleRecord,
} from "../../infrastructure/repositories/schedules";
import {
  findVersionById,
  listVersionAssignments,
} from "../../infrastructure/repositories/versions";
import { ConflictError, NotFoundError } from "../errors";
import type { AppContext } from "../use-case";

export type WorkforceReportSource = "DEFAULT" | "REVISION_DRAFT";

export interface WorkforceReportInput {
  readonly departmentId: string;
  readonly scheduleId: string;
  readonly source: WorkforceReportSource;
}

export interface WorkforceApprovedVersion {
  readonly id: string;
  readonly versionNo: number;
  readonly approvedAt: Date;
}

/** The selected data, independently of the current schedule lifecycle status. */
export type WorkforceReportProvenance =
  | {
      readonly source: "WORKING_COPY";
      readonly isProvisional: true;
      readonly approvedVersion: null;
      readonly revisionId: null;
    }
  | {
      readonly source: "APPROVED_VERSION";
      readonly isProvisional: false;
      readonly approvedVersion: WorkforceApprovedVersion;
      readonly revisionId: null;
    }
  | {
      readonly source: "REVISION_DRAFT";
      readonly isProvisional: true;
      /** The official version this unapproved draft is revising. */
      readonly approvedVersion: WorkforceApprovedVersion;
      readonly revisionId: string;
    };

export interface WorkforceReportRow extends WorkforcePersonSummary {
  /** Current identity fields; the role remains the schedule roster's snapshot. */
  readonly displayName: string;
  readonly personnelNumber: string | null;
  readonly isActive: boolean;
}

export interface WorkforceReport extends Omit<WorkforceSummary, "rows"> {
  readonly schedule: Pick<
    ScheduleRecord,
    "id" | "departmentId" | "label" | "status" | "revision"
  >;
  readonly requestedSource: WorkforceReportSource;
  readonly provenance: WorkforceReportProvenance;
  readonly rows: readonly WorkforceReportRow[];
}

const identityInput = z.object({
  departmentId: z.uuid(),
  scheduleId: z.uuid(),
});
const sourceInput = z.enum(["DEFAULT", "REVISION_DRAFT"]);

/**
 * One schedule, one assignment source, one coherent snapshot (D126, D127).
 * No row locks or writes, including audit and notifications. Repository reads all
 * use the transaction handle; query count never grows per roster member.
 */
export async function getWorkforceReport(
  ctx: AppContext,
  input: WorkforceReportInput,
): Promise<WorkforceReport> {
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
        throw new ValidationError("Unknown workforce report source", "source");

      // Validate even for a draft request: a bad official pointer must never
      // become an excuse to disclose working data as an alternative.
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
        throw new ConflictError(
          "The approved version metadata is inconsistent",
          "WORKFORCE_APPROVED_VERSION_INCONSISTENT",
        );
      const approvedVersion: WorkforceApprovedVersion | null = version
        ? {
            id: version.id,
            versionNo: version.versionNo,
            approvedAt: version.approvedAt,
          }
        : null;

      let provenance: WorkforceReportProvenance;
      if (selected.data === "REVISION_DRAFT") {
        const revision = approvedVersion
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
            "WORKFORCE_REVISION_DRAFT_UNAVAILABLE",
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

      // listExportRoster is a complete historical roster projection, with no
      // active-account or membership filter. Never apply the exporter's filter.
      const roster = await listExportRoster(tx, schedule.id);
      const assignments =
        provenance.source === "APPROVED_VERSION"
          ? await listVersionAssignments(tx, provenance.approvedVersion.id)
          : await listAssignments(tx, schedule.id);
      const summary = unwrap(
        summarizeWorkforce({ period: schedule.period, roster, assignments }),
      );
      const identities = new Map(
        roster.map((member) => [member.userId, member]),
      );
      return {
        ...summary,
        schedule: {
          id: schedule.id,
          departmentId: schedule.departmentId,
          label: schedule.label,
          status: schedule.status,
          revision: schedule.revision,
        },
        requestedSource: selected.data,
        provenance,
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
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
