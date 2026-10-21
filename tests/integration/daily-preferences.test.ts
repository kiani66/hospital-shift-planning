import { and, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  acceptDailyPreferences,
  readDailyPreferences,
  type DailyPreferenceOperation,
  type DailyPreferencePreview,
} from "../../src/application/schedules/daily-preferences";
import { applyMonthlyPreferences } from "../../src/application/schedules/apply-preferences";
import { setAssignments } from "../../src/application/schedules/edit-assignments";
import {
  openPreferenceWindow,
  closePreferenceWindow,
} from "../../src/application/schedules/preference-windows";
import { setMyPreference } from "../../src/application/preferences/commands";
import { validateWorkingCopy } from "../../src/application/schedules/working-copy-validation";
import type { AppContext } from "../../src/application/use-case";
import { addDays, isoDate } from "../../src/domain/shared/dates";
import type { ScheduleStatus } from "../../src/domain/schedule/status";
import {
  ASSIGNMENT_CODES,
  SHIFT_CODES,
  type AssignmentCode,
  type PreferenceValue,
} from "../../src/domain/shifts/shift-type";
import {
  departmentMemberships,
  departments,
  schedules,
  scheduleRoster,
  shiftAssignments,
  users,
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
import {
  listPreferences,
  setPreference,
  clearPreference,
} from "../../src/infrastructure/repositories/preferences";
import { listPreferenceWindows } from "../../src/infrastructure/repositories/preference-windows";
import { snapshotRosterFromMemberships } from "../../src/infrastructure/repositories/roster";
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
const NOW = new Date("2026-10-01T08:00:00Z");
let ctx: AppContext;
const context = async (userId = U.icuHead.id): Promise<AppContext> => ({
  db,
  actor: (await loadActor(db, userId, isoDate("2026-10-01")))!,
  clock: () => NOW,
});
const schedule = async () => (await findScheduleById(db, S))!;
const prefer = (value: PreferenceValue = "M", userId = N, date = D) =>
  setPreference(db, { scheduleId: S, userId, date, value });
const assign = (shift: AssignmentCode, userId = N, date = D, scheduleId = S) =>
  setAssignment(db, {
    scheduleId,
    userId,
    date,
    shift,
    updatedBy: U.icuHead.id,
  });
const read = (as = ctx, date = D, scheduleId = S) =>
  readDailyPreferences(as, { scheduleId, date });
const payload = (
  p: DailyPreferencePreview,
  operation: DailyPreferenceOperation = { kind: "ONE", nurseId: N },
) => ({
  scheduleId: p.scheduleId,
  date: p.date,
  expectedRevision: p.revision,
  proof: p.proof,
  operation,
});
const accept = async (operation?: DailyPreferenceOperation) =>
  acceptDailyPreferences(ctx, payload(await read(), operation));
const bulk = (excludedNurseIds: string[] = []): DailyPreferenceOperation => ({
  kind: "BULK",
  excludedNurseIds,
});
const state = async () => ({
  schedule: await schedule(),
  assignments: await listAssignments(db, S),
  preferences: await listPreferences(db, S),
  audit: await listAuditEventsForSchedule(db, S),
});
const pin = async (min = 0, max: number | null = null) => {
  const id = await publishTestRuleSet(db, {
    departmentId: DEMO_ICU.id,
    content: ruleContent({ min, max }),
    createdBy: U.icuHead.id,
  });
  await pinTestRuleSet(db, S, id);
  return id;
};
const setStatus = (status: ScheduleStatus) =>
  db.update(schedules).set({ status }).where(eq(schedules.id, S));

beforeEach(async () => {
  vi.stubEnv("AUTH_SECRET", "daily-preferences-integration-only-secret-0001");
  ctx = await context();
});

describe("authorized daily preference preview", () => {
  it("reads a complete named, grouped snapshot without modifying any schedule data", async () => {
    await prefer("M");
    await prefer("E", U.icuNurse2.id);
    await prefer("N", U.icuNurse3.id);
    await prefer("ME", U.icuHead.id);
    await prefer("OFF", U.icuNurse4.id);
    await assign("E", U.icuNurse2.id);
    await assign("H", U.icuHead.id);
    const before = await state();
    const p = await read();
    expect(p).toMatchObject({
      scheduleId: S,
      date: D,
      revision: 0,
      proof: {
        issuedAt: NOW.getTime(),
        fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
        signature: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    });
    expect(p.groups.map((g) => g.shift)).toEqual(SHIFT_CODES);
    expect(p.groups.flatMap((g) => g.suggestions)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nurseId: N,
          displayName: U.icuNurse1.displayName,
          status: "ELIGIBLE",
        }),
        expect.objectContaining({
          nurseId: U.icuNurse2.id,
          status: "ALREADY_ASSIGNED",
        }),
        expect.objectContaining({
          nurseId: U.icuHead.id,
          status: "CONFLICT",
          currentAssignment: "H",
        }),
      ]),
    );
    expect(p.offPreferences).toMatchObject([
      {
        nurseId: U.icuNurse4.id,
        status: "INFORMATIONAL",
        reason: "OFF_PREFERENCE",
      },
    ]);
    expect(await state()).toEqual(before);
  });

  it("uses the actual pinned rules and Exception > Holiday > Normal precedence", async () => {
    await prefer();
    const id = await publishTestRuleSet(db, {
      departmentId: DEMO_ICU.id,
      createdBy: U.icuHead.id,
      content: ruleContent(
        { min: 0, max: null },
        {
          holiday: { M: { min: 0, max: 0 }, E: { min: 2, max: 3 } },
          exceptions: [
            { date: D, period: "M", bounds: { min: 1, max: 1 }, note: null },
          ],
        },
      ),
    });
    await pinTestRuleSet(db, S, id);
    // A newer version exists, but the schedule still uses its original pin.
    await publishTestRuleSet(db, {
      departmentId: DEMO_ICU.id,
      createdBy: U.icuHead.id,
      content: ruleContent({ min: 0, max: 0 }),
      effectiveFrom: "2026-10-01",
    });
    ctx = {
      ...ctx,
      holidays: {
        listOfficialHolidays: async () => [{ date: D, name: "تعطیل نمونه" }],
      },
    };
    const p = await read();
    expect(p.staffingRuleSetVersionId).toBe(id);
    expect(p.coverage).toMatchObject([
      { period: "M", source: "EXCEPTION", maximum: 1 },
      { period: "E", source: "HOLIDAY", minimum: 2 },
      { period: "N", source: "NORMAL", maximum: null },
    ]);
    expect(await accept()).toMatchObject({
      ok: true,
      data: { createdAssignmentCount: 1 },
    });
  });

  it("keeps secretary preferences informational and out of nursing coverage", async () => {
    await db
      .update(scheduleRoster)
      .set({ role: "SECRETARY" })
      .where(
        and(
          eq(scheduleRoster.scheduleId, S),
          eq(scheduleRoster.userId, U.icuNurse2.id),
        ),
      );
    await prefer("ME", U.icuNurse2.id);
    await assign("ME", U.icuNurse2.id);
    const p = await read();
    expect(
      p.groups.find((g) => g.shift === "ME")?.suggestions[0],
    ).toMatchObject({
      status: "INFORMATIONAL",
      reason: "NON_NURSING_PREFERENCE",
    });
    expect(p.coverage.every((c) => c.current === 0)).toBe(true);
    expect(await accept(bulk())).toMatchObject({
      ok: true,
      data: { createdAssignmentCount: 0 },
    });
  });

  it.each(["not-a-date", "2026-02-31", "2026-12-25"])(
    "refuses invalid/outside date %s",
    async (date) => {
      await expect(
        readDailyPreferences(ctx, { scheduleId: S, date }),
      ).rejects.toThrow();
    },
  );
});

