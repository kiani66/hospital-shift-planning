import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { setAssignments } from "../../src/application/schedules/edit-assignments";
import { getScheduleReview } from "../../src/application/schedules/review";
import type { AppContext } from "../../src/application/use-case";
import type { Actor } from "../../src/domain/authz/actor";
import { addDays, isoDate } from "../../src/domain/shared/dates";
import type { ShiftCode } from "../../src/domain/shifts/shift-type";
import {
  departmentMemberships,
  schedules,
  shiftAssignments,
  users,
} from "../../src/infrastructure/db/schema";
import {
  DEMO_ICU,
  DEMO_SCHEDULE,
  DEMO_USERS,
} from "../../src/infrastructure/db/seed/demo-data";
import { listAssignments } from "../../src/infrastructure/repositories/assignments";
import { listAuditEventsForSchedule } from "../../src/infrastructure/repositories/audit";
import { createDepartment } from "../../src/infrastructure/repositories/departments";
import { loadActor } from "../../src/infrastructure/repositories/memberships";
import {
  listPreferences,
  setPreference,
} from "../../src/infrastructure/repositories/preferences";
import { startRevision } from "../../src/infrastructure/repositories/revisions";
import {
  isOnRoster,
  listRoster,
  snapshotRosterFromMemberships,
} from "../../src/infrastructure/repositories/roster";
import {
  createSchedule as createScheduleRow,
  findScheduleById,
} from "../../src/infrastructure/repositories/schedules";
import { setUserActive } from "../../src/infrastructure/repositories/users";
import { setupTestDatabase } from "./support/database";

const { db, pool } = setupTestDatabase();
const U = DEMO_USERS;
const S = DEMO_SCHEDULE.id; // ICU, Aban 1405: 2026-10-23 .. 2026-11-21, DRAFT, revision 0
const TODAY = isoDate("2026-10-01");

const actors = {} as Record<
  "icuHead" | "erHead" | "icuNurse" | "supervisor",
  Actor
>;
const as = (actor: Actor): AppContext => ({ db, actor });

beforeEach(async () => {
  actors.icuHead = (await loadActor(db, U.icuHead.id, TODAY))!;
  actors.erHead = (await loadActor(db, U.erHead.id, TODAY))!;
  actors.icuNurse = (await loadActor(db, U.icuNurse1.id, TODAY))!;
  actors.supervisor = (await loadActor(db, U.supervisor.id, TODAY))!;
});

type Change = { nurseId: string; date: string; shift: ShiftCode | null };

const edit = (
  changes: Change[],
  expectedRevision: number,
  actor: Actor = actors.icuHead,
) => setAssignments(as(actor), { scheduleId: S, expectedRevision, changes });

/** Applies changes as the ICU Head Nurse at the current revision; returns the new revision. */
async function apply(...changes: Change[]): Promise<number> {
  const { revision } = (await findScheduleById(db, S))!;
  const result = await edit(changes, revision);
  if (!result.ok) throw new Error(result.error.message);
  return result.data.revision;
}

const stored = async () =>
  (await listAssignments(db, S)).map((a) => [a.nurseId, a.date, a.shift]);

const reviewDay = async (day: string) =>
  (
    await getScheduleReview(as(actors.icuHead), {
      departmentId: DEMO_ICU.id,
      scheduleId: S,
      day,
    })
  ).day!;

