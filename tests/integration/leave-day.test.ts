import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { createChangeRequest } from "../../src/application/change-requests/commands";
import { getChangeRequestOptions } from "../../src/application/change-requests/queries";
import { getMyShiftsMonth } from "../../src/application/my-shifts/queries";
import { getCoverageCandidates } from "../../src/application/schedules/coverage-candidates";
import { createSchedule } from "../../src/application/schedules/create-schedule";
import { directSwap } from "../../src/application/schedules/direct-swap";
import { setAssignments } from "../../src/application/schedules/edit-assignments";
import {
  approveSchedule,
  finalizeSchedule,
  submitSchedule,
} from "../../src/application/schedules/lifecycle";
import {
  closePreferenceWindow,
  openPreferenceWindow,
} from "../../src/application/schedules/preference-windows";
import { getScheduleReview } from "../../src/application/schedules/review";
import {
  adjustSchedule,
  discardRevision,
} from "../../src/application/schedules/schedule-changes";
import { getShiftLabels } from "../../src/application/shifts/labels";
import type { ActionResult } from "../../src/application/result";
import type { AppContext } from "../../src/application/use-case";
import { isoDate } from "../../src/domain/shared/dates";
import type { AssignmentCode } from "../../src/domain/shifts/shift-type";
import {
  DEMO_ICU,
  DEMO_USERS as U,
} from "../../src/infrastructure/db/seed/demo-data";
import { listAssignments } from "../../src/infrastructure/repositories/assignments";
import { listAuditEventsForSchedule } from "../../src/infrastructure/repositories/audit";
import { loadActor } from "../../src/infrastructure/repositories/memberships";
import { listRoster } from "../../src/infrastructure/repositories/roster";
import { findScheduleById } from "../../src/infrastructure/repositories/schedules";
import { listVersionAssignments } from "../../src/infrastructure/repositories/versions";
import { setupTestDatabase } from "./support/database";

/** D118: Leave (H) through the real commands, queries and PostgreSQL. */

const { db } = setupTestDatabase();
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
type Cell = { nurseId: string; date: string; shift: AssignmentCode | null };
const edit = async (changes: Cell[], context = head) =>
  setAssignments(context, {
    scheduleId: id,
    expectedRevision: await revision(),
    changes,
  });
const cell = async (nurseId: string, date = first) =>
  (await listAssignments(db, id)).find(
    (a) => a.nurseId === nurseId && a.date === date,
  )?.shift ?? null;
const review = (day = first) =>
  getScheduleReview(head, {
    departmentId: DEMO_ICU.id,
    scheduleId: id,
    day,
  });

beforeEach(async () => {
  head = await ctx(U.icuHead.id);
  supervisor = await ctx(U.supervisor.id);
  id = ok(
    await createSchedule(head, {
      departmentId: DEMO_ICU.id,
      periodStart: first,
      periodEnd: second,
      label: "Leave regression",
    }),
  ).scheduleId;
  await step(openPreferenceWindow as typeof finalizeSchedule);
  await step(closePreferenceWindow as typeof finalizeSchedule);
});

/**
 * A complete, staffed two-day schedule with leave:
 * day 1 — nurse1 ME, nurse2 N, nurse3 H; day 2 — nurse3 ME, nurse4 N,
 * nurse2 H (right after their Night); everyone else OFF.
 */
async function complete() {
  const roster = await listRoster(db, id);
  const plan: Record<string, Partial<Record<string, AssignmentCode>>> = {
    [first]: {
      [U.icuNurse1.id]: "ME",
      [U.icuNurse2.id]: "N",
      [U.icuNurse3.id]: "H",
    },
    [second]: {
      [U.icuNurse3.id]: "ME",
      [U.icuNurse4.id]: "N",
      [U.icuNurse2.id]: "H",
    },
  };
  ok(
    await edit(
      [first, second].flatMap((date) =>
        roster.map((r) => ({
          nurseId: r.userId,
          date,
          shift: plan[date]![r.userId] ?? "OFF",
        })),
      ),
    ),
  );
}
async function approve() {
  await step(finalizeSchedule);
  await step(submitSchedule);
  return step(approveSchedule, supervisor);
}

