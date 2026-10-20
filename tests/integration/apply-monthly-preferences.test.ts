import { and, eq, sql } from "drizzle-orm";
import { beforeEach, expect, it, vi } from "vitest";
import { applyMonthlyPreferences } from "../../src/application/schedules/apply-preferences";
import { setAssignments } from "../../src/application/schedules/edit-assignments";
import { finalizeSchedule } from "../../src/application/schedules/lifecycle";
import { validateWorkingCopy } from "../../src/application/schedules/working-copy-validation";
import { setMyPreference } from "../../src/application/preferences/commands";
import type { AppContext } from "../../src/application/use-case";
import { isoDate, addDays } from "../../src/domain/shared/dates";
import {
  openPreferenceWindow,
  closePreferenceWindow,
} from "../../src/application/schedules/preference-windows";
import type {
  AssignmentCode,
  PreferenceValue,
} from "../../src/domain/shifts/shift-type";
import {
  departmentMemberships,
  schedules,
  users,
  shiftAssignments,
} from "../../src/infrastructure/db/schema";
import {
  DEMO_ICU,
  DEMO_SCHEDULE,
  DEMO_USERS as U,
} from "../../src/infrastructure/db/seed/demo-data";
import {
  listAssignments,
  setAssignment,
} from "../../src/infrastructure/repositories/assignments";
import { listAuditEventsForSchedule } from "../../src/infrastructure/repositories/audit";
import { loadActor } from "../../src/infrastructure/repositories/memberships";
import { listPreferenceWindows } from "../../src/infrastructure/repositories/preference-windows";
import {
  setPreference,
  clearPreference,
  listPreferences,
} from "../../src/infrastructure/repositories/preferences";
import {
  addToRoster,
  snapshotRosterFromMemberships,
} from "../../src/infrastructure/repositories/roster";
import {
  createSchedule,
  findScheduleById,
} from "../../src/infrastructure/repositories/schedules";
import { setupTestDatabase } from "./support/database";
import {
  pinTestRuleSet,
  publishTestRuleSet,
  ruleContent,
} from "./support/rule-sets";

const { db, pool } = setupTestDatabase();
const S = DEMO_SCHEDULE.id;
const N = U.icuNurse1.id;
const D = isoDate("2026-10-24");
const now = new Date("2026-10-01T08:00:00Z");
let ctx: AppContext;
const context = async (id: string): Promise<AppContext> => ({
  db,
  actor: (await loadActor(db, id, isoDate("2026-10-01")))!,
  clock: () => now,
});
const schedule = async () => (await findScheduleById(db, S))!;
const apply = async (expectedRevision?: number) =>
  applyMonthlyPreferences(ctx, {
    scheduleId: S,
    expectedRevision: expectedRevision ?? (await schedule()).revision,
  });
const prefer = (value: PreferenceValue = "M", date = D, userId = N) =>
  setPreference(db, { scheduleId: S, userId, date, value });
const assign = (shift: AssignmentCode, date = D, userId = N, scheduleId = S) =>
  setAssignment(db, {
    scheduleId,
    userId,
    date,
    shift,
    updatedBy: U.icuHead.id,
  });
const state = async () => ({
  schedule: await schedule(),
  cells: await listAssignments(db, S),
  audit: await listAuditEventsForSchedule(db, S),
  preferences: await listPreferences(db, S),
});
beforeEach(async () => {
  ctx = await context(U.icuHead.id);
});

it("applies the whole month including Head Nurse, ME and explicit OFF with PREFILL provenance and atomic audit", async () => {
  for (const [index, value] of (
    ["M", "E", "N", "ME", "OFF"] as const
  ).entries())
    await prefer(value, addDays(D, index));
  await prefer("E", D, U.icuHead.id);
  expect(await apply()).toMatchObject({
    ok: true,
    data: { assignmentCount: 6, revision: 1, skipped: [] },
  });
  const s = await state();
  expect(s.cells).toHaveLength(6);
  expect(s.schedule).toMatchObject({ status: "DRAFT", revision: 1 });
  expect(s.preferences).toHaveLength(6);
  expect(
    s.audit.filter((a) => a.action === "schedule.preferencesApplied"),
  ).toHaveLength(1);
  expect(s.audit.filter((a) => a.action === "assignment.created")).toHaveLength(
    6,
  );
  expect(
    (
      await db
        .select({ source: shiftAssignments.source })
        .from(shiftAssignments)
    ).every((a) => a.source === "PREFILL"),
  ).toBe(true);
});