describe("assign, change and clear", () => {
  it("assigns a shift to a rostered nurse and bumps the revision", async () => {
    const result = await edit(
      [{ nurseId: U.icuNurse1.id, date: "2026-10-24", shift: "M" }],
      0,
    );
    expect(result).toEqual({
      ok: true,
      data: {
        revision: 1,
        changes: [
          {
            nurseId: U.icuNurse1.id,
            date: "2026-10-24",
            before: null,
            after: "M",
          },
        ],
      },
    });
    expect(await stored()).toEqual([[U.icuNurse1.id, "2026-10-24", "M"]]);
    expect(await findScheduleById(db, S)).toMatchObject({
      revision: 1,
      status: "DRAFT",
    });
  });

  it("changes an existing assignment in one logical edit (M → E → N → ME)", async () => {
    await apply({ nurseId: U.icuNurse1.id, date: "2026-10-24", shift: "M" });
    for (const [before, after] of [
      ["M", "E"],
      ["E", "N"],
      ["N", "ME"],
    ] as const) {
      const { revision } = (await findScheduleById(db, S))!;
      const result = await edit(
        [{ nurseId: U.icuNurse1.id, date: "2026-10-24", shift: after }],
        revision,
      );
      expect(result.ok && result.data.changes).toEqual([
        { nurseId: U.icuNurse1.id, date: "2026-10-24", before, after },
      ]);
      // Still exactly one assignment for the nurse and day (D15).
      expect(await stored()).toEqual([[U.icuNurse1.id, "2026-10-24", after]]);
    }
  });

  it("clears an assignment without touching the roster, the membership or the user", async () => {
    await apply({ nurseId: U.icuNurse2.id, date: "2026-10-25", shift: "E" });
    const rosterBefore = await listRoster(db, S);
    const actor = await loadActor(db, U.icuNurse2.id, TODAY);

    const result = await edit(
      [{ nurseId: U.icuNurse2.id, date: "2026-10-25", shift: null }],
      1,
    );
    expect(result.ok && result.data.changes).toEqual([
      {
        nurseId: U.icuNurse2.id,
        date: "2026-10-25",
        before: "E",
        after: null,
      },
    ]);
    expect(await stored()).toEqual([]);
    expect(await listRoster(db, S)).toEqual(rosterBefore);
    expect(await isOnRoster(db, S, U.icuNurse2.id)).toBe(true);
    expect(await loadActor(db, U.icuNurse2.id, TODAY)).toEqual(actor);

    // Still in the day's editing list, unassigned and available again.
    const day = await reviewDay("2026-10-25");
    expect(day.roster.find((n) => n.userId === U.icuNurse2.id)).toMatchObject({
      shift: null,
    });
    expect(day.unassigned.map((n) => n.userId)).toContain(U.icuNurse2.id);
    // …and can be assigned again.
    await apply({ nurseId: U.icuNurse2.id, date: "2026-10-25", shift: "N" });
    expect(await stored()).toEqual([[U.icuNurse2.id, "2026-10-25", "N"]]);
  });

  it("gives the Head Nurse shifts too, and lets them change and clear their own", async () => {
    await apply({ nurseId: U.icuHead.id, date: "2026-10-24", shift: "ME" });
    await apply({ nurseId: U.icuHead.id, date: "2026-10-24", shift: "M" });
    expect(await stored()).toEqual([[U.icuHead.id, "2026-10-24", "M"]]);
    const day = await reviewDay("2026-10-24");
    expect(day.roster.find((n) => n.userId === U.icuHead.id)).toMatchObject({
      role: "HEAD_NURSE",
      shift: "M",
    });
    await apply({ nurseId: U.icuHead.id, date: "2026-10-24", shift: null });
    expect(await stored()).toEqual([]);
  });

  it("applies a bounded range for one nurse in one transaction", async () => {
    const dates = ["2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27"];
    await apply({ nurseId: U.icuNurse3.id, date: "2026-10-25", shift: "M" });
    const result = await edit(
      dates.map((date) => ({ nurseId: U.icuNurse3.id, date, shift: "M" })),
      1,
    );
    // The day that already had M is not a change.
    expect(result.ok && result.data.changes.map((c) => c.date)).toEqual([
      "2026-10-24",
      "2026-10-26",
      "2026-10-27",
    ]);
    expect(result.ok && result.data.revision).toBe(2);

    const cleared = await edit(
      dates.map((date) => ({ nurseId: U.icuNurse3.id, date, shift: null })),
      2,
    );
    expect(cleared.ok && cleared.data.changes).toHaveLength(4);
    expect(await stored()).toEqual([]);
  });
});

