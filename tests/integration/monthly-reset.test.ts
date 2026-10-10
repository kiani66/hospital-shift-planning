import { createSchedule } from "../../src/application/schedules/create-schedule";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  previewMonthlyReset,
  resetMonthlyPlanning,
} from "../../src/application/schedules/reset-planning";
import { setAssignments } from "../../src/application/schedules/edit-assignments";
import { directSwap } from "../../src/application/schedules/direct-swap";
import { openPreferenceWindow } from "../../src/application/schedules/preference-windows";
import { isoDate } from "../../src/domain/shared/dates";
import {
  schedules,
  shiftAssignments,
  nursePreferences,
  preferenceWindows,
  scheduleRoster,
  scheduleChanges,
  scheduleChangeCells,
  legacyShiftChangeRequests,
  departmentMemberships,
  LEGACY_BASELINE_VERSION_ID,
} from "../../src/infrastructure/db/schema";
import {
  DEMO_SCHEDULE as S,
  DEMO_USERS as U,
} from "../../src/infrastructure/db/seed/demo-data";
import { loadActor } from "../../src/infrastructure/repositories/memberships";
import { setupTestDatabase } from "./support/database";
const { db } = setupTestDatabase();
const as = async (id = U.icuHead.id) => ({
  db,
  actor: (await loadActor(db, id, isoDate("2026-10-10")))!,
});
let ctx: Awaited<ReturnType<typeof as>>;
beforeEach(async () => {
  ctx = await as();
});
const reset = (revision: number) =>
  resetMonthlyPlanning(ctx, { scheduleId: S.id, expectedRevision: revision });
