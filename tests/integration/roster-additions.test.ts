import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { bootstrapHospitalAdmin } from "../../src/application/management/bootstrap";
import type { ActionResult } from "../../src/application/result";
import { setAssignments } from "../../src/application/schedules/edit-assignments";
import { openPreferenceWindow } from "../../src/application/schedules/preference-windows";
import {
  addRosterMembers,
  getRosterCandidates,
} from "../../src/application/schedules/roster";
import type { AppContext } from "../../src/application/use-case";
import { isoDate } from "../../src/domain/shared/dates";
import {
  auditEvents,
  notifications,
  schedules,
  shiftAssignments,
} from "../../src/infrastructure/db/schema";
import {
  DEMO_ER,
  DEMO_ICU,
  DEMO_SCHEDULE,
  DEMO_USERS as U,
} from "../../src/infrastructure/db/seed/demo-data";
import {
  addMembership,
  loadActor,
} from "../../src/infrastructure/repositories/memberships";
import { listRoster } from "../../src/infrastructure/repositories/roster";
import { findScheduleById } from "../../src/infrastructure/repositories/schedules";
import {
  createUser,
  setUserActive,
} from "../../src/infrastructure/repositories/users";
import { setupTestDatabase } from "./support/database";

const { db } = setupTestDatabase();
const TODAY = isoDate("2026-10-03");
const NOW = new Date("2026-10-03T08:00:00Z");
const S = DEMO_SCHEDULE.id;

const as = async (id: string): Promise<AppContext> => ({
  db,
  actor: (await loadActor(db, id, TODAY))!,
  clock: () => NOW,
});
let head: AppContext;

function data<T>(result: ActionResult<T>): T {
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) throw new Error(result.error.code);
  return result.data;
}
const revision = async () => (await findScheduleById(db, S))!.revision;

/** A nurse registered after the roster snapshot (e.g. imported). */
async function newcomer(
  personnelNumber: string,
  over: {
    role?: "NURSE" | "HEAD_NURSE";
    startedOn?: string;
    endedOn?: string;
    departmentId?: string;
  } = {},
) {
  const user = await createUser(db, {
    personnelNumber,
    displayName: `تازه‌وارد ${personnelNumber}`,
  });
  await addMembership(db, {
    userId: user.id,
    departmentId: over.departmentId ?? DEMO_ICU.id,
    role: over.role ?? "NURSE",
    startedOn: isoDate(over.startedOn ?? "2026-10-05"),
    endedOn: over.endedOn ? isoDate(over.endedOn) : null,
  });
  return user;
}

beforeEach(async () => {
  head = await as(U.icuHead.id);
});

