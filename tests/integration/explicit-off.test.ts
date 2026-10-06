import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import {
  applyChangeRequest,
  createChangeRequest,
  respondToSwapRequest,
} from "../../src/application/change-requests/commands";
import { getChangeRequestOptions } from "../../src/application/change-requests/queries";
import { getMyShiftsMonth } from "../../src/application/my-shifts/queries";
import { createSchedule } from "../../src/application/schedules/create-schedule";
import { directSwap } from "../../src/application/schedules/direct-swap";
import { setAssignments } from "../../src/application/schedules/edit-assignments";
import {
  approveSchedule,
  assignmentsFingerprint,
  finalizeSchedule,
  submitSchedule,
} from "../../src/application/schedules/lifecycle";
import {
  closePreferenceWindow,
  openPreferenceWindow,
} from "../../src/application/schedules/preference-windows";
import { getScheduleReview } from "../../src/application/schedules/review";
import { discardRevision } from "../../src/application/schedules/schedule-changes";
import type { ActionResult } from "../../src/application/result";
import type { AppContext } from "../../src/application/use-case";
import { isoDate } from "../../src/domain/shared/dates";
import type { AssignmentCode } from "../../src/domain/shifts/shift-type";
import {
  DEMO_ICU,
  DEMO_SCHEDULE,
  DEMO_USERS as U,
} from "../../src/infrastructure/db/seed/demo-data";
import { listAssignments } from "../../src/infrastructure/repositories/assignments";
import { listAuditEventsForSchedule } from "../../src/infrastructure/repositories/audit";
import { loadActor } from "../../src/infrastructure/repositories/memberships";
import { listRoster } from "../../src/infrastructure/repositories/roster";
import { listScheduleChanges } from "../../src/infrastructure/repositories/schedule-changes";
import { findScheduleById } from "../../src/infrastructure/repositories/schedules";
import { listVersionAssignments } from "../../src/infrastructure/repositories/versions";
import { runMigrations } from "../../src/infrastructure/db/migrate";
import { setupTestDatabase } from "./support/database";
import {
  pinTestRuleSet,
  publishTestRuleSet,
  ruleContent,
} from "./support/rule-sets";

const { db, url } = setupTestDatabase();
const now = new Date("2026-10-01T08:00:00Z");
const today = isoDate("2026-10-01");
const first = isoDate("2026-12-22"),
  second = isoDate("2026-12-23");
const period = { start: first, end: second };
let id: string, head: AppContext, supervisor: AppContext;
const ok = <T>(result: ActionResult<T>): T => {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.data;
};
const ctx = async (userId: string): Promise<AppContext> => ({
  db,
  actor: (await loadActor(db, userId, today))!,
  clock: () => now,
});
const revision = async () => (await findScheduleById(db, id))!.revision;
const step = async (command: typeof finalizeSchedule, context = head) =>
  ok(
    await command(context, {
      scheduleId: id,
      expectedRevision: await revision(),
    }),
  );
const edit = async (
  changes: { nurseId: string; date: string; shift: AssignmentCode | null }[],
) =>
  ok(
    await setAssignments(head, {
      scheduleId: id,
      expectedRevision: await revision(),
      changes,
    }),
  );
const cell = async (nurseId: string, date = first) =>
  (await listAssignments(db, id)).find(
    (a) => a.nurseId === nurseId && a.date === date,
  )?.shift ?? null;
const exchange = async (
  firstNurseId: string,
  secondNurseId: string,
  date = first,
  context = head,
) =>
  directSwap(context, {
    scheduleId: id,
    expectedRevision: await revision(),
    date,
    firstNurseId,
    secondNurseId,
    reasonCode: "OTHER",
    note: "test direct swap",
  });

beforeEach(async () => {
  head = await ctx(U.icuHead.id);
  supervisor = await ctx(U.supervisor.id);
  id = ok(
    await createSchedule(head, {
      departmentId: DEMO_ICU.id,
      periodStart: first,
      periodEnd: second,
      label: "OFF regression",
    }),
  ).scheduleId;
  await step(openPreferenceWindow as typeof finalizeSchedule);
  await step(closePreferenceWindow as typeof finalizeSchedule);
});

