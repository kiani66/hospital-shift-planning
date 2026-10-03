import { addDays, type IsoDate } from "../shared/dates";
import { ValidationError } from "../shared/errors";

export interface RelationDates {
  readonly startedOn: IsoDate;
  readonly endedOn: IsoDate | null;
}

export function validateRelationDates(dates: RelationDates): void {
  if (dates.endedOn !== null && dates.endedOn < dates.startedOn)
    throw new ValidationError("End date precedes start date", "endedOn");
}

/** Phase 10 ends current relations; arbitrary historical corrections are deferred. */
export function validateRelationEnd(
  relation: RelationDates,
  endedOn: IsoDate,
  today: IsoDate,
): void {
  if (
    relation.startedOn > today ||
    (relation.endedOn !== null && relation.endedOn < today)
  )
    throw new ValidationError(
      "The relation must be effective today",
      "relationId",
    );
  if (endedOn < today)
    throw new ValidationError("Cannot end a relation in the past", "endedOn");
  if (relation.endedOn !== null && endedOn > relation.endedOn)
    throw new ValidationError(
      "Ending cannot extend a fixed-term relation",
      "endedOn",
    );
}

export function predecessorEnd(
  relation: RelationDates,
  successorStartedOn: IsoDate,
  today: IsoDate,
): IsoDate {
  const endedOn = addDays(successorStartedOn, -1);
  if (successorStartedOn < today || endedOn < relation.startedOn)
    throw new ValidationError(
      "Transition must preserve the predecessor's history",
      "startedOn",
    );
  // A transition today normally ends its predecessor yesterday. Validate its
  // current effectiveness separately rather than treating it as an ordinary end.
  if (
    relation.startedOn > today ||
    (relation.endedOn !== null && relation.endedOn < today)
  )
    throw new ValidationError(
      "The predecessor must be effective today",
      "relationId",
    );
  if (relation.endedOn !== null && endedOn > relation.endedOn)
    throw new ValidationError(
      "Transition cannot extend the predecessor",
      "startedOn",
    );
  return endedOn;
}

/** All callers count under the same database transaction lock. */
export function assertActiveAdminRemains(input: {
  wasActiveAdmin: boolean;
  willBeActiveAdmin: boolean;
  activeAdminCount: number;
}): void {
  if (
    input.wasActiveAdmin &&
    !input.willBeActiveAdmin &&
    input.activeAdminCount <= 1
  )
    throw new ValidationError(
      "Cannot remove the last active Hospital Admin",
      "hospitalAdmin",
    );
}