describe("individual acceptance", () => {
  it.each(SHIFT_CODES)(
    "persists %s immediately with PREFILL source, ordinary audit and one revision increment",
    async (shift) => {
      await prefer(shift);
      const p = await read();
      const result = await acceptDailyPreferences(ctx, {
        ...payload(p),
        shift: "H",
        capacity: 999,
        preference: "OFF",
      });
      expect(result).toMatchObject({
        ok: true,
        data: {
          createdAssignmentCount: 1,
          revision: 1,
          alreadyAssignedCount: 0,
          outcomes: [{ nurseId: N, preference: shift, outcome: "CREATED" }],
        },
      });
      expect(await listAssignments(db, S)).toEqual([
        { nurseId: N, date: D, shift },
      ]);
      const [stored] = await db.select().from(shiftAssignments);
      expect(stored).toMatchObject({
        source: "PREFILL",
        updatedBy: U.icuHead.id,
      });
      const events = await listAuditEventsForSchedule(db, S);
      expect(events.map((a) => a.action)).toEqual([
        "assignment.created",
        "schedule.dailyPreferencesAccepted",
      ]);
      expect(events[0]).toMatchObject({
        actorId: U.icuHead.id,
        data: { nurseId: N, date: D, before: null, after: shift },
      });
      expect(events[1]).toMatchObject({
        data: { date: D, operation: "ONE", assignmentCount: 1 },
      });
      expect((await schedule()).revision).toBe(1);
      expect(
        (await read()).groups.flatMap((g) => g.suggestions)[0]?.status,
      ).toBe("ALREADY_ASSIGNED");
    },
  );

  it("chooses an individual explicitly from a contended group without choosing their peers", async () => {
    await pin(0, 1);
    await prefer();
    await prefer("M", U.icuNurse2.id);
    expect((await read()).groups[0]).toMatchObject({
      manualSelectionRequired: true,
      bulkEligible: false,
    });
    expect(await accept()).toMatchObject({
      ok: true,
      data: { createdAssignmentCount: 1 },
    });
    expect(await listAssignments(db, S)).toEqual([
      { nurseId: N, date: D, shift: "M" },
    ]);
    expect(
      await accept({ kind: "ONE", nurseId: U.icuNurse2.id }),
    ).toMatchObject({
      ok: false,
      error: {
        code: "RULE_VIOLATION",
        violations: [expect.objectContaining({ status: "ABOVE_MAXIMUM" })],
      },
    });
  });

  it("reports actual remaining shortages after ONE, rather than a hypothetical next bulk acceptance", async () => {
    await pin(3, 4);
    await prefer();
    await prefer("M", U.icuNurse2.id);
    const result = await accept();
    expect(result).toMatchObject({
      ok: true,
      data: {
        coverage: expect.arrayContaining([
          expect.objectContaining({
            period: "M",
            covered: 1,
            remainingShortage: 2,
          }),
        ]),
      },
    });
    const validation = await validateWorkingCopy(db, await schedule());
    expect(validation.violations).toContainEqual(
      expect.objectContaining({
        rule: "STAFFING",
        severity: "error",
        period: "M",
        covered: 1,
      }),
    );
  });

  it.each(ASSIGNMENT_CODES)(
    "never replaces an existing different %s assignment",
    async (shift) => {
      await prefer(shift === "M" ? "E" : "M");
      await assign(shift);
      const before = await state();
      expect(await accept()).toMatchObject({
        ok: false,
        error: { code: "VALIDATION", reason: "EXISTING_ASSIGNMENT" },
      });
      expect(await state()).toEqual(before);
    },
  );

  it("does not rewrite a matching assignment or its metadata/audit/revision", async () => {
    await prefer();
    await assign("M");
    const before = await state();
    expect(await accept()).toMatchObject({
      ok: true,
      data: {
        createdAssignmentCount: 0,
        alreadyAssignedCount: 1,
        revision: 0,
        outcomes: [{ outcome: "ALREADY_ASSIGNED" }],
      },
    });
    expect(await state()).toEqual(before);
  });

  it.each([
    "OFF_PREFERENCE",
    "NON_NURSING_PREFERENCE",
    "INACTIVE_OR_NOT_MEMBER",
    "NO_PREFERENCE",
  ])("refuses %s without writes", async (reason) => {
    if (reason !== "NO_PREFERENCE")
      await prefer(reason === "OFF_PREFERENCE" ? "OFF" : "M");
    if (reason === "NON_NURSING_PREFERENCE")
      await db
        .update(scheduleRoster)
        .set({ role: "SECRETARY" })
        .where(eq(scheduleRoster.userId, N));
    if (reason === "INACTIVE_OR_NOT_MEMBER")
      await db
        .update(departmentMemberships)
        .set({ endedOn: addDays(D, -1) })
        .where(eq(departmentMemberships.userId, N));
    const before = await state();
    expect(await accept()).toMatchObject({
      ok: false,
      error: { code: "VALIDATION", reason },
    });
    expect(await state()).toEqual(before);
  });

  it("blocks a configured zero maximum", async () => {
    await pin(0, 0);
    await prefer();
    const before = await state();
    expect(await accept()).toMatchObject({
      ok: false,
      error: {
        code: "RULE_VIOLATION",
        violations: [
          expect.objectContaining({
            rule: "STAFFING",
            status: "ABOVE_MAXIMUM",
          }),
        ],
      },
    });
    expect(await state()).toEqual(before);
  });
});

