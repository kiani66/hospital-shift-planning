import type { IsoDate } from "../shared/dates";

export type RelationStatus = "CURRENT" | "FUTURE" | "ENDED";

/** Inclusive effective dates, independent of the account's active flag. */
export function relationStatus(
  relation: { startedOn: IsoDate; endedOn: IsoDate | null },
  today: IsoDate,
): RelationStatus {
  if (relation.startedOn > today) return "FUTURE";
  if (relation.endedOn !== null && relation.endedOn < today) return "ENDED";
  return "CURRENT";
}
