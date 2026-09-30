import type { StaffingRequirement } from "../../domain/rules/staffing";
import type { IsoDate } from "../../domain/shared/dates";

/**
 * Where staffing requirements (minimum / maximum nurses per coverage period)
 * come from. The business has not defined them yet, so the only source
 * configures nothing and every period reads "not configured"; no number is
 * assumed anywhere. A later phase decides the storage (per department, per
 * weekday or holiday), the values and whether falling short blocks
 * finalization, then adds a source here and the staffing validators.
 */
export interface StaffingRequirementsSource {
  /** Requirements of the given days; a day without an entry has none configured. */
  requirementsFor(input: {
    readonly departmentId: string;
    readonly dates: readonly IsoDate[];
  }): Promise<ReadonlyMap<IsoDate, StaffingRequirement>>;
}

export const NO_STAFFING_REQUIREMENTS: StaffingRequirementsSource = {
  requirementsFor: async () => new Map(),
};