it.each(["open", "closed"])(
  "ignores an %s preference window and leaves it unchanged",
  async (windowState) => {
    expect(
      (
        await openPreferenceWindow(ctx, {
          scheduleId: S,
          expectedRevision: 0,
        })
      ).ok,
    ).toBe(true);
    const nurse = await context(N);
    expect(
      (await setMyPreference(nurse, { scheduleId: S, date: D, value: "ME" }))
        .ok,
    ).toBe(true);
    if (windowState === "closed")
      expect(
        (
          await closePreferenceWindow(ctx, {
            scheduleId: S,
            expectedRevision: (await schedule()).revision,
          })
        ).ok,
      ).toBe(true);
    const windows = await listPreferenceWindows(db, S);
    expect(await apply()).toMatchObject({
      ok: true,
      data: { assignmentCount: 1 },
    });
    expect(await listPreferenceWindows(db, S)).toEqual(windows);
    expect((await schedule()).status).toBe("PLANNING");
  },
);

it("reapplies earlier preferences after manual removals/changes and reads updated preferences", async () => {
  expect(
    (await openPreferenceWindow(ctx, { scheduleId: S, expectedRevision: 0 }))
      .ok,
  ).toBe(true);
  const nurse = await context(N);
  expect(
    (await setMyPreference(nurse, { scheduleId: S, date: D, value: "M" })).ok,
  ).toBe(true);
  expect(
    (
      await setMyPreference(nurse, {
        scheduleId: S,
        date: addDays(D, 1),
        value: "E",
      })
    ).ok,
  ).toBe(true);
  expect((await apply()).ok).toBe(true);
  expect(
    (
      await setAssignments(ctx, {
        scheduleId: S,
        expectedRevision: 2,
        changes: [
          { nurseId: N, date: D, shift: null },
          { nurseId: N, date: addDays(D, 1), shift: "OFF" },
        ],
      })
    ).ok,
  ).toBe(true);
  expect(
    (
      await setMyPreference(nurse, {
        scheduleId: S,
        date: addDays(D, 1),
        value: "ME",
      })
    ).ok,
  ).toBe(true);
  expect(await apply()).toMatchObject({
    ok: true,
    data: { assignmentCount: 2, revision: 4 },
  });
  expect((await listAssignments(db, S)).map((a) => a.shift)).toEqual([
    "M",
    "ME",
  ]);
  expect(await apply()).toMatchObject({
    ok: true,
    data: { assignmentCount: 0, unchangedCount: 2, revision: 4 },
  });
});

it("does not clear unrelated decisions, H leave, removed preferences or other schedules", async () => {
  await assign("N");
  await assign("H", addDays(D, 1));
  await assign("OFF", addDays(D, 2));
  await prefer("E");
  await prefer("M", addDays(D, 1));
  const other = await createSchedule(db, {
    departmentId: DEMO_ICU.id,
    period: { start: isoDate("2026-12-22"), end: isoDate("2027-01-20") },
    label: "دی",
    createdBy: U.icuHead.id,
  });
  await snapshotRosterFromMemberships(db, {
    scheduleId: other.id,
    addedBy: U.icuHead.id,
  });
  await assign("M", isoDate("2026-12-22"), N, other.id);
  const otherBefore = await listAssignments(db, other.id);
  expect(await apply()).toMatchObject({
    ok: true,
    data: {
      assignmentCount: 1,
      skipped: [{ reason: "LEAVE_PRESERVED", date: addDays(D, 1) }],
    },
  });
  await clearPreference(db, { scheduleId: S, userId: N, date: D });
  const before = await state();
  expect(await apply()).toMatchObject({
    ok: true,
    data: { assignmentCount: 0 },
  });
  expect(await state()).toEqual(before);
  expect(before.cells.map((a) => a.shift)).toEqual(["E", "H", "OFF"]);
  expect(await listAssignments(db, other.id)).toEqual(otherBefore);
});

