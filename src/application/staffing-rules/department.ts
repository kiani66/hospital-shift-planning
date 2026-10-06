import { decide } from "../../domain/authz/policies";
import type { ScheduleStatus } from "../../domain/schedule/status";
import type { IsoDate } from "../../domain/shared/dates";
import type { DatePeriod } from "../../domain/shared/period";
import { selectForSchedule } from "../../domain/staffing-rules/selection";
import { APP_TIMEZONE, todayIn } from "../../infrastructure/auth/actor";
import { findDepartmentById } from "../../infrastructure/repositories/departments";
import { listSchedulesForDepartment } from "../../infrastructure/repositories/schedules";
import {
  countApprovedVersionPins,
  listApplicableRuleSetVersions,
} from "../../infrastructure/repositories/staffing-rules";
import { listDisplayNames } from "../../infrastructure/repositories/users";
import { NotFoundError } from "../errors";
import type { AppContext } from "../use-case";
import { peopleOf, toVersionViews, type RuleSetVersionView } from "./queries";

/** One schedule of the department and the rule-set version it is pinned to. */
export interface DepartmentScheduleRules {
  readonly scheduleId: string;
  readonly label: string;
  readonly period: DatePeriod;
  readonly status: ScheduleStatus;
  readonly pinnedVersionId: string;
  /**
   * The version a new schedule with this period start would pin today (the
   * natural Apply target); null when it is already the pin.
   */
  readonly suggestedVersionId: string | null;
}

export interface DepartmentCoverageRules {
  readonly departmentId: string;
  readonly today: IsoDate;
  /** The department's override (if any) and the Hospital Default, newest first. Never drafts. */
  readonly versions: readonly RuleSetVersionView[];
  /** The version a schedule starting today would pin. */
  readonly effectiveVersionId: string | null;
  readonly schedules: readonly DepartmentScheduleRules[];
  /** The actor may preview / apply another version (Supervisor, Hospital Admin; D108). */
  readonly canApply: boolean;
  readonly names: ReadonlyMap<string, string>;
}

/**
 * The rule sets that apply to one department and its schedules' pins, read
 * only (D108 `staffingRules.view`: its Head Nurse, its Supervisors, a
 * Hospital Admin). Drafts are the Hospital Admin's work in progress and are
 * not listed here. Pin counts are this department's only, so nothing about
 * other departments is revealed. A constant number of queries.
 */
export async function getDepartmentCoverageRules(
  ctx: AppContext,
  input: { departmentId: string },
): Promise<DepartmentCoverageRules> {
  const department = await findDepartmentById(ctx.db, input.departmentId);
  if (
    !department ||
    !decide(ctx.actor, "staffingRules.view", { departmentId: department.id })
      .allowed
  )
    throw new NotFoundError("Department");
  const today = todayIn(APP_TIMEZONE, ctx.clock?.() ?? new Date());
  const [stored, schedules] = await Promise.all([
    listApplicableRuleSetVersions(ctx.db, department.id),
    listSchedulesForDepartment(ctx.db, department.id),
  ]);
  const published = stored.filter((v) => v.status !== "DRAFT");
  const approved = await countApprovedVersionPins(
    ctx.db,
    schedules.map((s) => s.id),
  );
  const versions = (await toVersionViews(ctx, published, today))
    .map((v) => ({
      ...v,
      // This department's schedules only (D26: no other department's data).
      pins: {
        schedules: schedules.filter((s) => s.staffingRuleSetVersionId === v.id)
          .length,
        approvedVersions: approved.get(v.id) ?? 0,
      },
    }))
    .sort(
      (a, b) =>
        Number(a.departmentId === null) - Number(b.departmentId === null) ||
        b.versionNo - a.versionNo,
    );
  const pick = (start: IsoDate) => {
    const selected = selectForSchedule({
      department: published.filter((v) => v.departmentId === department.id),
      hospital: published.filter((v) => v.departmentId === null),
      periodStart: start,
    });
    return selected.ok ? selected.value.id : null;
  };
  return {
    departmentId: department.id,
    today,
    versions,
    effectiveVersionId: pick(today),
    schedules: schedules
      .map((s) => {
        const suggested = pick(s.period.start);
        return {
          scheduleId: s.id,
          label: s.label,
          period: s.period,
          status: s.status,
          pinnedVersionId: s.staffingRuleSetVersionId,
          suggestedVersionId:
            suggested !== s.staffingRuleSetVersionId ? suggested : null,
        };
      })
      .reverse(),
    canApply: decide(ctx.actor, "staffingRules.applyToSchedule", {
      departmentId: department.id,
    }).allowed,
    names: await listDisplayNames(ctx.db, peopleOf(versions)),
  };
}
