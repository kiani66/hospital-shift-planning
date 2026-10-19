import { and, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyScheduleCopy,
  getScheduleCopySource,
  previewScheduleCopy,
  type ScheduleCopyInput,
} from "../../src/application/schedules/copy";
import * as assignmentEditing from "../../src/application/schedules/edit-assignments";
import { setAssignments } from "../../src/application/schedules/edit-assignments";
import type { AppContext } from "../../src/application/use-case";
import { isoDate } from "../../src/domain/shared/dates";
import type { ScheduleStatus } from "../../src/domain/schedule/status";
import type { AssignmentCode } from "../../src/domain/shifts/shift-type";
import { schedules, scheduleRoster } from "../../src/infrastructure/db/schema";
import {
  DEMO_ICU,
  DEMO_ER,
  DEMO_SCHEDULE,
  DEMO_USERS as U,
} from "../../src/infrastructure/db/seed/demo-data";
import {
  listAssignments,
  setAssignment,
} from "../../src/infrastructure/repositories/assignments";
import { listAuditEventsForSchedule } from "../../src/infrastructure/repositories/audit";
import {
  endMembership,
  loadActor,
} from "../../src/infrastructure/repositories/memberships";
import {
  listPreferences,
  setPreference,
} from "../../src/infrastructure/repositories/preferences";
import { startRevision } from "../../src/infrastructure/repositories/revisions";
import {
  addToRoster,
  snapshotRosterFromMemberships,
} from "../../src/infrastructure/repositories/roster";
import {
  createSchedule,
  findScheduleById,
} from "../../src/infrastructure/repositories/schedules";
import { setUserActive } from "../../src/infrastructure/repositories/users";
import { setupTestDatabase } from "./support/database";
import {
  pinTestRuleSet,
  publishTestRuleSet,
  ruleContent,
} from "./support/rule-sets";

const { db } = setupTestDatabase();
const T = DEMO_SCHEDULE.id;
const sourcePeriod = {
  start: isoDate("2026-09-23"),
  end: isoDate("2026-10-22"),
};
let S: string;
let ctx: AppContext;
const raw = (extra: Partial<ScheduleCopyInput> = {}) => ({
  sourceScheduleId: S,
  targetScheduleId: T,
  scope: { mode: "MONTH" as const },
  ...extra,
});
const put = (
  scheduleId: string,
  userId: string,
  date: string,
  shift: AssignmentCode = "M",
) =>
  setAssignment(db, {
    scheduleId,
    userId,
    date: isoDate(date),
    shift,
    updatedBy: U.icuHead.id,
  });
const preview = (input = raw(), as = ctx) => previewScheduleCopy(as, input);
const state = async () => ({
  source: await listAssignments(db, S),
  target: await listAssignments(db, T),
  schedule: await findScheduleById(db, T),
  preferences: await listPreferences(db, T),
  audit: await listAuditEventsForSchedule(db, T),
});
const actorContext = async (userId: string) => ({
  ...ctx,
  actor: (await loadActor(db, userId, isoDate("2026-10-19")))!,
});
const status = (s: ScheduleStatus) =>
  db.update(schedules).set({ status: s }).where(eq(schedules.id, T));

beforeEach(async () => {
  ctx = {
    db,
    actor: (await loadActor(db, U.icuHead.id, isoDate("2026-10-19")))!,
    clock: () => new Date("2026-10-19T10:00:00Z"),
  };
  const source = await createSchedule(db, {
    departmentId: DEMO_ICU.id,
    period: sourcePeriod,
    label: "مهر ۱۴۰۵",
    createdBy: U.icuHead.id,
  });
  S = source.id;
  await snapshotRosterFromMemberships(db, {
    scheduleId: S,
    addedBy: U.icuHead.id,
  });
  await put(S, U.icuNurse1.id, "2026-09-25");
});