it("no preferences changes nothing and still rejects a stale revision", async () => {
  await assign("M");
  const before = await state();
  expect(await apply()).toMatchObject({
    ok: true,
    data: { assignmentCount: 0, preferenceCount: 0 },
  });
  expect(await state()).toEqual(before);
  expect(await apply(99)).toMatchObject({
    ok: false,
    error: { code: "CONFLICT" },
  });
});

it("skips invalid dated membership and inactive accounts while applying eligible cells", async () => {
  await prefer("M");
  await prefer("E", D, U.icuNurse2.id);
  await prefer("N", D, U.icuNurse3.id);
  await db
    .update(departmentMemberships)
    .set({ endedOn: "2026-10-23" })
    .where(
      and(
        eq(departmentMemberships.userId, N),
        eq(departmentMemberships.departmentId, DEMO_ICU.id),
      ),
    );
  await db
    .update(users)
    .set({ isActive: false })
    .where(eq(users.id, U.icuNurse2.id));
  const result = await apply();
  expect(result).toMatchObject({
    ok: true,
    data: {
      assignmentCount: 1,
      skipped: expect.arrayContaining([
        expect.objectContaining({
          nurseId: N,
          reason: "INACTIVE_OR_NOT_MEMBER",
        }),
        expect.objectContaining({
          nurseId: U.icuNurse2.id,
          reason: "INACTIVE_OR_NOT_MEMBER",
        }),
      ]),
    },
  });
  // Previously skipped preferences remain eligible for reconsideration on the next run.
  await db
    .update(users)
    .set({ isActive: true })
    .where(eq(users.id, U.icuNurse2.id));
  expect(await apply()).toMatchObject({
    ok: true,
    data: { assignmentCount: 1, unchangedCount: 1 },
  });
});

it("skips out-of-period preferences and a rostered outsider with no department membership", async () => {
  await prefer("E", isoDate("2026-12-01"));
  await addToRoster(db, {
    scheduleId: S,
    userId: U.erNurse1.id,
    role: "NURSE",
    addedBy: U.icuHead.id,
  });
  await prefer("M", D, U.erNurse1.id);
  expect(await apply()).toMatchObject({
    ok: true,
    data: {
      assignmentCount: 0,
      skipped: expect.arrayContaining([
        expect.objectContaining({ reason: "OUTSIDE_PERIOD" }),
        expect.objectContaining({ reason: "INACTIVE_OR_NOT_MEMBER" }),
      ]),
    },
  });
});

it("keeps conflicting rest wishes, shortages and excess visible and does not weaken Finalize", async () => {
  const pin = await publishTestRuleSet(db, {
    departmentId: DEMO_ICU.id,
    createdBy: U.icuHead.id,
    content: ruleContent({ min: 1, max: 1 }),
  });
  await pinTestRuleSet(db, S, pin);
  await prefer("N");
  await prefer("ME", addDays(D, 1));
  await prefer("M", addDays(D, 1), U.icuNurse2.id);
  expect(await apply()).toMatchObject({
    ok: true,
    data: { assignmentCount: 3 },
  });
  const violations = (await validateWorkingCopy(db, await schedule()))
    .violations;
  expect(violations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ rule: "NIGHT_REST", severity: "error" }),
      expect.objectContaining({ rule: "STAFFING", status: "BELOW_MINIMUM" }),
      expect.objectContaining({ rule: "STAFFING", status: "ABOVE_MAXIMUM" }),
    ]),
  );
  const before = await state();
  expect(
    await finalizeSchedule(ctx, {
      scheduleId: S,
      expectedRevision: before.schedule.revision,
    }),
  ).toMatchObject({ ok: false, error: { code: "RULE_VIOLATION" } });
  expect(await state()).toEqual(before);
});