describe("atomic bulk acceptance", () => {
  it("accepts all safe groups in one transaction and increments revision once", async () => {
    await prefer();
    await prefer("E", U.icuNurse2.id);
    await prefer("N", U.icuNurse3.id);
    await prefer("ME", U.icuHead.id);
    await prefer("OFF", U.icuNurse4.id);
    const result = await accept(bulk());
    expect(result).toMatchObject({
      ok: true,
      data: {
        createdAssignmentCount: 4,
        revision: 1,
        outcomes: expect.arrayContaining([
          expect.objectContaining({
            outcome: "INFORMATIONAL",
            reason: "OFF_PREFERENCE",
          }),
        ]),
      },
    });
    expect(await listAssignments(db, S)).toHaveLength(4);
    const events = await listAuditEventsForSchedule(db, S);
    expect(
      events.filter((a) => a.action === "assignment.created"),
    ).toHaveLength(4);
    expect(
      events.filter((a) => a.action === "schedule.dailyPreferencesAccepted"),
    ).toHaveLength(1);
  });

  it.each(["M", "E"] as const)(
    "leaves shared groups unchanged when %s and ME participate in two-bucket contention",
    async (shift) => {
      await pin(0, 1);
      const other = shift === "M" ? "E" : "M";
      await prefer(shift);
      await prefer("ME", U.icuNurse2.id);
      await prefer("N", U.icuNurse3.id);
      await prefer(other, U.icuNurse4.id);
      const result = await accept(bulk());
      expect(result).toMatchObject({
        ok: true,
        data: {
          createdAssignmentCount: 1,
          revision: 1,
          groupsRequiringManualSelection: ["M", "E", "ME"],
        },
      });
      // Both buckets contend here: the other short shift also shares ME's demand.
      expect(await listAssignments(db, S)).toEqual([
        { nurseId: U.icuNurse3.id, date: D, shift: "N" },
      ]);
      expect(result.ok && result.data.skippedGroups).toContainEqual({
        shift,
        reason: "CAPACITY_CONTENTION",
        contentionPeriods: [shift],
      });
    },
  );

  it("lets an independent E group proceed when only M/ME contend", async () => {
    const id = await publishTestRuleSet(db, {
      departmentId: DEMO_ICU.id,
      createdBy: U.icuHead.id,
      content: ruleContent(
        { min: 0, max: null },
        {
          normal: {
            M: { min: 0, max: 1 },
            E: { min: 0, max: 3 },
            N: { min: 0, max: 1 },
          },
        },
      ),
    });
    await pinTestRuleSet(db, S, id);
    await prefer();
    await prefer("ME", U.icuNurse2.id);
    await prefer("E", U.icuNurse3.id);
    await prefer("N", U.icuNurse4.id);
    expect(await accept(bulk())).toMatchObject({
      ok: true,
      data: {
        createdAssignmentCount: 2,
        groupsRequiringManualSelection: ["M", "ME"],
      },
    });
    expect((await listAssignments(db, S)).map((a) => a.shift).sort()).toEqual([
      "E",
      "N",
    ]);
  });

  it("does not turn an oversubscribed group bulk-eligible after excluding a nurse", async () => {
    await pin(0, 1);
    await prefer();
    await prefer("M", U.icuNurse2.id);
    await prefer("N", U.icuNurse3.id);
    const result = await accept(bulk([U.icuNurse2.id]));
    expect(result).toMatchObject({
      ok: true,
      data: {
        createdAssignmentCount: 1,
        groupsRequiringManualSelection: ["M"],
      },
    });
    expect(await listAssignments(db, S)).toEqual([
      { nurseId: U.icuNurse3.id, date: D, shift: "N" },
    ]);
  });

  it("honors session exclusions in safe groups and they disappear on reopening", async () => {
    await prefer();
    await prefer("E", U.icuNurse2.id);
    expect(await accept(bulk([U.icuNurse2.id]))).toMatchObject({
      ok: true,
      data: {
        createdAssignmentCount: 1,
        skippedSuggestions: [
          expect.objectContaining({
            nurseId: U.icuNurse2.id,
            reason: "SESSION_EXCLUDED",
          }),
        ],
      },
    });
    expect(
      (await read()).groups.find((g) => g.shift === "E")?.suggestions[0]
        ?.status,
    ).toBe("ELIGIBLE");
  });

  it("reports existing assignments and hard conflicts while persisting other eligible nurses", async () => {
    await prefer();
    await assign("M");
    await prefer("E", U.icuNurse2.id);
    await assign("H", U.icuNurse2.id);
    await prefer("N", U.icuNurse3.id);
    await assign("N", U.icuNurse3.id, addDays(D, -1));
    await prefer("ME", U.icuNurse4.id);
    expect(await accept(bulk())).toMatchObject({
      ok: true,
      data: {
        createdAssignmentCount: 1,
        alreadyAssignedCount: 1,
        skippedSuggestions: expect.arrayContaining([
          expect.objectContaining({ reason: "EXISTING_ASSIGNMENT" }),
          expect.objectContaining({ reason: "RULE_VIOLATION" }),
        ]),
        hardRuleConflicts: [
          {
            nurseId: U.icuNurse3.id,
            violations: [expect.objectContaining({ rule: "NIGHT_REST" })],
          },
        ],
      },
    });
    expect(
      (await listAssignments(db, S)).find((a) => a.nurseId === U.icuNurse2.id)
        ?.shift,
    ).toBe("H");
  });

  it("is a genuine no-op with no preferences, including audit and revision", async () => {
    const before = await state();
    expect(await accept(bulk())).toMatchObject({
      ok: true,
      data: {
        createdAssignmentCount: 0,
        alreadyAssignedCount: 0,
        revision: 0,
        outcomes: [],
      },
    });
    expect(await state()).toEqual(before);
  });

  it("rolls back assignments, audit and revision together on an audit failure", async () => {
    await prefer();
    await prefer("E", U.icuNurse2.id);
    const before = await state();
    vi.spyOn(console, "error").mockImplementation(() => {});
    await db.execute(
      sql`create function reject_daily_audit() returns trigger language plpgsql as $$ begin if new.action = 'schedule.dailyPreferencesAccepted' then raise exception 'injected audit failure'; end if; return new; end $$`,
    );
    await db.execute(
      sql`create trigger daily_audit_failure before insert on audit_events for each row execute function reject_daily_audit()`,
    );
    try {
      expect(await accept(bulk())).toMatchObject({
        ok: false,
        error: { code: "INTERNAL" },
      });
      expect(await state()).toEqual(before);
    } finally {
      await db.execute(sql`drop trigger daily_audit_failure on audit_events`);
      await db.execute(sql`drop function reject_daily_audit()`);
    }
  });
});