describe("Smart Schedule Copy", () => {
  it("preview is completely read-only; apply persists only reviewed assignments and aggregate plus ordinary history", async () => {
    await put(S, U.icuNurse2.id, "2026-09-25", "E");
    await put(T, U.icuNurse2.id, "2026-10-25", "H");
    await put(S, U.icuNurse1.id, "2026-09-26", "H");
    await setPreference(db, {
      scheduleId: S,
      userId: U.icuNurse1.id,
      date: isoDate("2026-09-25"),
      value: "E",
    });
    await setPreference(db, {
      scheduleId: T,
      userId: U.icuNurse1.id,
      date: isoDate("2026-10-25"),
      value: "OFF",
    });
    const before = await state();
    const p = await preview();
    expect(await state()).toEqual(before);
    expect(p).toMatchObject({
      sourceAssignmentCount: 3,
      conflictCount: 1,
      skippedCount: 1,
      canApply: true,
    });
    expect(p.preferenceNotes).toHaveLength(1);
    expect(p.rows.map((r) => r.reason)).toContain("LEAVE_CONFLICT");
    const result = await applyScheduleCopy(ctx, p.payload);
    expect(result).toMatchObject({
      ok: true,
      data: { assignmentCount: 1, revision: before.schedule!.revision + 1 },
    });
    expect((await state()).source).toEqual(before.source);
    expect((await state()).preferences).toEqual(before.preferences);
    expect((await state()).schedule!.status).toBe(before.schedule!.status);
    const events = (await state()).audit.slice(before.audit.length);
    expect(events.map((e) => e.action)).toEqual([
      "assignment.created",
      "schedule.copied",
    ]);
    expect(events[1]).toMatchObject({
      actorId: U.icuHead.id,
      scheduleId: T,
      data: {
        sourceScheduleId: S,
        targetScheduleId: T,
        scope: { mode: "MONTH" },
        assignmentCount: 1,
      },
    });
    expect(events[1]!.occurredAt).toBeInstanceOf(Date);
  });
  it("selected nurses and selected composite source cells restrict the operation", async () => {
    await put(S, U.icuNurse2.id, "2026-09-25", "E");
    const p = await preview(
      raw({
        selection: {
          nurseIds: [U.icuNurse1.id],
          sourceCells: [
            { nurseId: U.icuNurse1.id, date: isoDate("2026-09-25") },
          ],
        },
      }),
    );
    expect(p.proposed).toHaveLength(1);
    expect(await applyScheduleCopy(ctx, p.payload)).toMatchObject({ ok: true });
    expect(await listAssignments(db, T)).toEqual(p.proposed);
  });
  it("approved historical source remains readable and unchanged", async () => {
    await db
      .update(schedules)
      .set({ status: "APPROVED" })
      .where(eq(schedules.id, S));
    const before = await findScheduleById(db, S);
    expect(await getScheduleCopySource(ctx, raw())).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: U.icuNurse1.id }),
      ]),
    );
    expect(
      await applyScheduleCopy(ctx, (await preview()).payload),
    ).toMatchObject({ ok: true });
    expect(await findScheduleById(db, S)).toEqual(before);
  });
  it("allows a source from last year rather than restricting to the previous month", async () => {
    const historical = await createSchedule(db, {
      departmentId: DEMO_ICU.id,
      period: { start: isoDate("2025-09-23"), end: isoDate("2025-10-22") },
      label: "مهر ۱۴۰۴",
      createdBy: U.icuHead.id,
    });
    await addToRoster(db, {
      scheduleId: historical.id,
      userId: U.icuNurse1.id,
      role: "NURSE",
      addedBy: U.icuHead.id,
    });
    await put(historical.id, U.icuNurse1.id, "2025-09-25");
    expect(
      (await preview(raw({ sourceScheduleId: historical.id }))).proposed,
    ).toEqual([{ nurseId: U.icuNurse1.id, date: "2026-10-25", shift: "M" }]);
  });
  it("target roster is authoritative and new target-only nurses receive nothing", async () => {
    await db
      .delete(scheduleRoster)
      .where(
        and(
          eq(scheduleRoster.scheduleId, T),
          eq(scheduleRoster.userId, U.icuNurse1.id),
        ),
      );
    const p = await preview();
    expect(p.rows[0]!.reason).toBe("NURSE_NOT_IN_TARGET_ROSTER");
    expect(p.proposed).toEqual([]);
    expect((await applyScheduleCopy(ctx, p.payload)).ok).toBe(false);
  });
  it("target dated membership and active-account eligibility are re-evaluated", async () => {
    await endMembership(db, {
      userId: U.icuNurse1.id,
      departmentId: DEMO_ICU.id,
      endedOn: isoDate("2026-10-24"),
    });
    expect((await preview()).rows[0]!.reason).toBe(
      "NOT_ELIGIBLE_ON_TARGET_DATE",
    );
    await setUserActive(db, U.icuNurse2.id, false);
    await put(S, U.icuNurse2.id, "2026-09-25", "E");
    expect(
      (await preview()).rows.every(
        (r) => r.reason === "NOT_ELIGIBLE_ON_TARGET_DATE",
      ),
    ).toBe(true);
  });
  it.each(["APPROVED", "SUBMITTED"] as const)(
    "never writes immutable %s targets",
    async (s) => {
      const p = await preview();
      await status(s);
      const before = await state();
      expect(await applyScheduleCopy(ctx, p.payload)).toMatchObject({
        ok: false,
        error: { code: "CONFLICT" },
      });
      expect(await state()).toEqual(before);
      const locked = await preview();
      expect(locked.rows[0]!.reason).toBe("TARGET_SCHEDULE_NOT_EDITABLE");
      expect((await applyScheduleCopy(ctx, locked.payload)).ok).toBe(false);
    },
  );
  it("copies only editable revision dates without opening or extending a revision", async () => {
    await status("REVISING");
    await startRevision(db, {
      scheduleId: T,
      reason: "test",
      startedBy: U.icuHead.id,
      dates: [isoDate("2026-10-25")],
    });
    await put(S, U.icuNurse1.id, "2026-09-26", "E");
    const p = await preview();
    expect(p.rows.map((r) => r.reason)).toEqual([
      null,
      "DATE_OUTSIDE_REVISION_SCOPE",
    ]);
    expect(await applyScheduleCopy(ctx, p.payload)).toMatchObject({
      ok: true,
      data: { assignmentCount: 1 },
    });
    expect((await findScheduleById(db, T))!.status).toBe("REVISING");
  });
  it("blocks target night-rest violations and preserves the complete transaction", async () => {
    await put(T, U.icuNurse1.id, "2026-10-24", "N");
    const p = await preview();
    expect(p.assessment.blocking).toContainEqual(
      expect.objectContaining({ rule: "NIGHT_REST" }),
    );
    const before = await state();
    expect(await applyScheduleCopy(ctx, p.payload)).toMatchObject({
      ok: false,
      error: { code: "RULE_VIOLATION" },
    });
    expect(await state()).toEqual(before);
  });
  it("reads cross-boundary nights for roster members with no target assignments", async () => {
    await put(S, U.icuNurse1.id, "2026-10-22", "N");
    const p = await preview(
      raw({
        scope: {
          mode: "DAY",
          sourceDate: isoDate("2026-09-25"),
          targetDate: isoDate("2026-10-23"),
        },
      }),
    );
    expect(p.canApply).toBe(false);
    expect(p.assessment.blocking[0]!.rule).toBe("NIGHT_REST");
  });
  it("validates target-pinned holiday/date staffing bounds, not source staffing", async () => {
    const version = await publishTestRuleSet(db, {
      departmentId: DEMO_ICU.id,
      createdBy: U.icuHead.id,
      content: ruleContent(
        { min: 0, max: 4 },
        { holiday: { M: { min: 0, max: 0 } } },
      ),
    });
    await pinTestRuleSet(db, T, version);
    const holidayCtx = {
      ...ctx,
      holidays: {
        listOfficialHolidays: async () => [
          { date: isoDate("2026-10-25"), name: "تعطیل مقصد" },
        ],
      },
    };
    expect((await preview(raw(), ctx)).canApply).toBe(true);
    const p = await preview(raw(), holidayCtx);
    expect(p.assessment.blocking[0]!).toMatchObject({
      rule: "STAFFING",
      status: "ABOVE_MAXIMUM",
    });
    expect((await applyScheduleCopy(holidayCtx, p.payload)).ok).toBe(false);
  });
  it.each(["icuNurse1", "erHead", "supervisor"] as const)(
    "refuses unauthorized %s on both preview and apply",
    async (key) => {
      const p = await preview();
      const as = await actorContext(U[key].id);
      await expect(preview(raw(), as)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(await applyScheduleCopy(as, p.payload)).toMatchObject({
        ok: false,
        error: { code: "FORBIDDEN" },
      });
    },
  );
  it("rechecks authority even if the caller supplies an earlier valid actor", async () => {
    const p = await preview();
    await setUserActive(db, U.icuHead.id, false);
    await expect(preview()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await applyScheduleCopy(ctx, p.payload)).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
  });
  it("rejects cross-department copying even for an actor managing both departments", async () => {
    const { addMembership } =
      await import("../../src/infrastructure/repositories/memberships");
    await addMembership(db, {
      departmentId: DEMO_ER.id,
      userId: U.icuHead.id,
      role: "HEAD_NURSE",
      startedOn: isoDate("2026-01-01"),
    });
    const other = await createSchedule(db, {
      departmentId: DEMO_ER.id,
      period: sourcePeriod,
      label: "ER",
      createdBy: U.icuHead.id,
    });
    const as = await actorContext(U.icuHead.id);
    await expect(
      preview(raw({ sourceScheduleId: other.id }), as),
    ).rejects.toMatchObject({ reason: "CROSS_DEPARTMENT_COPY" });
  });
  it("same-schedule overlapping ranges do not cascade writes into their source", async () => {
    await put(T, U.icuNurse1.id, "2026-10-25", "M");
    await put(T, U.icuNurse1.id, "2026-10-26", "E");
    const p = await preview(
      raw({
        sourceScheduleId: T,
        scope: {
          mode: "RANGE",
          sourceStart: isoDate("2026-10-25"),
          sourceEnd: isoDate("2026-10-26"),
          targetStart: isoDate("2026-10-26"),
        },
      }),
    );
    expect(p.proposed).toEqual([
      { nurseId: U.icuNurse1.id, date: "2026-10-27", shift: "E" },
    ]);
    expect(await applyScheduleCopy(ctx, p.payload)).toMatchObject({ ok: true });
    expect(await listAssignments(db, T)).toHaveLength(3);
  });
  it.each([
    "target",
    "source",
    "preference",
    "roster",
    "membership",
    "adjacent",
  ])("rejects a stale %s dependency without writes", async (dependency) => {
    const p = await preview();
    if (dependency === "target")
      await setAssignments(ctx, {
        scheduleId: T,
        expectedRevision: 0,
        changes: [{ nurseId: U.icuNurse2.id, date: "2026-10-26", shift: "E" }],
      });
    if (dependency === "source")
      await put(S, U.icuNurse1.id, "2026-09-25", "E");
    if (dependency === "preference")
      await setPreference(db, {
        scheduleId: T,
        userId: U.icuNurse1.id,
        date: isoDate("2026-10-25"),
        value: "OFF",
      });
    if (dependency === "roster")
      await db
        .delete(scheduleRoster)
        .where(
          and(
            eq(scheduleRoster.scheduleId, T),
            eq(scheduleRoster.userId, U.icuNurse1.id),
          ),
        );
    if (dependency === "membership")
      await setUserActive(db, U.icuNurse1.id, false);
    if (dependency === "adjacent")
      await put(S, U.icuNurse2.id, "2026-10-22", "N");
    const before = await state();
    expect(await applyScheduleCopy(ctx, p.payload)).toMatchObject({
      ok: false,
      error: { code: "CONFLICT", reason: "SCHEDULE_COPY_STALE" },
    });
    expect(await state()).toEqual(before);
  });
  it("requires an authentic, actor/request-bound, unexpired preview", async () => {
    const p = await preview();
    expect(
      await applyScheduleCopy(ctx, {
        ...p.payload,
        scope: {
          mode: "DAY",
          sourceDate: "2026-09-25",
          targetDate: "2026-10-27",
        },
      }),
    ).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    expect(
      await applyScheduleCopy(
        { ...ctx, clock: () => new Date("2026-10-19T10:16:00Z") },
        p.payload,
      ),
    ).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    expect(
      await applyScheduleCopy(ctx, {
        ...p.payload,
        proof: { ...p.payload.proof, signature: "0".repeat(64) },
      }),
    ).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    expect(await applyScheduleCopy(ctx, raw())).toMatchObject({
      ok: false,
      error: { code: "VALIDATION" },
    });
  });
  it("rapid duplicate submissions serialize and only one creates assignments and audit", async () => {
    const p = await preview();
    const results = await Promise.all([
      applyScheduleCopy(ctx, p.payload),
      applyScheduleCopy(ctx, p.payload),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await listAssignments(db, T)).toHaveLength(1);
    expect(
      (await listAuditEventsForSchedule(db, T)).filter(
        (e) => e.action === "schedule.copied",
      ),
    ).toHaveLength(1);
  });
  it("rolls back inserted cells and ordinary audit if the final aggregate audit fails", async () => {
    const p = await preview();
    const before = await state();
    await db.execute(
      sql`create function reject_copy_audit() returns trigger language plpgsql as $$ begin if new.action = 'schedule.copied' then raise exception 'injected copy audit failure'; end if; return new; end $$`,
    );
    await db.execute(
      sql`create trigger copy_audit_failure before insert on audit_events for each row execute function reject_copy_audit()`,
    );
    try {
      expect(await applyScheduleCopy(ctx, p.payload)).toMatchObject({
        ok: false,
        error: { code: "INTERNAL" },
      });
      expect(await state()).toEqual(before);
    } finally {
      await db.execute(sql`drop trigger copy_audit_failure on audit_events`);
      await db.execute(sql`drop function reject_copy_audit()`);
    }
  });
});