describe("uniqueness and idempotency", () => {
  it("never stores two assignments for one nurse and day, whatever is sent", async () => {
    await apply({ nurseId: U.icuNurse1.id, date: "2026-10-24", shift: "M" });
    await apply({ nurseId: U.icuNurse1.id, date: "2026-10-24", shift: "E" });
    const twice = await edit(
      [
        { nurseId: U.icuNurse1.id, date: "2026-10-24", shift: "N" },
        { nurseId: U.icuNurse1.id, date: "2026-10-24", shift: "ME" },
      ],
      2,
    );
    expect(twice).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
    expect(await stored()).toEqual([[U.icuNurse1.id, "2026-10-24", "E"]]);
    const [{ count }] = (
      await db.execute<{ count: number }>(
        sql`select count(*)::int as count from shift_assignments where schedule_id = ${S}`,
      )
    ).rows as [{ count: number }];
    expect(count).toBe(1);
  });

  it("treats repeating the stored state as a no-op: nothing written, audited or bumped", async () => {
    await apply({ nurseId: U.icuNurse1.id, date: "2026-10-24", shift: "M" });
    const auditBefore = (await listAuditEventsForSchedule(db, S)).length;
    // A retried request (old revision) repeating what is stored succeeds harmlessly.
    const retried = await edit(
      [
        { nurseId: U.icuNurse1.id, date: "2026-10-24", shift: "M" },
        { nurseId: U.icuNurse2.id, date: "2026-10-24", shift: null },
      ],
      0,
    );
    expect(retried).toEqual({ ok: true, data: { revision: 1, changes: [] } });
    expect((await listAuditEventsForSchedule(db, S)).length).toBe(auditBefore);
    expect((await findScheduleById(db, S))!.revision).toBe(1);
  });
});

describe("validation after edits (night rest, D7)", () => {
  it("allows the violating edit, reports it on the day after the night and on the night itself, and clears it once fixed", async () => {
    await apply({ nurseId: U.icuNurse4.id, date: "2026-10-25", shift: "N" });
    // Allowed while editing: the edit is stored, the finding appears.
    const result = await edit(
      [{ nurseId: U.icuNurse4.id, date: "2026-10-26", shift: "M" }],
      1,
    );
    expect(result.ok).toBe(true);

    const after = await reviewDay("2026-10-26");
    expect(after.validation).toMatchObject({
      state: "RULE_VIOLATION",
      ruleViolations: 1,
    });
    expect(after.findings.filter((f) => f.code === "NIGHT_REST")).toHaveLength(
      1,
    );
    expect(after.findings.find((f) => f.code === "NIGHT_REST")).toMatchObject({
      code: "NIGHT_REST",
      blocking: true,
      nurseIds: [U.icuNurse4.id],
      shift: "M",
      nurses: [{ displayName: U.icuNurse4.displayName }],
    });
    // The night's day shows it as related, so editing either day explains it.
    const night = await reviewDay("2026-10-25");
    expect(night.validation.ready).toBe(false);
    expect(night.relatedFindings.map((f) => f.code)).toEqual(["NIGHT_REST"]);

    // Fixing the day after (clearing it) removes the finding on both days.
    await apply({ nurseId: U.icuNurse4.id, date: "2026-10-26", shift: null });
    const fixed = await reviewDay("2026-10-26");
    expect(fixed.findings.filter((f) => f.code === "NIGHT_REST")).toEqual([]);
    expect(fixed.validation).toMatchObject({
      state: "NOT_STARTED",
      ruleViolations: 0,
    });
    expect((await reviewDay("2026-10-25")).relatedFindings).toEqual([]);
  });

  it("re-validates the next day when the night itself is edited (no stale neighbour)", async () => {
    await apply(
      { nurseId: U.icuNurse4.id, date: "2026-10-25", shift: "E" },
      { nurseId: U.icuNurse4.id, date: "2026-10-26", shift: "M" },
    );
    expect(
      (await reviewDay("2026-10-26")).findings.filter(
        (f) => f.code === "NIGHT_REST",
      ),
    ).toEqual([]);
    // Changing the 25th to a Night makes the 26th need attention…
    await apply({ nurseId: U.icuNurse4.id, date: "2026-10-25", shift: "N" });
    expect((await reviewDay("2026-10-26")).validation.ruleViolations).toBe(1);
    // …and changing it back fixes it, without touching the 26th.
    await apply({ nurseId: U.icuNurse4.id, date: "2026-10-25", shift: "ME" });
    expect(
      (await reviewDay("2026-10-26")).findings.filter(
        (f) => f.code === "NIGHT_REST",
      ),
    ).toEqual([]);
  });
});