it("rolls back on a structural hard violation in the resulting schedule", async () => {
  await assign("M", isoDate("2026-12-01"));
  await prefer();
  const before = await state();
  expect(await apply()).toMatchObject({
    ok: false,
    error: {
      code: "RULE_VIOLATION",
      violations: [expect.objectContaining({ rule: "OUTSIDE_PERIOD" })],
    },
  });
  expect(await state()).toEqual(before);
});

it.each([U.icuNurse1.id, U.erHead.id, U.supervisor.id, U.inactiveNurse.id])(
  "denies unauthorized actor %s",
  async (id) => {
    await prefer();
    const before = await state();
    expect(
      await applyMonthlyPreferences(await context(id), {
        scheduleId: S,
        expectedRevision: 0,
      }),
    ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(await state()).toEqual(before);
  },
);

it("rechecks authorization even with an earlier trusted actor", async () => {
  await prefer();
  await db
    .update(departmentMemberships)
    .set({ role: "NURSE" })
    .where(
      and(
        eq(departmentMemberships.userId, U.icuHead.id),
        eq(departmentMemberships.departmentId, DEMO_ICU.id),
      ),
    );
  expect(await apply()).toMatchObject({
    ok: false,
    error: { code: "FORBIDDEN" },
  });
  expect(await listAssignments(db, S)).toEqual([]);
});

it.each([
  "FINALIZED",
  "SUBMITTED",
  "RETURNED",
  "APPROVED",
  "REVISING",
] as const)("refuses %s at execution time", async (status) => {
  await prefer();
  await db.update(schedules).set({ status }).where(eq(schedules.id, S));
  const before = await state();
  expect(await apply()).toMatchObject({
    ok: false,
    error: { code: "INVALID_STATE" },
  });
  expect(await state()).toEqual(before);
});

it("serializes concurrent application and manual editing; stale work cannot overwrite the winner", async () => {
  await prefer("ME");
  const results = await Promise.all([
    apply(0),
    setAssignments(ctx, {
      scheduleId: S,
      expectedRevision: 0,
      changes: [{ nurseId: N, date: D, shift: "OFF" }],
    }),
  ]);
  expect(results.filter((r) => r.ok)).toHaveLength(1);
  expect(results.filter((r) => !r.ok)).toMatchObject([
    { ok: false, error: { code: "CONFLICT" } },
  ]);
  expect((await schedule()).revision).toBe(1);
  expect(await listAssignments(db, S)).toHaveLength(1);
});

it("waits for an in-flight preference save and then applies the latest value", async () => {
  await prefer("M");
  const client = await pool.connect();
  let running: ReturnType<typeof apply> | undefined;
  try {
    await client.query("begin");
    await client.query("select id from schedules where id = $1 for share", [S]);
    await client.query(
      "update nurse_preferences set value = 'ME' where schedule_id = $1",
      [S],
    );
    running = apply(0);
    await vi.waitFor(
      async () => {
        const result = await pool.query(
          "select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query like '%for update%'",
        );
        expect(result.rows[0].n).toBeGreaterThan(0);
      },
      { timeout: 5_000 },
    );
  } finally {
    await client.query("commit");
    client.release();
  }
  expect(await running).toMatchObject({
    ok: true,
    data: { assignmentCount: 1 },
  });
  expect((await listAssignments(db, S))[0]!.shift).toBe("ME");
});

it("rolls back all changed cells, audit and revision when aggregate audit fails", async () => {
  await prefer();
  await prefer("E", addDays(D, 1));
  await assign("OFF");
  const before = await state();
  vi.spyOn(console, "error").mockImplementation(() => {});
  await db.execute(
    sql`create function reject_preferences_audit() returns trigger language plpgsql as $$ begin if new.action = 'schedule.preferencesApplied' then raise exception 'injected audit failure'; end if; return new; end $$`,
  );
  await db.execute(
    sql`create trigger preferences_audit_failure before insert on audit_events for each row execute function reject_preferences_audit()`,
  );
  try {
    expect(await apply()).toMatchObject({
      ok: false,
      error: { code: "INTERNAL" },
    });
    expect(await state()).toEqual(before);
  } finally {
    await db.execute(
      sql`drop trigger preferences_audit_failure on audit_events`,
    );
    await db.execute(sql`drop function reject_preferences_audit()`);
  }
});