it("concurrent opposite-direction historical copies use one lock order and invalidate the losing preview", async () => {
  const distant = await createSchedule(db, {
    departmentId: DEMO_ICU.id,
    period: { start: isoDate("2026-03-21"), end: isoDate("2026-04-20") },
    label: "فروردین",
    createdBy: U.icuHead.id,
  });
  await snapshotRosterFromMemberships(db, {
    scheduleId: distant.id,
    addedBy: U.icuHead.id,
  });
  await put(distant.id, U.icuNurse1.id, "2026-03-21", "M");
  await put(T, U.icuNurse2.id, "2026-10-23", "E");
  const forward = await preview(raw({ sourceScheduleId: distant.id }));
  const backward = await preview(
    raw({ sourceScheduleId: T, targetScheduleId: distant.id }),
  );
  expect(forward.canApply).toBe(true);
  expect(backward.canApply).toBe(true);
  const results = await Promise.all([
    applyScheduleCopy(ctx, forward.payload),
    applyScheduleCopy(ctx, backward.payload),
  ]);
  expect(results.filter((r) => r.ok)).toHaveLength(1);
  expect(results.find((r) => !r.ok)).toMatchObject({
    ok: false,
    error: { code: "CONFLICT", reason: "SCHEDULE_COPY_STALE" },
  });
});