describe("authorization", () => {
  it("rejects the Head Nurse of another department, and writes nothing", async () => {
    const result = await edit(
      [{ nurseId: U.icuNurse1.id, date: "2026-10-24", shift: "M" }],
      0,
      actors.erHead,
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN", reason: "NOT_HEAD_NURSE_OF_DEPARTMENT" },
    });
    expect(await stored()).toEqual([]);
  });

  it("rejects a nurse of the department (their own day included) and a supervisor", async () => {
    for (const actor of [actors.icuNurse, actors.supervisor]) {
      const result = await edit(
        [{ nurseId: actor.userId, date: "2026-10-24", shift: "M" }],
        0,
        actor,
      );
      expect(result).toMatchObject({
        ok: false,
        error: { code: "FORBIDDEN" },
      });
    }
    expect(await stored()).toEqual([]);
  });

  it("rejects a deactivated Head Nurse", async () => {
    await setUserActive(db, U.icuHead.id, false);
    const inactive = (await loadActor(db, U.icuHead.id, TODAY))!;
    const result = await edit(
      [{ nurseId: U.icuNurse1.id, date: "2026-10-24", shift: "M" }],
      0,
      inactive,
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN", reason: "ACTOR_INACTIVE" },
    });
  });

  it("answers an unknown schedule with NOT_FOUND, a stale revision seen only after authorizing", async () => {
    const unknown = await setAssignments(as(actors.icuHead), {
      scheduleId: "00000000-0000-4000-8000-000000000000",
      expectedRevision: 0,
      changes: [{ nurseId: U.icuNurse1.id, date: "2026-10-24", shift: "M" }],
    });
    expect(unknown).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    // An outsider with a wrong revision learns FORBIDDEN, not CONFLICT.
    const outsider = await edit(
      [{ nurseId: U.icuNurse1.id, date: "2026-10-24", shift: "M" }],
      99,
      actors.erHead,
    );
    expect(outsider).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });
});