describe("rest and boundary context", () => {
  it.each(["before", "after"])(
    "blocks night rest with the existing %s-day decision",
    async (side) => {
      await prefer(side === "before" ? "M" : "N");
      await assign(
        side === "before" ? "N" : "M",
        N,
        addDays(D, side === "before" ? -1 : 1),
      );
      const before = await state();
      expect(await accept()).toMatchObject({
        ok: false,
        error: {
          code: "RULE_VIOLATION",
          violations: [expect.objectContaining({ rule: "NIGHT_REST" })],
        },
      });
      expect(await state()).toEqual(before);
    },
  );

  it.each(["previous", "next"])(
    "loads the %s boundary for a nurse with no current-month assignment",
    async (side) => {
      const s = await schedule();
      const date = side === "previous" ? s.period.start : s.period.end;
      const outside = addDays(date, side === "previous" ? -1 : 1);
      const neighbor = await createSchedule(db, {
        departmentId: DEMO_ICU.id,
        createdBy: U.icuHead.id,
        label: "همسایه",
        period:
          side === "previous"
            ? { start: addDays(outside, -29), end: outside }
            : { start: outside, end: addDays(outside, 29) },
      });
      await snapshotRosterFromMemberships(db, {
        scheduleId: neighbor.id,
        addedBy: U.icuHead.id,
      });
      await assign(side === "previous" ? "N" : "M", N, outside, neighbor.id);
      await prefer(side === "previous" ? "ME" : "N", N, date);
      const p = await read(ctx, date);
      expect(
        p.groups.flatMap((g) => g.suggestions)[0]?.assessment?.blocking,
      ).toMatchObject([{ rule: "NIGHT_REST" }]);
      expect(await acceptDailyPreferences(ctx, payload(p))).toMatchObject({
        ok: false,
        error: { code: "RULE_VIOLATION" },
      });
      expect(await listAssignments(db, S)).toEqual([]);
    },
  );
});

