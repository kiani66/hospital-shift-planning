import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Actor } from "../../src/domain/authz/actor";
import { isoDate } from "../../src/domain/shared/dates";
import type { AppContext } from "../../src/application/use-case";
import {
  DEMO_SCHEDULE,
  DEMO_USERS,
} from "../../src/infrastructure/db/seed/demo-data";
import { setAssignment } from "../../src/infrastructure/repositories/assignments";
import { listAuditEventsForSchedule } from "../../src/infrastructure/repositories/audit";
import { loadActor } from "../../src/infrastructure/repositories/memberships";
import {
  findScheduleById,
  updateSchedule,
} from "../../src/infrastructure/repositories/schedules";
import {
  finalizeForTest,
  openPreferencesForTest,
  submitTwiceForTest,
} from "./support/example-commands";
import { setupTestDatabase } from "./support/database";

const { db } = setupTestDatabase();
const U = DEMO_USERS;
const S = DEMO_SCHEDULE.id;
const TODAY = isoDate("2026-10-01");

let headNurse: Actor;
let nurse: Actor;
let otherHeadNurse: Actor;
const as = (actor: Actor, clock?: () => Date): AppContext => ({
  db,
  actor,
  clock,
});

beforeEach(async () => {
  headNurse = (await loadActor(db, U.icuHead.id, TODAY))!;
  nurse = (await loadActor(db, U.icuNurse1.id, TODAY))!;
  otherHeadNurse = (await loadActor(db, U.erHead.id, TODAY))!;
});

const state = async () => {
  const schedule = (await findScheduleById(db, S))!;
  const { rows } = await db.execute<{
    audit: number;
    notifications: number;
  }>(sql`
    select (select count(*)::int from audit_events) as audit,
           (select count(*)::int from notifications) as notifications
  `);
  return { status: schedule.status, revision: schedule.revision, ...rows[0]! };
};

const UNCHANGED = { status: "DRAFT", revision: 0, audit: 0, notifications: 0 };

describe("command transaction: commit", () => {
  it("persists the change, one audit event and the notifications together", async () => {
    const result = await openPreferencesForTest(as(headNurse), {
      scheduleId: S,
      expectedRevision: 0,
    });

    expect(result).toMatchObject({
      ok: true,
      data: { status: "PLANNING", revision: 1 },
    });
    expect(await state()).toEqual({
      status: "PLANNING",
      revision: 1,
      audit: 1,
      notifications: 5,
    });

    const [event] = await listAuditEventsForSchedule(db, S);
    expect(event).toMatchObject({
      actorId: U.icuHead.id,
      action: "schedule.preferencesOpened",
      data: { from: "DRAFT", to: "PLANNING" },
    });
  });

  it("uses the injected clock", async () => {
    const at = new Date("2026-10-01T06:00:00Z");
    const result = await openPreferencesForTest(
      as(headNurse, () => at),
      { scheduleId: S, expectedRevision: 0 },
    );
    expect(result.ok && result.data.now).toEqual(at);
  });
});