describe("roster, period and lifecycle", () => {
  it("rejects a person who is not on the schedule roster", async () => {
    const result = await edit(
      [{ nurseId: U.erNurse1.id, date: "2026-10-24", shift: "M" }],
      0,
    );
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "VALIDATION",
        fieldErrors: { nurseId: expect.any(Array) },
      },
    });
  });

  it("rejects a date outside the period and malformed input", async () => {
    expect(
      await edit(
        [{ nurseId: U.icuNurse1.id, date: "2026-11-22", shift: "M" }],
        0,
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "VALIDATION", fieldErrors: { date: expect.any(Array) } },
    });
    expect(
      await edit(
        [{ nurseId: U.icuNurse1.id, date: "2026-10-24", shift: "X" as never }],
        0,
      ),
    ).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
    expect(await edit([], 0)).toMatchObject({
      ok: false,
      error: { code: "VALIDATION" },
    });
  });

  it("allows edits in DRAFT, PLANNING and FINALIZED without changing the status", async () => {
    for (const status of ["DRAFT", "PLANNING", "FINALIZED"] as const) {
      await db.update(schedules).set({ status }).where(eq(schedules.id, S));
      await apply({
        nurseId: U.icuNurse1.id,
        date: "2026-10-24",
        shift: status === "PLANNING" ? "E" : "M",
      });
      expect((await findScheduleById(db, S))!.status).toBe(status);
    }
  });

  it("refuses edits while SUBMITTED or APPROVED (INVALID_STATE, nothing written)", async () => {
    for (const status of ["SUBMITTED", "APPROVED"] as const) {
      await db.update(schedules).set({ status }).where(eq(schedules.id, S));
      const result = await edit(
        [{ nurseId: U.icuNurse1.id, date: "2026-10-24", shift: "M" }],
        0,
      );
      expect(result).toMatchObject({
        ok: false,
        error: { code: "INVALID_STATE", reason: "EDIT_ASSIGNMENT" },
      });
    }
    expect(await stored()).toEqual([]);
    const review = await getScheduleReview(as(actors.icuHead), {
      departmentId: DEMO_ICU.id,
      scheduleId: S,
      day: "2026-10-24",
    });
    expect(review.month.editable).toBe(false);
    expect(review.day!.edit).toEqual({
      allowed: false,
      reason: "SCHEDULE_LOCKED",
    });
  });

  it("limits a revision to its declared dates (D14)", async () => {
    await db
      .update(schedules)
      .set({ status: "REVISING" })
      .where(eq(schedules.id, S));
    await startRevision(db, {
      scheduleId: S,
      reason: "آزمایش",
      startedBy: U.icuHead.id,
      dates: [isoDate("2026-11-01")],
    });
    expect(
      await edit(
        [{ nurseId: U.icuNurse1.id, date: "2026-10-24", shift: "M" }],
        0,
      ),
    ).toMatchObject({
      ok: false,
      error: {
        code: "INVALID_STATE",
        reason: "EDIT_ASSIGNMENT_OUTSIDE_REVISION_SCOPE",
      },
    });
    await apply({ nurseId: U.icuNurse1.id, date: "2026-11-01", shift: "M" });
    expect((await reviewDay("2026-11-01")).edit).toEqual({ allowed: true });
    expect((await reviewDay("2026-10-24")).edit).toEqual({
      allowed: false,
      reason: "DATE_OUTSIDE_REVISION_SCOPE",
    });
  });
});