describe("reference data (migration 0014)", () => {
  it("adds H as a non-working, non-night code without touching preferences", async () => {
    const rows = await db.execute<{
      code: string;
      label: string;
      covers: string[];
      is_night: boolean;
      sort_order: number;
    }>(
      sql`select code, label, covers, is_night, sort_order from shift_types order by sort_order`,
    );
    expect(rows.rows.map((r) => r.code)).toEqual([
      "M",
      "E",
      "N",
      "ME",
      "OFF",
      "H",
    ]);
    expect(rows.rows.at(-1)).toEqual({
      code: "H",
      label: "مرخصی",
      covers: [],
      is_night: false,
      sort_order: 6,
    });
    expect((await getShiftLabels(db)).H).toBe("مرخصی");
    // Nurses never wish for leave: the preference enum is unchanged.
    const enumValues = await db.execute<{ value: string }>(
      sql`select unnest(enum_range(null::preference_value))::text as value`,
    );
    expect(enumValues.rows.map((r) => r.value)).toEqual([
      "M",
      "E",
      "N",
      "ME",
      "OFF",
    ]);
  });
});

describe("editing leave in the Head Nurse's schedule", () => {
  it("assigns, replaces and clears H through the normal command, audited", async () => {
    ok(await edit([{ nurseId: U.icuNurse1.id, date: first, shift: "N" }]));
    ok(await edit([{ nurseId: U.icuNurse1.id, date: first, shift: "H" }]));
    expect(await cell(U.icuNurse1.id)).toBe("H");
    ok(await edit([{ nurseId: U.icuNurse1.id, date: first, shift: "M" }]));
    expect(await cell(U.icuNurse1.id)).toBe("M");
    ok(await edit([{ nurseId: U.icuNurse1.id, date: first, shift: "H" }]));
    ok(await edit([{ nurseId: U.icuNurse1.id, date: first, shift: null }]));
    expect(await cell(U.icuNurse1.id)).toBeNull();

    const events = (await listAuditEventsForSchedule(db, id))
      .filter((e) => e.action.startsWith("assignment."))
      .map((e) => [e.action, e.data?.before, e.data?.after]);
    expect(events).toEqual(
      expect.arrayContaining([
        ["assignment.created", null, "N"],
        ["assignment.changed", "N", "H"],
        ["assignment.changed", "H", "M"],
        ["assignment.changed", "M", "H"],
        ["assignment.cleared", "H", null],
      ]),
    );
  });

  it("stores exactly one decision per nurse and day: leave replaces the shift", async () => {
    ok(await edit([{ nurseId: U.icuNurse1.id, date: first, shift: "ME" }]));
    ok(await edit([{ nurseId: U.icuNurse1.id, date: first, shift: "H" }]));
    const rows = (await listAssignments(db, id)).filter(
      (a) => a.nurseId === U.icuNurse1.id && a.date === first,
    );
    expect(rows).toEqual([expect.objectContaining({ shift: "H" })]);
    // The same cell twice in one request is refused, never stored twice.
    expect(
      await edit([
        { nurseId: U.icuNurse1.id, date: first, shift: "H" },
        { nurseId: U.icuNurse1.id, date: first, shift: "M" },
      ]),
    ).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
    // The primary key is the final guard.
    await expect(
      db.execute(
        sql`insert into shift_assignments (schedule_id, user_id, date, shift_code, updated_by)
            values (${id}, ${U.icuNurse1.id}, ${first}, 'M', ${U.icuHead.id})`,
      ),
    ).rejects.toThrow();
  });

  it("refuses a stale revision and serializes concurrent edits", async () => {
    const seen = await revision();
    ok(await edit([{ nurseId: U.icuNurse1.id, date: first, shift: "M" }]));
    expect(
      await setAssignments(head, {
        scheduleId: id,
        expectedRevision: seen,
        changes: [{ nurseId: U.icuNurse1.id, date: first, shift: "H" }],
      }),
    ).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    expect(await cell(U.icuNurse1.id)).toBe("M");

    const current = await revision();
    const results = await Promise.all(
      (["H", "N"] as const).map((shift) =>
        setAssignments(head, {
          scheduleId: id,
          expectedRevision: current,
          changes: [{ nurseId: U.icuNurse1.id, date: first, shift }],
        }),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([
      expect.objectContaining({
        error: expect.objectContaining({ code: "CONFLICT" }),
      }),
    ]);
    const winner = results.findIndex((r) => r.ok);
    expect(await cell(U.icuNurse1.id)).toBe(winner === 0 ? "H" : "N");
  });

  it("only the department's Head Nurse may record leave", async () => {
    for (const userId of [U.icuNurse1.id, U.supervisor.id])
      expect(
        await edit(
          [{ nurseId: U.icuNurse2.id, date: first, shift: "H" }],
          await ctx(userId),
        ),
      ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(await cell(U.icuNurse2.id)).toBeNull();
  });
});

describe("leave in validation, coverage and the day review", () => {
  it("a staffed schedule with leave (including N then H) finalizes", async () => {
    await complete();
    const day = await review(second);
    expect(day.day!.validation).toMatchObject({
      state: "READY",
      undecided: 0,
      ruleViolations: 0,
      leave: 1,
    });
    expect(day.day!.leave.map((n) => n.userId)).toEqual([U.icuNurse2.id]);
    expect(day.day!.off.map((n) => n.userId)).not.toContain(U.icuNurse2.id);
    expect(day.day!.unassigned).toEqual([]);
    expect(day.month.days.map((d) => d.leave)).toEqual([1, 1]);
    await step(finalizeSchedule);
    expect((await findScheduleById(db, id))!.status).toBe("FINALIZED");
  });

  it("leave never satisfies a staffing minimum", async () => {
    await complete();
    // The only Night nurse on day 1 goes on leave: N falls to 0.
    ok(await edit([{ nurseId: U.icuNurse2.id, date: first, shift: "H" }]));
    const day = await review(first);
    expect(day.day!.validation).toMatchObject({
      state: "COVERAGE",
      coverage: { M: 1, E: 1, N: 0 },
      shortages: 1,
      leave: 2,
    });
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
            period: "N",
            covered: 0,
            date: first,
          }),
        ],
      },
    });
  });

  it("a nurse on leave is never offered as a coverage candidate", async () => {
    await complete();
    ok(await edit([{ nurseId: U.icuNurse2.id, date: first, shift: "OFF" }]));
    const result = await getCoverageCandidates(head, {
      scheduleId: id,
      date: first,
      shift: "N",
    });
    if (result.status !== "SHORTAGE") throw new Error("expected a shortage");
    const offered = [...result.available, ...result.notAllowed].map(
      (c) => c.userId,
    );
    expect(offered).toContain(U.icuNurse2.id); // OFF: a candidate
    expect(offered).not.toContain(U.icuNurse3.id); // H: never
  });
});