describe("command transaction: rollback", () => {
  it("rolls back the change, the audit event and the notifications when the handler fails after writing", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await openPreferencesForTest(as(headNurse), {
      scheduleId: S,
      expectedRevision: 0,
      failAfterWrites: true,
    });

    expect(result).toEqual({
      ok: false,
      error: { code: "INTERNAL", message: "Something went wrong" },
    });
    expect(JSON.stringify(result)).not.toContain("do-not-leak");
    expect(await state()).toEqual(UNCHANGED);
    expect(log).toHaveBeenCalledOnce();
  });

  it("rolls back when a domain rule rejects the change after audit was written (RULE_VIOLATION)", async () => {
    await updateSchedule(db, {
      id: S,
      expectedRevision: 0,
      status: "PLANNING",
    });
    await setAssignment(db, {
      scheduleId: S,
      userId: U.icuNurse1.id,
      date: isoDate("2026-10-24"),
      shift: "N",
      updatedBy: U.icuHead.id,
    });
    await setAssignment(db, {
      scheduleId: S,
      userId: U.icuNurse1.id,
      date: isoDate("2026-10-25"),
      shift: "M",
      updatedBy: U.icuHead.id,
    });

    const result = await finalizeForTest(as(headNurse), { scheduleId: S });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("RULE_VIOLATION");
      expect(result.error.violations).toEqual([
        expect.objectContaining({
          rule: "NIGHT_REST",
          nurseId: U.icuNurse1.id,
          date: "2026-10-25",
        }),
      ]);
    }
    expect(await state()).toEqual({
      status: "PLANNING",
      revision: 1,
      audit: 0,
      notifications: 0,
    });
  });

  it("finalizes when there are no violations", async () => {
    await updateSchedule(db, {
      id: S,
      expectedRevision: 0,
      status: "PLANNING",
    });
    expect(await finalizeForTest(as(headNurse), { scheduleId: S })).toEqual({
      ok: true,
      data: "FINALIZED",
    });
  });

  it("rejects a disallowed transition (INVALID_STATE) without writing", async () => {
    await updateSchedule(db, {
      id: S,
      expectedRevision: 0,
      status: "APPROVED",
    });
    const result = await openPreferencesForTest(as(headNurse), {
      scheduleId: S,
      expectedRevision: 1,
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "INVALID_STATE" },
    });
    expect(await state()).toEqual({
      status: "APPROVED",
      revision: 1,
      audit: 0,
      notifications: 0,
    });
  });

  it("maps a unique-constraint violation to CONFLICT and rolls back the first insert", async () => {
    const result = await submitTwiceForTest(as(headNurse), { scheduleId: S });
    expect(result).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    const { rows } = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from schedule_submissions`,
    );
    expect(rows[0]!.n).toBe(0);
  });
});

describe("command authorization", () => {
  it.each([
    ["a nurse", () => nurse, "NOT_HEAD_NURSE_OF_DEPARTMENT"],
    [
      "another department's head nurse",
      () => otherHeadNurse,
      "NOT_HEAD_NURSE_OF_DEPARTMENT",
    ],
    [
      "a deactivated head nurse",
      () => ({ ...headNurse, isActive: false }),
      "ACTOR_INACTIVE",
    ],
  ])("denies %s and writes nothing", async (_, actor, reason) => {
    const result = await openPreferencesForTest(as(actor()), {
      scheduleId: S,
      expectedRevision: 0,
    });
    expect(result).toEqual({
      ok: false,
      error: {
        code: "FORBIDDEN",
        message: "You are not allowed to do this",
        reason,
      },
    });
    expect(await state()).toEqual(UNCHANGED);
  });

  it("fails closed when a handler forgets to authorize", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await openPreferencesForTest(as(headNurse), {
      scheduleId: S,
      expectedRevision: 0,
      skipAuthorization: true,
    });
    expect(result).toMatchObject({ ok: false, error: { code: "INTERNAL" } });
    expect(await state()).toEqual(UNCHANGED);
  });
});

describe("command input and lookups", () => {
  it("rejects invalid input before opening a transaction (VALIDATION with field errors)", async () => {
    const result = await openPreferencesForTest(as(headNurse), {
      scheduleId: "not-a-uuid",
      expectedRevision: -1,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION");
      expect(Object.keys(result.error.fieldErrors ?? {}).sort()).toEqual([
        "expectedRevision",
        "scheduleId",
      ]);
    }
  });

  it("reports an unknown schedule as NOT_FOUND", async () => {
    const result = await openPreferencesForTest(as(headNurse), {
      scheduleId: "99999999-0000-4000-8000-000000000000",
      expectedRevision: 0,
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND", message: "Schedule not found" },
    });
  });

  it("reports a stale expected revision as CONFLICT", async () => {
    const result = await openPreferencesForTest(as(headNurse), {
      scheduleId: S,
      expectedRevision: 3,
    });
    expect(result).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    expect(await state()).toEqual(UNCHANGED);
  });
});

describe("concurrency", () => {
  it("serializes two writers on the same schedule: the second sees the new revision and gets CONFLICT", async () => {
    const [first, second] = await Promise.all([
      openPreferencesForTest(as(headNurse), {
        scheduleId: S,
        expectedRevision: 0,
        holdLockMs: 300,
      }),
      new Promise((r) => setTimeout(r, 50)).then(() =>
        openPreferencesForTest(as(headNurse), {
          scheduleId: S,
          expectedRevision: 0,
        }),
      ),
    ]);
    expect(first).toMatchObject({ ok: true, data: { revision: 1 } });
    expect(second).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    expect(await state()).toEqual({
      status: "PLANNING",
      revision: 1,
      audit: 1,
      notifications: 5,
    });
  });
});