async function complete() {
  const roster = await listRoster(db, id);
  const changes = [first, second].flatMap((date) =>
    roster.map((r) => ({
      nurseId: r.userId,
      date,
      shift: "OFF" as AssignmentCode,
    })),
  );
  for (const c of changes) {
    if (c.date === first && c.nurseId === U.icuNurse1.id) c.shift = "ME";
    if (c.date === first && c.nurseId === U.icuNurse2.id) c.shift = "N";
    if (c.date === second && c.nurseId === U.icuNurse3.id) c.shift = "ME";
    if (c.date === second && c.nurseId === U.icuNurse4.id) c.shift = "N";
  }
  await edit(changes);
}
async function approve() {
  await step(finalizeSchedule);
  await step(submitSchedule);
  return step(approveSchedule, supervisor);
}

describe("Explicit OFF end to end in the application", () => {
  it("Draft/Planning saves OFF and permits undecided; clearing OFF is separately audited", async () => {
    await edit([{ nurseId: U.icuNurse1.id, date: first, shift: "OFF" }]);
    expect(await cell(U.icuNurse1.id)).toBe("OFF");
    await edit([{ nurseId: U.icuNurse1.id, date: first, shift: null }]);
    expect(await cell(U.icuNurse1.id)).toBeNull();
    const events = await listAuditEventsForSchedule(db, id);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "assignment.created",
          data: expect.objectContaining({ before: null, after: "OFF" }),
        }),
        expect.objectContaining({
          action: "assignment.cleared",
          data: expect.objectContaining({ before: "OFF", after: null }),
        }),
      ]),
    );
  });
  it("Finalize refuses missing decisions with useful errors and counts", async () => {
    await complete();
    await edit([{ nurseId: U.icuHead.id, date: first, shift: null }]);
    const result = await finalizeSchedule(head, {
      scheduleId: id,
      expectedRevision: await revision(),
    });
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "RULE_VIOLATION",
        violations: [
          expect.objectContaining({
            rule: "UNDECIDED",
            nurseId: U.icuHead.id,
            date: first,
          }),
        ],
      },
    });
    const review = await getScheduleReview(head, {
      departmentId: DEMO_ICU.id,
      scheduleId: id,
      day: first,
    });
    expect(review.workflow.validation).toMatchObject({
      undecided: 1,
      undecidedDays: 1,
      coverageProblems: 0,
      ruleViolations: 0,
    });
    expect((await findScheduleById(db, id))!.status).toBe("PLANNING");
  });
  it("all OFF decisions complete the roster but block Finalize for M/E/N staffing", async () => {
    await complete();
    await edit([
      { nurseId: U.icuNurse1.id, date: first, shift: "OFF" },
      { nurseId: U.icuNurse2.id, date: first, shift: "OFF" },
    ]);
    const result = await finalizeSchedule(head, {
      scheduleId: id,
      expectedRevision: await revision(),
    });
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "RULE_VIOLATION",
        violations: [
          expect.objectContaining({ rule: "STAFFING", period: "E" }),
          expect.objectContaining({ rule: "STAFFING", period: "M" }),
          expect.objectContaining({ rule: "STAFFING", period: "N" }),
        ],
      },
    });
    expect(
      (
        await getScheduleReview(head, {
          departmentId: DEMO_ICU.id,
          scheduleId: id,
          day: first,
        })
      ).day!.validation,
    ).toMatchObject({ state: "COVERAGE", undecided: 0, shortages: 3 });
  });
  it("the pinned minimum is enforced by the command, not only the UI", async () => {
    await complete();
    const versionId = await publishTestRuleSet(db, {
      departmentId: DEMO_ICU.id,
      createdBy: U.supervisor.id,
      content: ruleContent(
        { min: 1, max: null },
        {
          exceptions: [
            {
              date: first,
              period: "M",
              bounds: { min: 2, max: null },
              note: null,
            },
          ],
        },
      ),
    });
    await pinTestRuleSet(db, id, versionId);
    expect(
      await finalizeSchedule(head, {
        scheduleId: id,
        expectedRevision: await revision(),
      }),
    ).toMatchObject({
      ok: false,
      error: {
        code: "RULE_VIOLATION",
        violations: [
          expect.objectContaining({
            rule: "STAFFING",
            bounds: { min: 2 },
            covered: 1,
          }),
        ],
      },
    });
  });

  it("versions preserve OFF and deterministic fingerprints; pending revisions keep the approved OFF visible and discard restores it", async () => {
    await complete();
    const approved = await approve();
    const snapshot = await listVersionAssignments(db, approved.versionId!);
    expect(snapshot).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nurseId: U.icuHead.id,
          date: first,
          shift: "OFF",
        }),
      ]),
    );
    expect(assignmentsFingerprint(snapshot)).toBe(
      assignmentsFingerprint([...snapshot].reverse()),
    );
    expect(assignmentsFingerprint(snapshot)).not.toBe(
      assignmentsFingerprint(snapshot.filter((a) => a.shift !== "OFF")),
    );
    ok(await exchange(U.icuNurse1.id, U.icuHead.id));
    expect(await cell(U.icuHead.id)).toBe("ME");
    const visible = await getMyShiftsMonth(head, { period, today });
    expect(visible.days[0]!.entries[0]).toMatchObject({
      shift: "OFF",
      publication: "OFFICIAL",
      changePending: true,
    });
    ok(
      await discardRevision(head, {
        scheduleId: id,
        expectedRevision: await revision(),
      }),
    );
    expect(await cell(U.icuHead.id)).toBe("OFF");
    expect(await listVersionAssignments(db, approved.versionId!)).toEqual(
      snapshot,
    );
  });
  it("a revision cannot submit an undecided day; reapproval snapshots explicit OFF without changing v1", async () => {
    await complete();
    const v1 = await approve();
    const original = await listVersionAssignments(db, v1.versionId!);
    ok(await exchange(U.icuNurse1.id, U.icuHead.id));
    await edit([{ nurseId: U.icuNurse1.id, date: first, shift: null }]);
    expect(
      await submitSchedule(head, {
        scheduleId: id,
        expectedRevision: await revision(),
      }),
    ).toMatchObject({
      ok: false,
      error: {
        code: "RULE_VIOLATION",
        violations: [
          expect.objectContaining({
            rule: "UNDECIDED",
            nurseId: U.icuNurse1.id,
            date: first,
          }),
        ],
      },
    });
    await edit([{ nurseId: U.icuNurse1.id, date: first, shift: "OFF" }]);
    await step(submitSchedule);
    const v2 = await step(approveSchedule, supervisor);
    expect(await listVersionAssignments(db, v1.versionId!)).toEqual(original);
    expect(await listVersionAssignments(db, v2.versionId!)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nurseId: U.icuNurse1.id,
          date: first,
          shift: "OFF",
        }),
      ]),
    );
    const visible = await getMyShiftsMonth(await ctx(U.icuNurse1.id), {
      period,
      today,
    });
    expect(visible.days[0]!.entries[0]).toMatchObject({
      shift: "OFF",
      publication: "OFFICIAL",
      changePending: false,
    });
  });
  it("My Shifts uses publication rules for OFF, separates totals, and leaves missing days distinct", async () => {
    await edit([{ nurseId: U.icuNurse1.id, date: first, shift: "OFF" }]);
    const nurse = await ctx(U.icuNurse1.id);
    const month = await getMyShiftsMonth(nurse, { period, today });
    expect(month.totals).toMatchObject({
      shiftCount: 0,
      offCount: 1,
      minutes: 0,
      includesUnapproved: true,
    });
    expect(month.schedules[0]).toMatchObject({ shiftCount: 0, offCount: 1 });
    expect(month.days[0]!.entries[0]).toMatchObject({
      shift: "OFF",
      publication: "TEMPORARY",
    });
    expect(month.days[1]!.entries).toEqual([]);
  });
  it("an OFF nurse can initiate a swap; accepted M/ME ↔ OFF exchanges decisions and audit", async () => {
    await complete();
    await step(finalizeSchedule);
    const nurse3 = await ctx(U.icuNurse3.id),
      nurse1 = await ctx(U.icuNurse1.id);
    expect(
      (await getChangeRequestOptions(nurse3)).schedules.find(
        (s) => s.scheduleId === id,
      )!.assignments[0]!.shift,
    ).toBe("OFF");
    const request = ok(
      await createChangeRequest(nurse3, {
        scheduleId: id,
        type: "SWAP",
        date: first,
        counterpartId: U.icuNurse1.id,
        reasonCode: "PERSONAL_MATTER",
      }),
    );
    ok(
      await respondToSwapRequest(nurse1, {
        requestId: request.id,
        accept: true,
      }),
    );
    ok(
      await applyChangeRequest(head, {
        requestId: request.id,
        expectedRevision: await revision(),
      }),
    );
    expect(await cell(U.icuNurse3.id)).toBe("ME");
    expect(await cell(U.icuNurse1.id)).toBe("OFF");
  });
  it("UNAVAILABLE approval makes OFF and an OFF replacement takes over the working coverage", async () => {
    await complete();
    await step(finalizeSchedule);
    const request = ok(
      await createChangeRequest(await ctx(U.icuNurse1.id), {
        scheduleId: id,
        type: "UNAVAILABLE",
        date: first,
        reasonCode: "ILLNESS",
      }),
    );
    const applied = ok(
      await applyChangeRequest(head, {
        requestId: request.id,
        expectedRevision: await revision(),
        replacementNurseId: U.icuHead.id,
      }),
    );
    expect(applied.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nurseId: U.icuNurse1.id,
          before: "ME",
          after: "OFF",
        }),
      ]),
    );
    expect(await cell(U.icuHead.id)).toBe("ME");
  });
  it.each(["M", "E", "N", "ME", "OFF", null] as const)(
    "OTHER manually resolves to %s and audits the actual value",
    async (shift) => {
      await complete();
      await step(finalizeSchedule);
      const requester = await ctx(U.icuHead.id);
      const request = ok(
        await createChangeRequest(requester, {
          scheduleId: id,
          type: "OTHER",
          date: first,
          reasonCode: "OTHER",
          note: "manual decision",
        }),
      );
      // Use an extra nonessential working decision so OFF and clear are real changes.
      await edit([
        {
          nurseId: U.icuHead.id,
          date: first,
          shift: shift === "ME" ? "M" : "ME",
        },
      ]);
      ok(
        await applyChangeRequest(head, {
          requestId: request.id,
          expectedRevision: await revision(),
          requesterShift: shift,
          confirmStaleContext: true,
        }),
      );
      expect(await cell(U.icuHead.id)).toBe(shift);
      expect(await listAuditEventsForSchedule(db, id)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action:
              shift === null ? "assignment.cleared" : "assignment.changed",
            data: expect.objectContaining({ after: shift }),
          }),
        ]),
      );
    },
  );
  it("legacy missing rows are untouched by replayed migrations; OFF FK and working-only target constraints hold", async () => {
    expect(await listAssignments(db, DEMO_SCHEDULE.id)).toEqual([]);
    await runMigrations(url);
    expect(await listAssignments(db, DEMO_SCHEDULE.id)).toEqual([]);
    const { rows } = await db.execute(
      sql`select code, covers, is_night, sort_order from shift_types where code = 'OFF'`,
    );
    expect(rows).toEqual([
      { code: "OFF", covers: [], is_night: false, sort_order: 5 },
    ]);
    await edit([{ nurseId: U.icuNurse1.id, date: first, shift: "OFF" }]);
    await complete();
    await step(finalizeSchedule);
    const request = ok(
      await createChangeRequest(await ctx(U.icuNurse1.id), {
        scheduleId: id,
        type: "CHANGE_SHIFT",
        date: first,
        targetShift: "M",
        reasonCode: "ILLNESS",
      }),
    );
    await expect(
      db.execute(
        sql`update shift_change_requests set target_shift_code = 'OFF' where id = ${request.id}`,
      ),
    ).rejects.toThrow();
    await expect(
      db.execute(
        sql`insert into shift_assignments (schedule_id, user_id, date, shift_code, updated_by) values (${DEMO_SCHEDULE.id}, ${U.icuNurse2.id}, ${isoDate("2026-10-25")}, 'UNKNOWN', ${U.icuHead.id})`,
      ),
    ).rejects.toThrow();
  });
});