it("never overwrites a late destination decision at the persistence boundary", async () => {
  const p = await preview();
  const before = await state();
  const write = assignmentEditing.writeAssignmentChanges;
  // An independent writer that does not participate in the schedule-lock
  // protocol commits leave after plan validation but before persistence.
  vi.spyOn(assignmentEditing, "writeAssignmentChanges").mockImplementationOnce(
    async (uow, schedule, changes, options) => {
      await put(T, U.icuNurse1.id, "2026-10-25", "H");
      return write(uow, schedule, changes, options);
    },
  );
  expect(await applyScheduleCopy(ctx, p.payload)).toMatchObject({
    ok: false,
    error: { code: "CONFLICT" },
  });
  const after = await state();
  expect(after.target).toEqual([
    { nurseId: U.icuNurse1.id, date: "2026-10-25", shift: "H" },
  ]);
  expect(after.source).toEqual(before.source);
  expect(after.schedule).toEqual(before.schedule);
  expect(after.audit).toEqual(before.audit);
});

it("rechecks a revoked Head Nurse membership even while the account remains active", async () => {
  const p = await preview();
  await endMembership(db, {
    userId: U.icuHead.id,
    departmentId: DEMO_ICU.id,
    endedOn: isoDate("2026-10-18"),
  });
  const before = await state();
  expect(await applyScheduleCopy(ctx, p.payload)).toMatchObject({
    ok: false,
    error: { code: "FORBIDDEN" },
  });
  expect(await state()).toEqual(before);
});