describe("workflow boundaries and approved versions", () => {
  it("SUBMITTED and APPROVED refuse leave edits; the approved version is immutable", async () => {
    await complete();
    await step(finalizeSchedule);
    await step(submitSchedule);
    expect(
      await edit([{ nurseId: U.icuNurse4.id, date: first, shift: "H" }]),
    ).toMatchObject({ ok: false, error: { code: "INVALID_STATE" } });
    const approved = await step(approveSchedule, supervisor);
    expect(
      await edit([{ nurseId: U.icuNurse4.id, date: first, shift: "H" }]),
    ).toMatchObject({ ok: false, error: { code: "INVALID_STATE" } });
    expect(await listVersionAssignments(db, approved.versionId!)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nurseId: U.icuNurse3.id,
          date: first,
          shift: "H",
        }),
      ]),
    );
  });

  it("leave after approval goes through a revision; v1 is unchanged and the nurse sees the official version", async () => {
    await complete();
    const v1 = await approve();
    const original = await listVersionAssignments(db, v1.versionId!);

    // Recording leave for an OFF nurse keeps coverage: opens a revision.
    const adjusted = ok(
      await adjustSchedule(head, {
        scheduleId: id,
        expectedRevision: await revision(),
        changes: [{ nurseId: U.icuNurse4.id, date: first, shift: "H" }],
        reasonCode: "OTHER",
        note: "approved annual leave",
      }),
    );
    expect(adjusted.mode).toBe("START_REVISION");
    expect((await findScheduleById(db, id))!.status).toBe("REVISING");
    expect(await cell(U.icuNurse4.id)).toBe("H");

    // The nurse still sees the approved OFF, flagged as pending.
    const nurse4 = await ctx(U.icuNurse4.id);
    const pending = await getMyShiftsMonth(nurse4, { period, today });
    expect(pending.days[0]!.entries[0]).toMatchObject({
      shift: "OFF",
      publication: "OFFICIAL",
      changePending: true,
    });
    expect(pending.totals.leaveCount).toBe(0);

    // Leave for the only Night nurse would create a shortage: refused.
    expect(
      await adjustSchedule(head, {
        scheduleId: id,
        expectedRevision: await revision(),
        changes: [{ nurseId: U.icuNurse2.id, date: first, shift: "H" }],
        reasonCode: "OTHER",
        note: "leave",
      }),
    ).toMatchObject({
      ok: false,
      error: {
        code: "RULE_VIOLATION",
        violations: [
          expect.objectContaining({ rule: "STAFFING", period: "N" }),
        ],
      },
    });
    // Outside the revision scope the planning editor stays locked (D14).
    expect(
      await edit([{ nurseId: U.icuNurse1.id, date: second, shift: "H" }]),
    ).toMatchObject({ ok: false, error: { code: "INVALID_STATE" } });

    await step(submitSchedule);
    const v2 = await step(approveSchedule, supervisor);
    expect(await listVersionAssignments(db, v1.versionId!)).toEqual(original);
    expect(await listVersionAssignments(db, v2.versionId!)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nurseId: U.icuNurse4.id,
          date: first,
          shift: "H",
        }),
      ]),
    );
    const official = await getMyShiftsMonth(nurse4, { period, today });
    expect(official.days[0]!.entries[0]).toMatchObject({
      shift: "H",
      publication: "OFFICIAL",
      changePending: false,
    });
    expect(official.totals).toMatchObject({ leaveCount: 1, offCount: 0 });
  });

  it("discarding a revision restores an approved leave day", async () => {
    await complete();
    await approve();
    ok(
      await adjustSchedule(head, {
        scheduleId: id,
        expectedRevision: await revision(),
        changes: [{ nurseId: U.icuNurse3.id, date: first, shift: "OFF" }],
        reasonCode: "OTHER",
        note: "leave cancelled",
      }),
    );
    expect(await cell(U.icuNurse3.id)).toBe("OFF");
    ok(
      await discardRevision(head, {
        scheduleId: id,
        expectedRevision: await revision(),
      }),
    );
    expect(await cell(U.icuNurse3.id)).toBe("H");
  });
});

