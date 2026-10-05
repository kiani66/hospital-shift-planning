import type { StaffingRequirement } from "../../domain/rules/staffing";
import type { IsoDate } from "../../domain/shared/dates";

/** Configurable bounds per department and day. Storage/configuration UI is outside this PR.
 * The application merges this source with the required baseline M/E/N minimum of one.
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
