import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { setMyPreference } from "../../src/application/preferences/commands";
import {
  approveSchedule,
  finalizeSchedule,
  submitSchedule,
  type LifecycleOutput,
} from "../../src/application/schedules/lifecycle";
import {
  closePreferenceWindow,
  openPreferenceWindow,
} from "../../src/application/schedules/preference-windows";
import { getDepartmentSchedules } from "../../src/application/schedules/queries";
import { getScheduleReview } from "../../src/application/schedules/review";
import type { ActionResult } from "../../src/application/result";
import type { AppContext } from "../../src/application/use-case";
import type { Actor } from "../../src/domain/authz/actor";
import { isoDate } from "../../src/domain/shared/dates";
import type { AssignmentCode } from "../../src/domain/shifts/shift-type";
import {
  DEMO_ICU,
  DEMO_SCHEDULE,
  DEMO_USERS,
} from "../../src/infrastructure/db/seed/demo-data";
import {
  listAssignments,
  setAssignment,
} from "../../src/infrastructure/repositories/assignments";
import { listAuditEventsForSchedule } from "../../src/infrastructure/repositories/audit";
import { loadActor } from "../../src/infrastructure/repositories/memberships";
import { listNotificationsForRecipient } from "../../src/infrastructure/repositories/notifications";
import { listPreferenceWindows } from "../../src/infrastructure/repositories/preference-windows";
import { findScheduleById } from "../../src/infrastructure/repositories/schedules";
import { listVersions } from "../../src/infrastructure/repositories/versions";
import { completeScheduleFixture } from "../support/complete-schedule";
import { setupTestDatabase } from "./support/database";

/**
 * D124: nurse preferences are optional and advisory. A schedule is finalized,
 * submitted and approved without ever opening them; they can be opened at any
 * point before finalization (DRAFT → PLANNING, or PLANNING kept), once per
 * schedule, without touching assignments; an open window still blocks SUBMIT.
 */

const { db } = setupTestDatabase();
const U = DEMO_USERS;
const S = DEMO_SCHEDULE.id; // ICU, Aban 1405: 2026-10-23 .. 2026-11-21, DRAFT
const TODAY = isoDate("2026-10-01");
const NOW = new Date("2026-10-01T06:30:00Z");

type Who = "icuHead" | "erHead" | "icuNurse" | "supervisor";
const actors = {} as Record<Who, Actor>;
const as = (actor: Actor): AppContext => ({ db, actor, clock: () => NOW });

beforeEach(async () => {
  actors.icuHead = (await loadActor(db, U.icuHead.id, TODAY))!;
  actors.erHead = (await loadActor(db, U.erHead.id, TODAY))!;
  actors.icuNurse = (await loadActor(db, U.icuNurse1.id, TODAY))!;
  actors.supervisor = (await loadActor(db, U.supervisor.id, TODAY))!;
});

const schedule = async () => (await findScheduleById(db, S))!;
const revision = async () => (await schedule()).revision;

type Command = (
  ctx: AppContext,
  input: unknown,
) => Promise<ActionResult<LifecycleOutput | { revision: number }>>;

async function run(
  command: Command,
  actor: Actor,
  extra: Record<string, unknown> = {},
) {
  return command(as(actor), {
    scheduleId: S,
    expectedRevision: await revision(),
    ...extra,
  });
}

function unwrapOk<T>(result: ActionResult<T>): T {
  if (!result.ok)
    throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.data;
}

const assign = (userId: string, date: string, shift: AssignmentCode) =>
  setAssignment(db, {
    scheduleId: S,
    userId,
    date: isoDate(date),
    shift,
    updatedBy: U.icuHead.id,
  });

/** Every nurse-day decided and staffed, the schedule left in DRAFT. */
const completeInDraft = () =>
  completeScheduleFixture(db, S, [
    U.icuHead.id,
    U.icuNurse4.id,
    U.transferNurse.id,
  ]);

/**
 * PLANNING without any preference window: what the state machine's
 * START_PLANNING produces (an approved event with no use case of its own).
 */
const toPlanningWithoutPreferences = () =>
  db.execute(sql`update schedules set status = 'PLANNING' where id = ${S}`);