it("rejects a changed target staffing pin after preview", async () => {
  const p = await preview();
  const version = await publishTestRuleSet(db, {
    departmentId: DEMO_ICU.id,
    createdBy: U.icuHead.id,
    content: ruleContent({ min: 0, max: 0 }),
  });
  await pinTestRuleSet(db, T, version);
  const before = await state();
  expect(await applyScheduleCopy(ctx, p.payload)).toMatchObject({
    ok: false,
    error: { code: "CONFLICT", reason: "SCHEDULE_COPY_STALE" },
  });
  expect(await state()).toEqual(before);
});

it("rejects changed target holiday requirements after preview", async () => {
  const version = await publishTestRuleSet(db, {
    departmentId: DEMO_ICU.id,
    createdBy: U.icuHead.id,
    content: ruleContent(
      { min: 0, max: 4 },
      { holiday: { M: { min: 0, max: 0 } } },
    ),
  });
  await pinTestRuleSet(db, T, version);
  let holiday = false;
  const as = {
    ...ctx,
    holidays: {
      listOfficialHolidays: async () =>
        holiday ? [{ date: isoDate("2026-10-25"), name: "تعطیل" }] : [],
    },
  };
  const p = await preview(raw(), as);
  expect(p.canApply).toBe(true);
  holiday = true;
  const before = await state();
  expect(await applyScheduleCopy(as, p.payload)).toMatchObject({
    ok: false,
    error: { code: "CONFLICT", reason: "SCHEDULE_COPY_STALE" },
  });
  expect(await state()).toEqual(before);
});