describe("freshness and proof binding", () => {
  it.each(["updated", "deleted", "other nurse added"])(
    "rejects a %s preference without relying on a revision bump",
    async (change) => {
      await prefer();
      const p = await read();
      if (change === "updated") await prefer("ME");
      else if (change === "deleted")
        await clearPreference(db, { scheduleId: S, userId: N, date: D });
      else await prefer("M", U.icuNurse2.id);
      const before = await state();
      expect(before.schedule.revision).toBe(p.revision);
      expect(await acceptDailyPreferences(ctx, payload(p))).toMatchObject({
        ok: false,
        error: { code: "CONFLICT", reason: "DAILY_PREFERENCES_STALE" },
      });
      expect(await state()).toEqual(before);
    },
  );

  it("rejects stale revision even when a fresh proof is supplied", async () => {
    await prefer();
    const p = await read();
    expect(
      await acceptDailyPreferences(ctx, { ...payload(p), expectedRevision: 9 }),
    ).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    expect((await schedule()).revision).toBe(0);
  });

  it.each([
    "fingerprint",
    "signature",
    "date",
    "schedule",
    "actor",
    "expired",
    "future",
  ])("binds the proof against %s tampering/replay", async (kind) => {
    await prefer();
    const p = await read();
    const raw = payload(p);
    let as = ctx;
    if (kind === "fingerprint" || kind === "signature")
      raw.proof = { ...raw.proof, [kind]: "0".repeat(64) };
    if (kind === "date") raw.date = addDays(D, 1);
    if (kind === "schedule") {
      const other = await createSchedule(db, {
        departmentId: DEMO_ICU.id,
        createdBy: U.icuHead.id,
        label: "دیگر",
        period: { start: isoDate("2026-11-22"), end: isoDate("2026-12-21") },
      });
      raw.scheduleId = other.id;
      raw.date = other.period.start;
    }
    if (kind === "actor") {
      await db
        .update(departmentMemberships)
        .set({ role: "HEAD_NURSE" })
        .where(eq(departmentMemberships.userId, U.icuNurse2.id));
      as = await context(U.icuNurse2.id);
    }
    if (kind === "expired" || kind === "future")
      as = {
        ...ctx,
        clock: () =>
          new Date(
            NOW.getTime() + (kind === "expired" ? 15 * 60 * 1000 + 1 : -1),
          ),
      };
    expect(await acceptDailyPreferences(as, raw)).toMatchObject({
      ok: false,
      error: { code: "CONFLICT", reason: "DAILY_PREFERENCES_STALE" },
    });
    expect(await listAssignments(db, S)).toEqual([]);
  });

  it.each([
    "membership",
    "account",
    "roster",
    "rules",
    "holiday",
    "assignment",
  ])(
    "detects %s changes that do not necessarily bump revision",
    async (change) => {
      await prefer();
      const p = await read();
      if (change === "membership")
        await db
          .update(departmentMemberships)
          .set({ endedOn: addDays(D, -1) })
          .where(eq(departmentMemberships.userId, N));
      if (change === "account")
        await db.update(users).set({ isActive: false }).where(eq(users.id, N));
      if (change === "roster")
        await db
          .update(scheduleRoster)
          .set({ role: "SECRETARY" })
          .where(eq(scheduleRoster.userId, N));
      if (change === "rules") await pin(0, 0);
      if (change === "holiday")
        ctx = {
          ...ctx,
          holidays: {
            listOfficialHolidays: async () => [{ date: D, name: "تعطیل" }],
          },
        };
      if (change === "assignment") await assign("OFF");
      const before = await state();
      expect(await acceptDailyPreferences(ctx, payload(p))).toMatchObject({
        ok: false,
        error: { code: "CONFLICT", reason: "DAILY_PREFERENCES_STALE" },
      });
      expect(await state()).toEqual(before);
    },
  );
});