const counts = async () => {
  const { rows } = await db.execute<{
    windows: number;
    audit: number;
    notifications: number;
    assignments: number;
  }>(sql`
    select (select count(*)::int from preference_windows) as windows,
           (select count(*)::int from audit_events) as audit,
           (select count(*)::int from notifications) as notifications,
           (select count(*)::int from shift_assignments) as assignments
  `);
  return rows[0]!;
};

const audit = async () => listAuditEventsForSchedule(db, S);

describe("a schedule that never opens preferences", () => {
  it("is finalized from DRAFT, submitted and approved with no preference window", async () => {
    await completeInDraft();
    const assignments = await listAssignments(db, S);
    expect((await schedule()).status).toBe("DRAFT");

    const finalized = unwrapOk(await run(finalizeSchedule, actors.icuHead));
    expect(finalized).toMatchObject({ status: "FINALIZED" });
    expect((await audit()).at(-1)).toMatchObject({
      actorId: U.icuHead.id,
      action: "schedule.finalized",
      entityType: "schedule",
      entityId: S,
      departmentId: DEMO_ICU.id,
      data: {
        from: "DRAFT",
        to: "FINALIZED",
        assignmentCount: assignments.length,
      },
    });

    expect(unwrapOk(await run(submitSchedule, actors.icuHead))).toMatchObject({
      status: "SUBMITTED",
    });
    expect(
      unwrapOk(await run(approveSchedule, actors.supervisor)),
    ).toMatchObject({ status: "APPROVED" });

    expect(await listPreferenceWindows(db, S)).toEqual([]);
    expect(await listAssignments(db, S)).toEqual(assignments);
    expect(await listVersions(db, S)).toHaveLength(1);
    expect((await audit()).map((e) => e.action)).not.toContain(
      "schedule.preferencesOpened",
    );
    // Nobody was told to enter preferences.
    expect(
      (await listNotificationsForRecipient(db, U.icuNurse1.id)).map(
        (n) => n.type,
      ),
    ).not.toContain("PREFERENCES_OPENED");
  });

  it("offers finalize in DRAFT on the review, with no preference blocker", async () => {
    await completeInDraft();
    const review = await getScheduleReview(as(actors.icuHead), {
      departmentId: DEMO_ICU.id,
      scheduleId: S,
    });
    expect(review.workflow.status).toBe("DRAFT");
    expect(review.workflow.actions.finalize).toEqual({ blockers: [] });
    expect(review.workflow.preferenceWindowOpen).toBe(false);
  });

  it("keeps validation in DRAFT: an undecided schedule is RULE_VIOLATION and changes nothing", async () => {
    await assign(U.icuNurse1.id, "2026-10-24", "M");
    const before = { schedule: await schedule(), counts: await counts() };
    expect(await run(finalizeSchedule, actors.icuHead)).toMatchObject({
      ok: false,
      error: {
        code: "RULE_VIOLATION",
        violations: expect.arrayContaining([
          expect.objectContaining({ rule: "UNDECIDED" }),
        ]),
      },
    });
    expect(await schedule()).toEqual(before.schedule);
    expect(await counts()).toEqual(before.counts);
  });

  it("keeps the night-rest rule in DRAFT: blocked, nothing written", async () => {
    await assign(U.icuNurse1.id, "2026-10-25", "N");
    await assign(U.icuNurse1.id, "2026-10-26", "M");
    await completeInDraft();
    const before = { schedule: await schedule(), counts: await counts() };
    expect(await run(finalizeSchedule, actors.icuHead)).toMatchObject({
      ok: false,
      error: {
        code: "RULE_VIOLATION",
        violations: expect.arrayContaining([
          expect.objectContaining({
            rule: "NIGHT_REST",
            nurseId: U.icuNurse1.id,
            nightDate: "2026-10-25",
          }),
        ]),
      },
    });
    expect(await schedule()).toEqual(before.schedule);
    expect(await counts()).toEqual(before.counts);
  });

  it.each([
    ["another department's Head Nurse", "erHead"],
    ["a nurse of the department", "icuNurse"],
    ["the department's Supervisor", "supervisor"],
  ] as const)(
    "forbids %s to finalize from DRAFT, even with a stale revision",
    async (_, who) => {
      await completeInDraft();
      const before = await counts();
      for (const expectedRevision of [await revision(), 99])
        expect(
          await run(finalizeSchedule, actors[who], { expectedRevision }),
        ).toMatchObject({
          ok: false,
          error: { code: "FORBIDDEN", reason: "NOT_HEAD_NURSE_OF_DEPARTMENT" },
        });
      expect((await schedule()).status).toBe("DRAFT");
      expect(await counts()).toEqual(before);
    },
  );

  it("returns CONFLICT for a stale revision in DRAFT and writes nothing", async () => {
    await completeInDraft();
    const before = await counts();
    expect(
      await run(finalizeSchedule, actors.icuHead, {
        expectedRevision: (await revision()) + 1,
      }),
    ).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    expect((await schedule()).status).toBe("DRAFT");
    expect(await counts()).toEqual(before);
  });

  it("lets exactly one of two concurrent finalizes from DRAFT win", async () => {
    await completeInDraft();
    const expectedRevision = await revision();
    const results = await Promise.all([
      run(finalizeSchedule, actors.icuHead, { expectedRevision }),
      run(finalizeSchedule, actors.icuHead, { expectedRevision }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({
      error: { code: "CONFLICT" },
    });
    expect(
      (await audit()).filter((e) => e.action === "schedule.finalized"),
    ).toHaveLength(1);
  });

  it("cannot open preferences once finalized (D65)", async () => {
    await completeInDraft();
    unwrapOk(await run(finalizeSchedule, actors.icuHead));
    expect(await run(openPreferenceWindow, actors.icuHead)).toMatchObject({
      ok: false,
      error: { code: "INVALID_STATE", reason: "OPEN_PREFERENCES" },
    });
    expect(await listPreferenceWindows(db, S)).toEqual([]);
  });
});

describe("opening preferences after assigning shifts", () => {
  it("from DRAFT: moves to PLANNING and leaves every assignment as it was", async () => {
    await assign(U.icuNurse1.id, "2026-10-24", "M");
    await assign(U.icuNurse2.id, "2026-10-24", "N");
    await assign(U.icuNurse2.id, "2026-10-25", "OFF");
    const assignments = await listAssignments(db, S);

    unwrapOk(await run(openPreferenceWindow, actors.icuHead));
    expect((await schedule()).status).toBe("PLANNING");
    expect(await listAssignments(db, S)).toEqual(assignments);
    expect((await audit()).at(-1)).toMatchObject({
      action: "schedule.preferencesOpened",
      data: expect.objectContaining({ from: "DRAFT", to: "PLANNING" }),
    });
  });

  it("from PLANNING: keeps the status and assignments, opens one window, notifies nurses", async () => {
    await assign(U.icuNurse1.id, "2026-10-24", "M");
    await assign(U.icuNurse2.id, "2026-10-24", "E");
    await toPlanningWithoutPreferences();
    const assignments = await listAssignments(db, S);
    const before = await schedule();

    const result = unwrapOk(await run(openPreferenceWindow, actors.icuHead));
    expect(result).toEqual({
      revision: before.revision + 1,
      windowIds: [expect.any(String)],
    });
    expect(await schedule()).toMatchObject({
      status: "PLANNING",
      revision: before.revision + 1,
    });
    expect(await listAssignments(db, S)).toEqual(assignments);
    const [window] = await listPreferenceWindows(db, S);
    expect(window).toMatchObject({ kind: "INITIAL", closedAt: null });

    // The audit names the operation and claims no lifecycle change.
    const event = (await audit()).at(-1)!;
    expect(event).toMatchObject({
      action: "schedule.preferencesOpened",
      entityType: "preferenceWindow",
      entityId: window!.id,
      data: expect.objectContaining({ status: "PLANNING" }),
    });
    expect(event.data).not.toHaveProperty("from");
    expect(event.data).not.toHaveProperty("to");

    const [mine] = await listNotificationsForRecipient(db, U.icuNurse1.id);
    expect(mine).toMatchObject({ type: "PREFERENCES_OPENED", scheduleId: S });
  });

  it("from PLANNING: the overview offers it while no window exists, then not again", async () => {
    await toPlanningWithoutPreferences();
    const overview = async () =>
      (await getDepartmentSchedules(as(actors.icuHead), {
        departmentId: DEMO_ICU.id,
        scheduleId: S,
        today: TODAY,
      }))!.selected!.actions;
    expect(await overview()).toEqual({
      openPreferences: true,
      closePreferences: false,
    });
    unwrapOk(await run(openPreferenceWindow, actors.icuHead));
    expect(await overview()).toEqual({
      openPreferences: false,
      closePreferences: true,
    });
    unwrapOk(await run(closePreferenceWindow, actors.icuHead));
    expect(await overview()).toEqual({
      openPreferences: false,
      closePreferences: false,
    });
  });

  it("opens once per schedule: reopening after a close is INVALID_STATE and writes nothing", async () => {
    unwrapOk(await run(openPreferenceWindow, actors.icuHead));
    unwrapOk(await run(closePreferenceWindow, actors.icuHead));
    const before = { schedule: await schedule(), counts: await counts() };
    expect(await run(openPreferenceWindow, actors.icuHead)).toMatchObject({
      ok: false,
      error: { code: "INVALID_STATE", reason: "PREFERENCES_ALREADY_OPENED" },
    });
    expect(await schedule()).toEqual(before.schedule);
    expect(await counts()).toEqual(before.counts);
  });

  it.each([
    ["a nurse", "icuNurse"],
    ["a supervisor", "supervisor"],
    ["another department's Head Nurse", "erHead"],
  ] as const)(
    "from PLANNING: forbids %s, even with a stale revision",
    async (_, who) => {
      await toPlanningWithoutPreferences();
      const before = await counts();
      for (const expectedRevision of [await revision(), 99])
        expect(
          await run(openPreferenceWindow, actors[who], { expectedRevision }),
        ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
      expect(await counts()).toEqual(before);
    },
  );

  it("from PLANNING: a stale revision is CONFLICT and opens nothing", async () => {
    await toPlanningWithoutPreferences();
    expect(
      await run(openPreferenceWindow, actors.icuHead, {
        expectedRevision: (await revision()) + 1,
      }),
    ).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    expect(await listPreferenceWindows(db, S)).toEqual([]);
  });
});

describe("preferences never decide finalization", () => {
  it("zero responses: finalize succeeds while the window is open; only SUBMIT waits for the close", async () => {
    await completeInDraft();
    unwrapOk(await run(openPreferenceWindow, actors.icuHead));
    expect(unwrapOk(await run(finalizeSchedule, actors.icuHead))).toMatchObject(
      { status: "FINALIZED" },
    );

    const before = await counts();
    expect(await run(submitSchedule, actors.icuHead)).toMatchObject({
      ok: false,
      error: { code: "INVALID_STATE", reason: "PREFERENCE_WINDOW_OPEN" },
    });
    expect(await counts()).toEqual(before);

    unwrapOk(await run(closePreferenceWindow, actors.icuHead));
    expect(unwrapOk(await run(submitSchedule, actors.icuHead))).toMatchObject({
      status: "SUBMITTED",
    });
  });

  it("preferences that differ from the assignments do not block finalize", async () => {
    await completeInDraft();
    unwrapOk(await run(openPreferenceWindow, actors.icuHead));
    const assigned = (await listAssignments(db, S)).find(
      (a) => a.nurseId === U.icuNurse1.id && a.date === "2026-10-24",
    )!;
    const wish = assigned.shift === "N" ? "M" : "N";
    unwrapOk(
      await setMyPreference(as(actors.icuNurse), {
        scheduleId: S,
        date: "2026-10-24",
        value: wish,
      }),
    );
    unwrapOk(await run(closePreferenceWindow, actors.icuHead));
    const assignments = await listAssignments(db, S);

    expect(unwrapOk(await run(finalizeSchedule, actors.icuHead))).toMatchObject(
      { status: "FINALIZED" },
    );
    expect(await listAssignments(db, S)).toEqual(assignments);
  });
});
