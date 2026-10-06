import type { StaffingRequirement } from "../../domain/rules/staffing";
import type { IsoDate } from "../../domain/shared/dates";
import type { DatePeriod } from "../../domain/shared/period";
import type { RuleSetContent } from "../../domain/staffing-rules/model";
import { resolveRequirements } from "../../domain/staffing-rules/resolve";
import type { DbExecutor } from "../../infrastructure/db/database";
import {
  findRuleSetVersion,
  loadRuleSetContent,
  type RuleSetVersionRecord,
} from "../../infrastructure/repositories/staffing-rules";
import type { HolidayCalendar } from "../calendar/holidays";

/** A rule-set version with its content (what validation reads). */
export interface LoadedRuleSet {
  readonly version: RuleSetVersionRecord;
  readonly content: RuleSetContent;
}

/**
 * Loads one rule-set version and its content (three small queries, run one
 * after another: `db` may be a command's transaction client, which must not
 * run queries concurrently). Used for a schedule's pin (D106) and for an
 * Apply target.
 */
export async function loadRuleSet(
  db: DbExecutor,
  versionId: string,
): Promise<LoadedRuleSet> {
  const version = await findRuleSetVersion(db, versionId);
  const content = await loadRuleSetContent(db, versionId);
  // The pin is a foreign key, so a missing version is a broken invariant.
  if (!version) throw new Error(`Rule set version ${versionId} not found`);
  return { version, content };
}

/** The official holidays of `period` as a set of days (D41: none until a source exists). */
export async function holidayDates(
  holidays: HolidayCalendar,
  period: DatePeriod,
): Promise<ReadonlySet<IsoDate>> {
  return new Set(
    (await holidays.listOfficialHolidays(period)).map((h) => h.date),
  );
}

/** The staffing requirement of each day under one version (Exception > Holiday > Normal). */
export const requirementsUnder = (
  ruleSet: LoadedRuleSet,
  dates: readonly IsoDate[],
  holidays: ReadonlySet<IsoDate>,
): ReadonlyMap<IsoDate, StaffingRequirement> =>
  resolveRequirements(ruleSet.content, dates, holidays);