describe("Head Nurse direct swaps", () => {
  it("exchanges working decisions without a nurse request and records actor, time and both cells", async () => {
    await complete();
    await edit([
      { nurseId: U.icuNurse1.id, date: first, shift: "M" },
      { nurseId: U.icuHead.id, date: first, shift: "E" },
    ]);
    const swapped = ok(await exchange(U.icuNurse1.id, U.icuHead.id));
    expect(await cell(U.icuNurse1.id)).toBe("E");
    expect(await cell(U.icuHead.id)).toBe("M");
    expect(await listScheduleChanges(db, { scheduleId: id })).toEqual([
      expect.objectContaining({
        id: swapped.changeId,
        appliedBy: U.icuHead.id,
        appliedAt: now,
        requestId: null,
        cells: [...swapped.changes].sort((a, b) =>
          a.nurseId.localeCompare(b.nurseId),
        ),
      }),
    ]);
    expect(await listAuditEventsForSchedule(db, id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "schedule.directSwapped",
          actorId: U.icuHead.id,
          data: expect.objectContaining({ cells: swapped.changes }),
        }),
      ]),
    );
  });
  it("exchanges working ↔ OFF in Planning and validates again in a finalized schedule", async () => {
    await complete();
    ok(await exchange(U.icuNurse1.id, U.icuHead.id));
    expect(await cell(U.icuNurse1.id)).toBe("OFF");
    expect(await cell(U.icuHead.id)).toBe("ME");
    await step(finalizeSchedule);
    ok(await exchange(U.icuHead.id, U.icuNurse1.id));
  });
  it("refuses night-rest violations, even in Draft/Planning", async () => {
    await complete();
    const before = await listAssignments(db, id);
    expect(await exchange(U.icuNurse2.id, U.icuNurse4.id)).toMatchObject({
      ok: false,
      error: {
        code: "RULE_VIOLATION",
        violations: [expect.objectContaining({ rule: "NIGHT_REST" })],
      },
    });
    expect(await listAssignments(db, id)).toEqual(before);
  });
  it("enforces authorization and tenant boundaries", async () => {
    await complete();
    for (const who of [U.icuNurse1.id, U.erHead.id, U.supervisor.id])
      expect(
        await exchange(U.icuNurse1.id, U.icuHead.id, first, await ctx(who)),
      ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });
  it("enforces immutable submitted schedules and existing revision scope", async () => {
    await complete();
    await step(finalizeSchedule);
    await step(submitSchedule);
    expect(await exchange(U.icuNurse1.id, U.icuHead.id)).toMatchObject({
      ok: false,
      error: { code: "INVALID_STATE" },
    });
    await step(approveSchedule, supervisor);
    ok(await exchange(U.icuNurse1.id, U.icuHead.id));
    expect(await exchange(U.icuNurse3.id, U.icuHead.id, second)).toMatchObject({
      ok: false,
      error: {
        code: "INVALID_STATE",
        reason: "EDIT_ASSIGNMENT_OUTSIDE_REVISION_SCOPE",
      },
    });
    await step(submitSchedule);
    expect(await exchange(U.icuNurse1.id, U.icuHead.id)).toMatchObject({
      ok: false,
      error: { code: "INVALID_STATE", reason: "CHANGE_WHILE_SUBMITTED" },
    });
  });
  it("refuses stale revisions and undecided cells without writes", async () => {
    await complete();
    expect(
      await directSwap(head, {
        scheduleId: id,
        expectedRevision: 0,
        date: first,
        firstNurseId: U.icuNurse1.id,
        secondNurseId: U.icuHead.id,
        reasonCode: "OTHER",
        note: "swap",
      }),
    ).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    await edit([{ nurseId: U.icuHead.id, date: first, shift: null }]);
    expect(await exchange(U.icuNurse1.id, U.icuHead.id)).toMatchObject({
      ok: false,
      error: { code: "VALIDATION" },
    });
  });
});