describe("My Shifts and requests", () => {
  it("shows leave as its own decision and total, with zero working time", async () => {
    await complete();
    const nurse2 = await ctx(U.icuNurse2.id);
    const month = await getMyShiftsMonth(nurse2, { period, today });
    expect(month.days.map((d) => d.entries[0]?.shift)).toEqual(["N", "H"]);
    expect(month.days[1]!.entries[0]!.publication).toBe("TEMPORARY");
    expect(month.totals).toMatchObject({
      shiftCount: 1,
      offCount: 0,
      leaveCount: 1,
      minutes: 12 * 60,
      nightCount: 1,
      includesUnapproved: true,
    });
    expect(month.schedules[0]).toMatchObject({
      shiftCount: 1,
      offCount: 0,
      leaveCount: 1,
    });
    // Never another nurse's leave.
    const nurse1 = await getMyShiftsMonth(await ctx(U.icuNurse1.id), {
      period,
      today,
    });
    expect(nurse1.totals.leaveCount).toBe(0);
  });

  it("leave is never swapped: no partners, request refused, direct swap refused", async () => {
    await complete();
    await step(finalizeSchedule);
    const nurse3 = await ctx(U.icuNurse3.id);
    const options = (await getChangeRequestOptions(nurse3)).schedules.find(
      (s) => s.scheduleId === id,
    )!;
    expect(options.swapCandidates[first]).toEqual([]);
    // From nurse1's working day, the colleague on leave is no partner.
    const nurse1Options = (
      await getChangeRequestOptions(await ctx(U.icuNurse1.id))
    ).schedules.find((s) => s.scheduleId === id)!;
    expect(
      nurse1Options.swapCandidates[first]!.map((c) => c.userId),
    ).not.toContain(U.icuNurse3.id);

    expect(
      await createChangeRequest(await ctx(U.icuNurse1.id), {
        scheduleId: id,
        type: "SWAP",
        date: first,
        counterpartId: U.icuNurse3.id,
        reasonCode: "PERSONAL_MATTER",
      }),
    ).toMatchObject({
      ok: false,
      error: {
        code: "VALIDATION",
        fieldErrors: { counterpartId: expect.anything() },
      },
    });
    const before = await revision();
    expect(
      await directSwap(head, {
        scheduleId: id,
        expectedRevision: before,
        date: first,
        firstNurseId: U.icuNurse1.id,
        secondNurseId: U.icuNurse3.id,
        reasonCode: "OTHER",
        note: "test",
      }),
    ).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
    expect(await cell(U.icuNurse3.id)).toBe("H");
    expect(await revision()).toBe(before);
  });

  it("a nurse on leave may ask to work instead (CHANGE_SHIFT); the request changes nothing by itself", async () => {
    await complete();
    await step(finalizeSchedule);
    const request = ok(
      await createChangeRequest(await ctx(U.icuNurse3.id), {
        scheduleId: id,
        type: "CHANGE_SHIFT",
        date: first,
        targetShift: "M",
        reasonCode: "PERSONAL_MATTER",
      }),
    );
    expect(request.id).toBeDefined();
    expect(await cell(U.icuNurse3.id)).toBe("H");
    expect(
      await createChangeRequest(await ctx(U.icuNurse3.id), {
        scheduleId: id,
        type: "UNAVAILABLE",
        date: second,
        reasonCode: "ILLNESS",
      }),
    ).toMatchObject({ ok: true }); // day 2 is ME: unavailability allowed
  });
});