describe("monthly planning reset", () => {
  it("preserves another month and rolls back cleanup on audit failure", async () => {
    const made = await createSchedule(ctx, {
      departmentId: S.departmentId,
      periodStart: "2026-11-22",
      periodEnd: "2026-12-21",
      label: "آذر",
    });
    if (!made.ok) throw new Error(made.error.message);
    await db.insert(shiftAssignments).values([
      {
        scheduleId: S.id,
        userId: U.icuNurse1.id,
        date: "2026-10-24",
        shiftCode: "OFF",
        updatedBy: U.icuHead.id,
      },
      {
        scheduleId: made.data.scheduleId,
        userId: U.icuNurse1.id,
        date: "2026-11-24",
        shiftCode: "M",
        updatedBy: U.icuHead.id,
      },
    ]);
    await db.execute(
      sql`create function phase14_fail_monthly() returns trigger language plpgsql as $$ begin if NEW.action = 'schedule.planningReset' then raise exception 'injected'; end if; return NEW; end $$`,
    );
    await db.execute(
      sql`create trigger phase14_fail_monthly before insert on audit_events for each row execute function phase14_fail_monthly()`,
    );
    try {
      expect(await reset(0)).toMatchObject({
        ok: false,
        error: { code: "INTERNAL" },
      });
      expect(await db.select().from(shiftAssignments)).toHaveLength(2);
    } finally {
      await db.execute(sql`drop trigger phase14_fail_monthly on audit_events`);
      await db.execute(sql`drop function phase14_fail_monthly()`);
    }
    expect((await reset(0)).ok).toBe(true);
    expect(await db.select().from(shiftAssignments)).toMatchObject([
      { scheduleId: made.data.scheduleId, shiftCode: "M" },
    ]);
  });

  it.each(["DRAFT", "PLANNING"] as const)(
    "clears OFF, prefill, swaps and preserves initialization in %s",
    async (status) => {
      if (status === "PLANNING")
        expect(
          (
            await openPreferenceWindow(ctx, {
              scheduleId: S.id,
              expectedRevision: 0,
            })
          ).ok,
        ).toBe(true);
      await db.insert(shiftAssignments).values([
        {
          scheduleId: S.id,
          userId: U.icuNurse1.id,
          date: "2026-10-24",
          shiftCode: "OFF",
          source: "PREFILL",
          updatedBy: U.icuHead.id,
        },
        {
          scheduleId: S.id,
          userId: U.icuNurse2.id,
          date: "2026-10-24",
          shiftCode: "M",
          updatedBy: U.icuHead.id,
        },
      ]);
      await db.insert(nursePreferences).values({
        scheduleId: S.id,
        userId: U.icuNurse1.id,
        date: "2026-10-24",
        value: "E",
      });
      const revision = status === "DRAFT" ? 0 : 1;
      const swapped = await directSwap(ctx, {
        scheduleId: S.id,
        expectedRevision: revision,
        date: "2026-10-24",
        firstNurseId: U.icuNurse1.id,
        secondNurseId: U.icuNurse2.id,
        reasonCode: "STAFFING_NEED",
      });
      expect(swapped.ok).toBe(true);
      const before = {
        windows: await db.select().from(preferenceWindows),
        roster: await db.select().from(scheduleRoster),
        preferences: await db.select().from(nursePreferences),
      };
      const preview = await previewMonthlyReset(ctx, S.id);
      expect(preview.counts).toMatchObject({
        assignments: 2,
        changes: 1,
        changeCells: 2,
        preferences: 1,
      });
      expect((await reset(preview.revision)).ok).toBe(true);
      expect(await db.select().from(shiftAssignments)).toHaveLength(0);
      expect(await db.select().from(scheduleChanges)).toHaveLength(0);
      expect(await db.select().from(scheduleChangeCells)).toHaveLength(0);
      const [saved] = await db
        .select()
        .from(schedules)
        .where(eq(schedules.id, S.id));
      expect(saved).toMatchObject({
        id: S.id,
        status,
        staffingRuleSetVersionId: LEGACY_BASELINE_VERSION_ID,
      });
      expect(await db.select().from(preferenceWindows)).toEqual(before.windows);
      expect(await db.select().from(scheduleRoster)).toEqual(before.roster);
      expect(await db.select().from(nursePreferences)).toEqual(
        before.preferences,
      );
    },
  );
  it.each([
    "FINALIZED",
    "SUBMITTED",
    "APPROVED",
    "REVISING",
    "RETURNED",
  ] as const)("rejects %s", async (status) => {
    await db.update(schedules).set({ status }).where(eq(schedules.id, S.id));
    expect(await reset(0)).toMatchObject({
      ok: false,
      error: { code: "INVALID_STATE" },
    });
  });
  it("rejects nurse and another department head", async () => {
    for (const id of [U.icuNurse1.id, U.erHead.id])
      expect(
        await resetMonthlyPlanning(await as(id), {
          scheduleId: S.id,
          expectedRevision: 0,
        }),
      ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });
  it("rejects retained legacy request history even on a DRAFT schedule", async () => {
    await db.insert(legacyShiftChangeRequests).values({
      scheduleId: S.id,
      requesterId: U.icuNurse1.id,
      reason: "isolated historical request",
      status: "PENDING",
    });
    expect(await reset(0)).toMatchObject({
      ok: false,
      error: { code: "INVALID_STATE" },
    });
    await expect(previewMonthlyReset(ctx, S.id)).rejects.toThrow();
    expect(await db.select().from(legacyShiftChangeRequests)).toHaveLength(1);
  });
  it("rechecks revoked membership", async () => {
    await db
      .update(departmentMemberships)
      .set({ endedOn: "2026-01-01" })
      .where(eq(departmentMemberships.userId, U.icuHead.id));
    expect(await reset(0)).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
  });
  it("handles empty no-op and stale revision", async () => {
    expect(await reset(0)).toMatchObject({
      ok: true,
      data: { changed: false, revision: 0 },
    });
    expect(await reset(1)).toMatchObject({
      ok: false,
      error: { code: "CONFLICT" },
    });
  });
  it("serializes competing assignment and reset writes", async () => {
    await db.insert(shiftAssignments).values({
      scheduleId: S.id,
      userId: U.icuNurse1.id,
      date: "2026-10-24",
      shiftCode: "OFF",
      updatedBy: U.icuHead.id,
    });
    const results = await Promise.all([
      reset(0),
      setAssignments(ctx, {
        scheduleId: S.id,
        expectedRevision: 0,
        changes: [{ nurseId: U.icuNurse1.id, date: "2026-10-24", shift: "M" }],
      }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toHaveLength(1);
    const [s] = await db.select().from(schedules).where(eq(schedules.id, S.id));
    expect(s!.revision).toBe(1);
    expect(
      (await db.select().from(shiftAssignments)).length,
    ).toBeLessThanOrEqual(1);
  });
});