describe("authorization and lifecycle", () => {
  it.each([U.icuNurse1.id, U.erHead.id, U.supervisor.id, U.inactiveNurse.id])(
    "denies preview and acceptance for %s",
    async (userId) => {
      await prefer();
      const p = await read();
      const as = await context(userId);
      const before = await state();
      await expect(read(as)).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(await acceptDailyPreferences(as, payload(p))).toMatchObject({
        ok: false,
        error: { code: "FORBIDDEN" },
      });
      expect(await state()).toEqual(before);
    },
  );

  it.each(["deactivated", "demoted"])(
    "reloads authority when the caller's previously trusted actor was %s",
    async (change) => {
      await prefer();
      const p = await read();
      if (change === "deactivated")
        await db
          .update(users)
          .set({ isActive: false })
          .where(eq(users.id, U.icuHead.id));
      else
        await db
          .update(departmentMemberships)
          .set({ role: "NURSE" })
          .where(eq(departmentMemberships.userId, U.icuHead.id));
      await expect(read()).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(await acceptDailyPreferences(ctx, payload(p))).toMatchObject({
        ok: false,
        error: { code: "FORBIDDEN" },
      });
    },
  );

  it("denies a Hospital Admin who is not the department's Head Nurse", async () => {
    await prefer();
    const p = await read();
    await db
      .update(users)
      .set({ isHospitalAdmin: true })
      .where(eq(users.id, U.erHead.id));
    const as = await context(U.erHead.id);
    await expect(read(as)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await acceptDailyPreferences(as, payload(p))).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
  });

  it.each([
    "FINALIZED",
    "SUBMITTED",
    "RETURNED",
    "APPROVED",
    "REVISING",
  ] as const)(
    "refuses %s without changing lifecycle or opening revisions",
    async (status) => {
      await prefer();
      const p = await read();
      await setStatus(status);
      const before = await state();
      await expect(read()).rejects.toMatchObject({ code: "INVALID_STATE" });
      expect(await acceptDailyPreferences(ctx, payload(p))).toMatchObject({
        ok: false,
        error: { code: "INVALID_STATE" },
      });
      expect(await state()).toEqual(before);
    },
  );

  it.each(["open", "closed"])(
    "accepts in PLANNING independently of an %s preference window",
    async (window) => {
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
      if (window === "closed")
        expect(
          (
            await closePreferenceWindow(ctx, {
              scheduleId: S,
              expectedRevision: (await schedule()).revision,
            })
          ).ok,
        ).toBe(true);
      const windows = await listPreferenceWindows(db, S);
      expect(await accept()).toMatchObject({
        ok: true,
        data: { createdAssignmentCount: 1 },
      });
      expect((await schedule()).status).toBe("PLANNING");
      expect(await listPreferenceWindows(db, S)).toEqual(windows);
    },
  );

  it("returns NOT_FOUND for unknown or inactive department schedules", async () => {
    await expect(
      read(ctx, D, "30000000-0000-4000-8000-000000000099"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await prefer();
    const p = await read();
    expect(
      await acceptDailyPreferences(ctx, {
        ...payload(p),
        scheduleId: "30000000-0000-4000-8000-000000000099",
      }),
    ).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    await db
      .update(departments)
      .set({ isActive: false })
      .where(eq(departments.id, DEMO_ICU.id));
    expect(await acceptDailyPreferences(ctx, payload(p))).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
  });
});

describe("real transaction serialization", () => {
  it("cannot exceed shared capacity when two different nurses are accepted concurrently", async () => {
    await pin(0, 1);
    await prefer();
    await prefer("M", U.icuNurse2.id);
    const p = await read();
    const results = await Promise.all([
      acceptDailyPreferences(ctx, payload(p)),
      acceptDailyPreferences(
        ctx,
        payload(p, { kind: "ONE", nurseId: U.icuNurse2.id }),
      ),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toMatchObject([
      { ok: false, error: { code: "CONFLICT" } },
    ]);
    expect(await listAssignments(db, S)).toHaveLength(1);
    expect((await schedule()).revision).toBe(1);
  });

  it("does not write twice after a lost-response retry with the original proof", async () => {
    await prefer();
    const p = await read();
    expect((await acceptDailyPreferences(ctx, payload(p))).ok).toBe(true);
    const before = await state();
    expect(await acceptDailyPreferences(ctx, payload(p))).toMatchObject({
      ok: false,
      error: { code: "CONFLICT" },
    });
    expect(await state()).toEqual(before);
  });

  it("waits for a neighboring assignment writer, then rejects its changed rest context", async () => {
    const s = await schedule();
    const boundary = addDays(s.period.start, -1);
    const neighbor = await createSchedule(db, {
      departmentId: DEMO_ICU.id,
      createdBy: U.icuHead.id,
      label: "همسایه",
      period: { start: addDays(boundary, -29), end: boundary },
    });
    await snapshotRosterFromMemberships(db, {
      scheduleId: neighbor.id,
      addedBy: U.icuHead.id,
    });
    await prefer("M", N, s.period.start);
    const p = await read(ctx, s.period.start);
    const client = await pool.connect();
    let running: ReturnType<typeof acceptDailyPreferences> | undefined;
    try {
      await client.query("begin");
      await client.query("select id from schedules where id = $1 for update", [
        neighbor.id,
      ]);
      await client.query(
        "insert into shift_assignments (schedule_id, user_id, date, shift_code, source, updated_by) values ($1,$2,$3,'N','MANUAL',$4)",
        [neighbor.id, N, boundary, U.icuHead.id],
      );
      running = acceptDailyPreferences(ctx, payload(p));
      await vi.waitFor(
        async () => {
          const waiting = await pool.query(
            "select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'",
          );
          expect(waiting.rows[0].n).toBeGreaterThan(0);
        },
        { timeout: 5_000 },
      );
    } finally {
      await client.query("commit");
      client.release();
    }
    expect(await running).toMatchObject({
      ok: false,
      error: { code: "CONFLICT", reason: "DAILY_PREFERENCES_STALE" },
    });
    expect(await listAssignments(db, S)).toEqual([]);
    expect((await schedule()).revision).toBe(0);
  });

  it.each(["acceptance", "manual edit", "monthly application"])(
    "serializes acceptance against concurrent %s",
    async (other) => {
      await prefer("ME");
      const p = await read();
      const competing = () =>
        other === "acceptance"
          ? acceptDailyPreferences(ctx, payload(p))
          : other === "manual edit"
            ? setAssignments(ctx, {
                scheduleId: S,
                expectedRevision: 0,
                changes: [{ nurseId: N, date: D, shift: "OFF" }],
              })
            : applyMonthlyPreferences(ctx, {
                scheduleId: S,
                expectedRevision: 0,
              });
      const results = await Promise.all([
        acceptDailyPreferences(ctx, payload(p)),
        competing(),
      ]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.filter((r) => !r.ok)).toMatchObject([
        { ok: false, error: { code: "CONFLICT" } },
      ]);
      expect((await schedule()).revision).toBe(1);
      expect(await listAssignments(db, S)).toHaveLength(1);
      expect(
        (await listAuditEventsForSchedule(db, S)).filter(
          (e) => e.action === "assignment.created",
        ),
      ).toHaveLength(1);
    },
  );

  it.each(["preference save", "membership end", "deactivation"])(
    "waits for an in-flight %s, then refuses the stale proof",
    async (change) => {
      await prefer();
      const p = await read();
      const client = await pool.connect();
      let running: ReturnType<typeof acceptDailyPreferences> | undefined;
      try {
        await client.query("begin");
        if (change === "preference save") {
          await client.query(
            "select id from schedules where id = $1 for share",
            [S],
          );
          await client.query(
            "update nurse_preferences set value = 'ME' where schedule_id = $1 and user_id = $2",
            [S, N],
          );
        } else if (change === "membership end") {
          await client.query(
            "update department_memberships set ended_on = $1 where user_id = $2",
            [addDays(D, -1), N],
          );
        } else
          await client.query(
            "update users set is_active = false where id = $1",
            [N],
          );
        running = acceptDailyPreferences(ctx, payload(p));
        await vi.waitFor(
          async () => {
            const waiting = await pool.query(
              "select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'",
            );
            expect(waiting.rows[0].n).toBeGreaterThan(0);
          },
          { timeout: 5_000 },
        );
      } finally {
        await client.query("commit");
        client.release();
      }
      expect(await running).toMatchObject({
        ok: false,
        error: { code: "CONFLICT", reason: "DAILY_PREFERENCES_STALE" },
      });
      expect(await listAssignments(db, S)).toEqual([]);
      expect((await schedule()).revision).toBe(0);
      expect(await listAuditEventsForSchedule(db, S)).toEqual([]);
    },
  );
});