describe("concurrency", () => {
  it("rejects a stale revision instead of overwriting newer work", async () => {
    // Tab A and tab B both read revision 0; A saves first.
    await edit(
      [{ nurseId: U.icuNurse1.id, date: "2026-10-24", shift: "M" }],
      0,
    );
    const b = await edit(
      [{ nurseId: U.icuNurse1.id, date: "2026-10-24", shift: "N" }],
      0,
    );
    expect(b).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    expect(await stored()).toEqual([[U.icuNurse1.id, "2026-10-24", "M"]]);
  });

  it("serializes simultaneous edits: exactly one of two same-revision writes wins", async () => {
    const [a, b] = await Promise.all([
      edit([{ nurseId: U.icuNurse1.id, date: "2026-10-24", shift: "M" }], 0),
      edit([{ nurseId: U.icuNurse2.id, date: "2026-10-24", shift: "E" }], 0),
    ]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect([a, b].find((r) => !r.ok)).toMatchObject({
      error: { code: "CONFLICT" },
    });
    expect(await stored()).toHaveLength(1);
    expect((await findScheduleById(db, S))!.revision).toBe(1);
  });
});

describe("audit and transaction", () => {
  it("audits every changed cell with actor, schedule, date, nurse, before and after", async () => {
    await apply({ nurseId: U.icuNurse1.id, date: "2026-10-24", shift: "M" });
    await apply({ nurseId: U.icuNurse1.id, date: "2026-10-24", shift: "N" });
    await apply({ nurseId: U.icuNurse1.id, date: "2026-10-24", shift: null });
    const events = await listAuditEventsForSchedule(db, S);
    expect(
      events.map((e) => ({
        action: e.action,
        actorId: e.actorId,
        departmentId: e.departmentId,
        entityType: e.entityType,
        entityId: e.entityId,
        data: e.data,
      })),
    ).toEqual(
      (
        [
          ["assignment.created", null, "M"],
          ["assignment.changed", "M", "N"],
          ["assignment.cleared", "N", null],
        ] as const
      ).map(([action, before, after]) => ({
        action,
        actorId: U.icuHead.id,
        departmentId: DEMO_ICU.id,
        entityType: "assignment",
        entityId: `${U.icuNurse1.id}:2026-10-24`,
        data: {
          date: "2026-10-24",
          nurseId: U.icuNurse1.id,
          before,
          after,
        },
      })),
    );
    expect(events.every((e) => e.occurredAt instanceof Date)).toBe(true);
  });

  it("rolls back every cell, audit event and the revision when a later write fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    // Make the second audit insert of the transaction fail.
    await db.execute(
      sql`alter table audit_events add constraint test_reject_cleared check (action <> 'assignment.cleared') not valid`,
    );
    await apply({ nurseId: U.icuNurse2.id, date: "2026-10-25", shift: "E" });
    try {
      const result = await edit(
        [
          { nurseId: U.icuNurse1.id, date: "2026-10-24", shift: "M" },
          { nurseId: U.icuNurse2.id, date: "2026-10-25", shift: null },
        ],
        1,
      );
      // The database refuses the write; nothing of the request may remain.
      expect(result.ok).toBe(false);
    } finally {
      await db.execute(
        sql`alter table audit_events drop constraint test_reject_cleared`,
      );
    }
    expect(await stored()).toEqual([[U.icuNurse2.id, "2026-10-25", "E"]]);
    expect((await findScheduleById(db, S))!.revision).toBe(1);
    expect(
      (await listAuditEventsForSchedule(db, S)).map((e) => e.action),
    ).toEqual(["assignment.created"]);
    log.mockRestore();
  });

  it("leaves nurses' preferences untouched, including a differing wish", async () => {
    await setPreference(db, {
      scheduleId: S,
      userId: U.icuNurse1.id,
      date: isoDate("2026-10-24"),
      value: "N",
    });
    await setPreference(db, {
      scheduleId: S,
      userId: U.icuHead.id,
      date: isoDate("2026-10-24"),
      value: "OFF",
    });
    const before = await listPreferences(db, S);
    await apply(
      { nurseId: U.icuNurse1.id, date: "2026-10-24", shift: "M" },
      { nurseId: U.icuHead.id, date: "2026-10-24", shift: "E" },
    );
    await apply({ nurseId: U.icuNurse1.id, date: "2026-10-24", shift: null });
    expect(await listPreferences(db, S)).toEqual(before);
    // Shown as context in the editing list, never as the assignment.
    const day = await reviewDay("2026-10-24");
    expect(day.roster.find((n) => n.userId === U.icuHead.id)).toMatchObject({
      preference: "OFF",
      shift: "E",
    });
  });
});

describe("review data for editing", () => {
  it("reports the revision, editability and the whole roster for the day", async () => {
    const revision = await apply({
      nurseId: U.icuNurse1.id,
      date: "2026-10-24",
      shift: "M",
    });
    const review = await getScheduleReview(as(actors.icuHead), {
      departmentId: DEMO_ICU.id,
      scheduleId: S,
      day: "2026-10-24",
    });
    expect(review.month).toMatchObject({ revision, editable: true });
    const roster = await listRoster(db, S);
    expect(review.day!.roster.map((n) => n.userId)).toEqual(
      roster.map((r) => r.userId),
    );
    expect(review.day!.edit).toEqual({ allowed: true });
  });

  it("gives a supervisor (read-only from FINALIZED) no editing", async () => {
    await db
      .update(schedules)
      .set({ status: "FINALIZED" })
      .where(eq(schedules.id, S));
    const review = await getScheduleReview(as(actors.supervisor), {
      departmentId: DEMO_ICU.id,
      scheduleId: S,
      day: "2026-10-24",
    });
    expect(review.month.editable).toBe(false);
    expect(review.day!.edit).toEqual({
      allowed: false,
      reason: "NOT_AUTHORIZED",
    });
  });
});

