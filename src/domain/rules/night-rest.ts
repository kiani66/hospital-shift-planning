import { addDays, compareIsoDates } from "../shared/dates";
import type { Assignment } from "../shifts/assignment";
import { isNightShift, isWorkingShift } from "../shifts/shift-type";
import type { Violation } from "./violation";

type NightRestViolation = Extract<Violation, { rule: "NIGHT_REST" }>;

/**
 * Approved rule D7: a Night (N) on date D requires the nurse to be OFF on D+1.
 * N→M, N→E, N→ME and N→N are all invalid. Not overridable.
 *
 * Pass assignments from every period that matters (including the neighbouring
 * days of adjacent schedules) so the rule holds across period boundaries.
 */
export function findNightRestViolations(
  assignments: readonly Assignment[],
): NightRestViolation[] {
  const byNurseAndDate = new Map<string, Assignment[]>();
  const key = (nurseId: string, date: string) => `${nurseId}|${date}`;
  for (const a of assignments) {
    const k = key(a.nurseId, a.date);
    byNurseAndDate.set(k, [...(byNurseAndDate.get(k) ?? []), a]);
  }

  const violations: NightRestViolation[] = [];
  for (const night of assignments) {
    if (!isNightShift(night.shift)) continue;
    const nextDay = addDays(night.date, 1);
    for (const next of byNurseAndDate.get(key(night.nurseId, nextDay)) ?? []) {
      if (!isWorkingShift(next.shift)) continue;
      violations.push({
        rule: "NIGHT_REST",
        severity: "error",
        nurseId: night.nurseId,
        nightDate: night.date,
        date: nextDay,
        shift: next.shift,
      });
    }
  }
  return violations.sort(
    (a, b) =>
      compareIsoDates(a.date, b.date) || a.nurseId.localeCompare(b.nurseId),
  );
}