describe("roster candidates", () => {
  it("lists only eligible members missing from the roster", async () => {
    const a = await newcomer("8001");
    const late = await newcomer("8002", { startedOn: "2026-11-21" });
    await newcomer("8003", { startedOn: "2026-11-22" }); // after the period
    await newcomer("8004", { departmentId: DEMO_ER.id }); // other department
    const inactive = await newcomer("8005");
    await setUserActive(db, inactive.id, false);

    const result = await getRosterCandidates(head, { scheduleId: S });
    expect(result.editable).toBe(true);
    expect(result.candidates.map((c) => c.userId).sort()).toEqual(
      [a.id, late.id].sort(),
    );
    expect(result.candidates[0]).toMatchObject({
      role: "NURSE",
      personnelNumber: expect.stringMatching(/^800[12]$/),
    });
    // Already rostered people are never candidates.
    const roster = (await listRoster(db, S)).map((r) => r.userId);
    expect(result.candidates.some((c) => roster.includes(c.userId))).toBe(
      false,
    );
  });

  it("is hidden from everyone but the department's Head Nurse", async () => {
    for (const id of [U.icuNurse1.id, U.erHead.id, U.supervisor.id])
      await expect(
        getRosterCandidates(await as(id), { scheduleId: S }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      getRosterCandidates(head, { scheduleId: "not-a-uuid" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("offers nothing once the schedule is finalized", async () => {
    await newcomer("8001");
    await db
      .update(schedules)
      .set({ status: "FINALIZED" })
      .where(eq(schedules.id, S));
    expect(await getRosterCandidates(head, { scheduleId: S })).toEqual({
      editable: false,
      candidates: [],
    });
  });
});

describe("addRosterMembers", () => {
  it("adds several members with their roles, audited, without touching assignments", async () => {
    await setAssignments(head, {
      scheduleId: S,
      expectedRevision: await revision(),
      changes: [{ nurseId: U.icuNurse1.id, date: "2026-10-25", shift: "N" }],
    });
    const assignmentsBefore = await db.select().from(shiftAssignments);
    const a = await newcomer("8001");
    const b = await newcomer("8002", { role: "HEAD_NURSE" });
    const before = await revision();

    const out = data(
      await addRosterMembers(head, {
        scheduleId: S,
        expectedRevision: before,
        userIds: [a.id, b.id],
      }),
    );
    expect(out).toEqual({
      revision: before + 1,
      added: [
        { userId: a.id, role: "NURSE" },
        { userId: b.id, role: "HEAD_NURSE" },
      ],
    });
    const roster = await listRoster(db, S);
    expect(roster.find((r) => r.userId === a.id)?.role).toBe("NURSE");
    expect(roster.find((r) => r.userId === b.id)?.role).toBe("HEAD_NURSE");
    expect(await db.select().from(shiftAssignments)).toEqual(assignmentsBefore);
    expect(await findScheduleById(db, S)).toMatchObject({ status: "DRAFT" });
    const [event] = (await db.select().from(auditEvents)).filter(
      (e) => e.action === "schedule.rosterMembersAdded",
    );
    expect(event).toMatchObject({
      actorId: U.icuHead.id,
      departmentId: DEMO_ICU.id,
      scheduleId: S,
      data: { count: 2, status: "DRAFT" },
    });
    expect(
      (await getRosterCandidates(head, { scheduleId: S })).candidates,
    ).toEqual([]);
  });

  it("works in PLANNING and notifies newcomers when a whole-roster window is open", async () => {
    data(
      await openPreferenceWindow(head, {
        scheduleId: S,
        expectedRevision: await revision(),
      }),
    );
    const a = await newcomer("8001");
    data(
      await addRosterMembers(head, {
        scheduleId: S,
        expectedRevision: await revision(),
        userIds: [a.id],
      }),
    );
    expect(
      await db
        .select()
        .from(notifications)
        .where(eq(notifications.recipientId, a.id)),
    ).toMatchObject([{ type: "PREFERENCES_OPENED", scheduleId: S }]);
  });

  it.each([
    "FINALIZED",
    "SUBMITTED",
    "RETURNED",
    "APPROVED",
    "REVISING",
  ] as const)("refuses %s schedules (immutable roster)", async (status) => {
    const a = await newcomer("8001");
    await db.update(schedules).set({ status }).where(eq(schedules.id, S));
    const result = await addRosterMembers(head, {
      scheduleId: S,
      expectedRevision: await revision(),
      userIds: [a.id],
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "INVALID_STATE", reason: "ADD_TO_ROSTER" },
    });
    expect((await listRoster(db, S)).some((r) => r.userId === a.id)).toBe(
      false,
    );
  });

  it("refuses duplicates, existing roster members and ineligible people as a whole", async () => {
    const a = await newcomer("8001");
    const other = await newcomer("8002", { departmentId: DEMO_ER.id });
    const rosterBefore = await listRoster(db, S);
    const base = { scheduleId: S, expectedRevision: await revision() };
    for (const userIds of [
      [a.id, a.id],
      [a.id, U.icuNurse1.id],
      [a.id, other.id],
      [a.id, U.inactiveNurse.id],
    ])
      expect(await addRosterMembers(head, { ...base, userIds })).toMatchObject({
        ok: false,
        error: { code: "VALIDATION" },
      });
    expect(await listRoster(db, S)).toEqual(rosterBefore);
    expect(await revision()).toBe(base.expectedRevision);
  });

  it("refuses a stale page (revision) and serializes concurrent additions", async () => {
    const a = await newcomer("8001");
    const expectedRevision = await revision();
    const results = await Promise.all([
      addRosterMembers(head, {
        scheduleId: S,
        expectedRevision,
        userIds: [a.id],
      }),
      addRosterMembers(head, {
        scheduleId: S,
        expectedRevision,
        userIds: [a.id],
      }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({
      error: { code: "CONFLICT" },
    });
    expect(
      (await listRoster(db, S)).filter((r) => r.userId === a.id),
    ).toHaveLength(1);
  });

  it("re-checks the account at write time (deactivated after the page was read)", async () => {
    const a = await newcomer("8001");
    await setUserActive(db, a.id, false);
    expect(
      await addRosterMembers(head, {
        scheduleId: S,
        expectedRevision: await revision(),
        userIds: [a.id],
      }),
    ).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
  });

  it("is Head Nurse of the schedule's department only (admins included are refused)", async () => {
    const a = await newcomer("8001");
    await bootstrapHospitalAdmin(
      db,
      { email: U.erHead.email, confirm: "ESTABLISH_FIRST_HOSPITAL_ADMIN" },
      NOW,
    );
    for (const id of [U.icuNurse1.id, U.erHead.id, U.supervisor.id])
      expect(
        await addRosterMembers(await as(id), {
          scheduleId: S,
          expectedRevision: await revision(),
          userIds: [a.id],
        }),
      ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });
});