describe("performance", () => {
  /** A department of `size` nurses with a fully planned 31-day month (Farvardin 1406). */
  async function department(size: number) {
    const dept = await createDepartment(db, {
      code: `edit-load-${size}`,
      name: `بخش ${size} نفره`,
    });
    const people = await db
      .insert(users)
      .values(
        Array.from({ length: size }, (_, i) => ({
          email: `edit${size}.${i}@test.invalid`,
          displayName: `پرستار ${i}`,
        })),
      )
      .returning({ id: users.id });
    await db.insert(departmentMemberships).values(
      people.map((p, i) => ({
        userId: p.id,
        departmentId: dept.id,
        role: i === 0 ? ("HEAD_NURSE" as const) : ("NURSE" as const),
        startedOn: "2026-01-01",
      })),
    );
    const period = { start: isoDate("2027-03-21"), end: isoDate("2027-04-20") };
    const schedule = await createScheduleRow(db, {
      departmentId: dept.id,
      period,
      label: "فروردین ۱۴۰۶",
      createdBy: people[0]!.id,
    });
    await snapshotRosterFromMemberships(db, {
      scheduleId: schedule.id,
      addedBy: people[0]!.id,
    });
    const pattern: (ShiftCode | null)[] = ["M", "E", "ME", "N", null];
    await db.insert(shiftAssignments).values(
      people.flatMap((p, i) =>
        Array.from({ length: 31 }, (_, d) => {
          const shift = pattern[(i + d) % pattern.length];
          return shift
            ? {
                scheduleId: schedule.id,
                userId: p.id,
                date: addDays(period.start, d),
                shiftCode: shift,
                updatedBy: people[0]!.id,
              }
            : null;
        }).filter((r) => r !== null),
      ),
    );
    const head = (await loadActor(db, people[0]!.id, TODAY))!;
    return { schedule, head, nurse: people[1]!.id, period };
  }

  /** Statements sent to PostgreSQL by one edit (inside its transaction). */
  async function statementsFor(
    d: Awaited<ReturnType<typeof department>>,
    dates: string[],
  ) {
    const { revision } = (await findScheduleById(db, d.schedule.id))!;
    // Transactions run on a client checked out of the pool: count its queries.
    let count = 0;
    const wrapped = new WeakSet<object>();
    const onAcquire = (client: { query: (...args: never[]) => unknown }) => {
      if (wrapped.has(client)) return;
      wrapped.add(client);
      const query = client.query.bind(client);
      client.query = (...args: never[]) => {
        count += 1;
        return query(...args);
      };
    };
    pool.on("acquire", onAcquire);
    try {
      const result = await setAssignments(as(d.head), {
        scheduleId: d.schedule.id,
        expectedRevision: revision,
        changes: dates.map((date) => ({ nurseId: d.nurse, date, shift: "M" })),
      });
      expect(result.ok).toBe(true);
    } finally {
      pool.off("acquire", onAcquire);
    }
    return count;
  }

  it("uses a constant number of statements per edit, whatever the roster size (60 × 31)", async () => {
    const small = await department(6);
    const large = await department(60);
    // These are ME days for nurse 1 in the pattern, so setting M changes each.
    const one = ["2027-03-22"];
    const single = await statementsFor(large, one);
    expect(single).toBe(await statementsFor(small, one));
    // A range adds a write and an audit row per changed day, nothing per nurse.
    const range = ["2027-03-27", "2027-04-01", "2027-04-06"];
    expect((await statementsFor(large, range)) - single).toBe(
      2 * (range.length - 1),
    );
  });
});
