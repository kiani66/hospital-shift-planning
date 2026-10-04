import { z } from "zod";

import type { MembershipRole } from "../../domain/authz/actor";
import { decide } from "../../domain/authz/policies";
import { isWindowActive } from "../../domain/preferences/preference-window";
import {
  checkRosterEditable,
  rosterRoleForPeriod,
} from "../../domain/schedule/roster-editing";
import { ValidationError } from "../../domain/shared/errors";
import type { DatePeriod } from "../../domain/shared/period";
import { unwrap } from "../../domain/shared/result";
import { listPreferenceWindows } from "../../infrastructure/repositories/preference-windows";
import {
  addToRoster,
  listRosterCandidateMemberships,
  type RosterCandidateRow,
} from "../../infrastructure/repositories/roster";
import { findScheduleById } from "../../infrastructure/repositories/schedules";
import { ConflictError, NotFoundError } from "../errors";
import { defineCommand, type AppContext } from "../use-case";
import { loadScheduleForUpdate, saveSchedule } from "./load-for-update";

export interface RosterCandidate {
  readonly userId: string;
  readonly displayName: string;
  readonly personnelNumber: string | null;
  readonly role: MembershipRole;
}

/** One candidate per person, with the role the creation snapshot would give (D19). */
function candidatesFrom(
  rows: readonly RosterCandidateRow[],
  period: DatePeriod,
): RosterCandidate[] {
  const byUser = new Map<string, RosterCandidateRow[]>();
  for (const row of rows)
    byUser.set(row.userId, [...(byUser.get(row.userId) ?? []), row]);
  return [...byUser.values()].flatMap((memberships) => {
    const role = rosterRoleForPeriod(memberships, period);
    const first = memberships[0]!;
    return role
      ? [
          {
            userId: first.userId,
            displayName: first.displayName,
            personnelNumber: first.personnelNumber,
            role,
          },
        ]
      : [];
  });
}

/**
 * Department members who could be added to a schedule's roster: active
 * accounts with a membership effective on at least one day of the period,
 * not yet on the roster. Head Nurse of the schedule's department only
 * (`schedule.editRoster`); anyone else gets NOT_FOUND. Empty unless the
 * schedule is still DRAFT or PLANNING.
 */
export async function getRosterCandidates(
  ctx: AppContext,
  input: { scheduleId: string },
): Promise<{
  readonly editable: boolean;
  readonly candidates: readonly RosterCandidate[];
}> {
  const schedule = z.uuid().safeParse(input.scheduleId).success
    ? await findScheduleById(ctx.db, input.scheduleId)
    : null;
  if (
    !schedule ||
    !decide(ctx.actor, "schedule.editRoster", {
      departmentId: schedule.departmentId,
    }).allowed
  )
    throw new NotFoundError("Schedule");
  if (!checkRosterEditable(schedule.status).ok)
    return { editable: false, candidates: [] };
  const rows = await listRosterCandidateMemberships(ctx.db, {
    scheduleId: schedule.id,
  });
  return { editable: true, candidates: candidatesFrom(rows, schedule.period) };
}

export interface AddRosterMembersOutput {
  readonly revision: number;
  readonly added: readonly { userId: string; role: MembershipRole }[];
}

/**
 * Explicitly adds eligible department members to an existing DRAFT or
 * PLANNING schedule (newly registered or imported nurses are never added
 * automatically, D21). One transaction: lock the schedule row (serializing
 * with every edit and lifecycle command), authorize for the schedule's own
 * department, check the revision the page showed, check the status, then
 * re-check eligibility with the memberships and accounts share-locked.
 * Creates no assignments and changes no existing assignment, preference or
 * status; bumps the revision so other tabs see the new roster. Duplicates and
 * ineligible people are refused as a whole (nothing is added).
 */
export const addRosterMembers = defineCommand({
  name: "schedule.addRosterMembers",
  input: z.object({
    scheduleId: z.uuid(),
    expectedRevision: z.number().int().nonnegative(),
    userIds: z.array(z.uuid()).min(1).max(200),
  }),
  async handler(uow, input): Promise<AddRosterMembersOutput> {
    const schedule = await loadScheduleForUpdate(uow, input.scheduleId);
    uow.authorize("schedule.editRoster", {
      departmentId: schedule.departmentId,
    });
    // After authorizing, so an outsider learns nothing from CONFLICT.
    if (schedule.revision !== input.expectedRevision) throw new ConflictError();
    unwrap(checkRosterEditable(schedule.status));

    const requested = [...new Set(input.userIds)];
    if (requested.length !== input.userIds.length)
      throw new ValidationError(
        "A person is listed more than once",
        "userIds",
        "DUPLICATE_ROSTER_MEMBER",
      );
    const rows = await listRosterCandidateMemberships(uow.tx, {
      scheduleId: schedule.id,
      userIds: requested,
      lock: true,
    });
    const eligible = new Map(
      candidatesFrom(rows, schedule.period).map((c) => [c.userId, c]),
    );
    const missing = requested.filter((id) => !eligible.has(id));
    if (missing.length > 0)
      throw new ValidationError(
        "Not an active department member for this period, or already on the roster",
        "userIds",
        "NOT_ELIGIBLE_FOR_ROSTER",
      );

    const added = requested.map((userId) => ({
      userId,
      role: eligible.get(userId)!.role,
    }));
    for (const entry of added)
      await addToRoster(uow.tx, {
        scheduleId: schedule.id,
        userId: entry.userId,
        role: entry.role,
        addedBy: uow.actor.userId,
      });
    const saved = await saveSchedule(uow, schedule, {});

    await uow.audit({
      action: "schedule.rosterMembersAdded",
      entityType: "schedule",
      entityId: schedule.id,
      departmentId: schedule.departmentId,
      scheduleId: schedule.id,
      data: { added, count: added.length, status: schedule.status },
    });

    // An open whole-roster preference window now includes them: tell them,
    // like everyone else was told when it opened (D30).
    const windows = await listPreferenceWindows(uow.tx, schedule.id);
    const open = windows.find(
      (w) => w.nurseIds.size === 0 && isWindowActive(w, uow.now),
    );
    if (open) {
      const dates = [...open.dates].sort();
      await uow.notify(
        added
          .filter((a) => a.userId !== uow.actor.userId)
          .map((a) => ({
            recipientId: a.userId,
            type: "PREFERENCES_OPENED" as const,
            scheduleId: schedule.id,
            data: {
              windowId: open.id,
              label: schedule.label,
              firstDate: dates[0],
              lastDate: dates.at(-1),
            },
          })),
      );
    }

    return { revision: saved.revision, added };
  },
});
