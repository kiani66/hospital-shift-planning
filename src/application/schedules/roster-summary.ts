import type { MembershipRole } from "../../domain/authz/actor";

/** Head counts of a roster snapshot; a Head Nurse is counted once, as Head Nurse. */
export interface RosterSummary {
  readonly total: number;
  readonly nurses: number;
  readonly headNurses: number;
}

export function summarizeRoster(
  roster: readonly { readonly role: MembershipRole }[],
): RosterSummary {
  const headNurses = roster.filter((r) => r.role === "HEAD_NURSE").length;
  return {
    total: roster.length,
    nurses: roster.length - headNurses,
    headNurses,
  };
}