it("uses a target date-specific staffing exception during preview and apply", async () => {
  const version = await publishTestRuleSet(db, {
    departmentId: DEMO_ICU.id,
    createdBy: U.icuHead.id,
    content: ruleContent(
      { min: 0, max: 4 },
      {
        exceptions: [
          {
            date: isoDate("2026-10-25"),
            period: "M",
            bounds: { min: 0, max: 0 },
            note: "target exception",
          },
        ],
      },
    ),
  });
  await pinTestRuleSet(db, T, version);
  const p = await preview();
  expect(p.assessment.blocking).toContainEqual(
    expect.objectContaining({
      rule: "STAFFING",
      status: "ABOVE_MAXIMUM",
      date: "2026-10-25",
    }),
  );
  const before = await state();
  expect(await applyScheduleCopy(ctx, p.payload)).toMatchObject({
    ok: false,
    error: { code: "RULE_VIOLATION" },
  });
  expect(await state()).toEqual(before);
});

it("applies a leap Esfand copy to non-leap Esfand without inserting day 30 into Farvardin", async () => {
  const { jalaliMonthPeriod } =
    await import("../../src/features/calendar/jalali");
  const leap = jalaliMonthPeriod({ year: 1403, month: 12 });
  const normal = jalaliMonthPeriod({ year: 1404, month: 12 });
  const source = await createSchedule(db, {
    departmentId: DEMO_ICU.id,
    period: leap,
    label: "اسفند ۱۴۰۳",
    createdBy: U.icuHead.id,
  });
  await addToRoster(db, {
    scheduleId: source.id,
    userId: U.icuNurse1.id,
    role: "NURSE",
    addedBy: U.icuHead.id,
  });
  const target = await createSchedule(db, {
    departmentId: DEMO_ICU.id,
    period: normal,
    label: "اسفند ۱۴۰۴",
    createdBy: U.icuHead.id,
  });
  await snapshotRosterFromMemberships(db, {
    scheduleId: target.id,
    addedBy: U.icuHead.id,
  });
  const { addDays } = await import("../../src/domain/shared/dates");
  await put(source.id, U.icuNurse1.id, addDays(leap.end, -1), "M");
  await put(source.id, U.icuNurse1.id, leap.end, "E");
  const p = await preview(
    raw({ sourceScheduleId: source.id, targetScheduleId: target.id }),
  );
  expect(p.sourceAssignmentCount).toBe(2);
  expect(p.rows.map((r) => r.reason)).toEqual([
    null,
    "TARGET_DATE_DOES_NOT_EXIST",
  ]);
  expect(p.proposed).toEqual([
    { nurseId: U.icuNurse1.id, date: normal.end, shift: "M" },
  ]);
  expect(await applyScheduleCopy(ctx, p.payload)).toMatchObject({
    ok: true,
    data: { assignmentCount: 1 },
  });
  expect(await listAssignments(db, target.id)).toEqual(p.proposed);
  expect(await listAssignments(db, source.id)).toHaveLength(2);
});
