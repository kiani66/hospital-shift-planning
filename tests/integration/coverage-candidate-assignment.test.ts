import { and, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import type { ActionResult } from "../../src/application/result";
import {
  assignCoverageCandidate,
  getCoverageCandidates,
} from "../../src/application/schedules/coverage-candidates";
import { setAssignments } from "../../src/application/schedules/edit-assignments";
import type { AppContext } from "../../src/application/use-case";
import type { Actor } from "../../src/domain/authz/actor";
import type { ScheduleStatus } from "../../src/domain/schedule/status";
import { isoDate } from "../../src/domain/shared/dates";
import type {
  AssignmentCode,
  PreferenceValue,
} from "../../src/domain/shifts/shift-type";
import {
  schedules,
  shiftAssignments,
  users,
} from "../../src/infrastructure/db/schema";
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
import {
  addMembership,
  endMembership,
  loadActor,
} from "../../src/infrastructure/repositories/memberships";
import { setPreference } from "../../src/infrastructure/repositories/preferences";
import { startRevision } from "../../src/infrastructure/repositories/revisions";
import {
  addToRoster,
  snapshotRosterFromMemberships,
} from "../../src/infrastructure/repositories/roster";
import {
  createSchedule,
  findScheduleById,
} from "../../src/infrastructure/repositories/schedules";
import {
  createUser,
  setUserActive,
} from "../../src/infrastructure/repositories/users";
import { setupTestDatabase } from "./support/database";
import {
  pinTestRuleSet,
  publishTestRuleSet,
  ruleContent,
} from "./support/rule-sets";

const { db } = setupTestDatabase();
const U = DEMO_USERS;
// ICU, Aban 1405: 2026-10-23 .. 2026-11-21, DRAFT, legacy baseline (M, E and
// N minimum 1, no maximum): every empty coverage period is short.
const S = DEMO_SCHEDULE.id;
const TODAY = isoDate("2026-10-01");
const DAY = "2026-10-25";

const actors = {} as Record<
  "icuHead" | "erHead" | "icuNurse" | "supervisor",
  Actor
>;
beforeEach(async () => {
  actors.icuHead = (await loadActor(db, U.icuHead.id, TODAY))!;
  actors.erHead = (await loadActor(db, U.erHead.id, TODAY))!;
  actors.icuNurse = (await loadActor(db, U.icuNurse1.id, TODAY))!;
  actors.supervisor = (await loadActor(db, U.supervisor.id, TODAY))!;
});
const as = (actor: Actor, clock?: () => Date): AppContext => ({
  db,
  actor,
  clock,
});

const currentRevision = async () => (await findScheduleById(db, S))!.revision;

/** Assigns a candidate as the future panel will: with the revision just read. */
async function assignAs(
  actor: Actor,
  input: {
    nurseId?: string;
    date?: string;
    shift?: string;
    expectedRevision?: number;
  } = {},
  clock?: () => Date,
) {
  return assignCoverageCandidate(as(actor, clock), {
    scheduleId: S,
    nurseId: input.nurseId ?? U.icuNurse1.id,
    date: input.date ?? DAY,
    shift: input.shift ?? "N",
    expectedRevision: input.expectedRevision ?? (await currentRevision()),
  });
}
const assign = (input: Parameters<typeof assignAs>[1] = {}) =>
  assignAs(actors.icuHead, input);

const failure = <T>(result: ActionResult<T>) => {
  if (result.ok) throw new Error("expected a refusal");
  return result.error;
};
const ok = <T>(result: ActionResult<T>): T => {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.data;
};

const put = (
  userId: string,
  date: string,
  shift: AssignmentCode,
  scheduleId = S,
) =>
  setAssignment(db, {
    scheduleId,
    userId,
    date: isoDate(date),
    shift,
    updatedBy: U.icuHead.id,
  });
const prefer = (userId: string, date: string, value: PreferenceValue) =>
  setPreference(db, { scheduleId: S, userId, date: isoDate(date), value });
const setStatus = (status: ScheduleStatus) =>
  db.update(schedules).set({ status }).where(eq(schedules.id, S));
const cellsOf = async (userId: string, date = DAY) =>
  (
    await db
      .select({ shift: shiftAssignments.shiftCode })
      .from(shiftAssignments)
      .where(
        and(
          eq(shiftAssignments.scheduleId, S),
          eq(shiftAssignments.userId, userId),
          eq(shiftAssignments.date, date),
        ),
      )
  ).map((r) => r.shift);
const newNurse = (key: string) =>
  createUser(db, {
    email: `${key}@test.invalid`,
    displayName: `پرستار ${key}`,
  });

/** Everything a refused command must leave untouched. */
const state = async () => ({
  ...(
    await db.execute<Record<string, unknown>>(sql`
      select (select count(*)::int from shift_assignments) as assignments,
             (select count(*)::int from audit_events) as audit,
             (select count(*)::int from schedule_revisions) as revisions,
             (select count(*)::int from schedule_changes) as changes,
             (select sum(revision)::int from schedules) as scheduleRevisions,
             (select string_agg(status::text, ',' order by id) from schedules) as statuses
    `)
  ).rows[0],
  cells: await listAssignments(db, S),
});

async function refusedWithoutWrites(run: () => Promise<ActionResult<unknown>>) {
  const before = await state();
  const error = failure(await run());
  expect(await state()).toEqual(before);
  return error;
}

describe("assigning a candidate to a shortage", () => {
  it("writes the cell, audits it like the editor and bumps the revision by one", async () => {
    const revision = await currentRevision();
    const auditBefore = (await listAuditEventsForSchedule(db, S)).length;
    const result = ok(await assign({ expectedRevision: revision }));
    expect(result).toEqual({
      scheduleId: S,
      revision: revision + 1,
      change: {
        nurseId: U.icuNurse1.id,
        date: DAY,
        before: null,
        after: "N",
      },
    });
    expect(await cellsOf(U.icuNurse1.id)).toEqual(["N"]);
    expect(await currentRevision()).toBe(revision + 1);
    const audit = (await listAuditEventsForSchedule(db, S)).slice(auditBefore);
    expect(audit).toMatchObject([
      {
        actorId: U.icuHead.id,
        action: "assignment.created",
        entityType: "assignment",
        entityId: `${U.icuNurse1.id}:${DAY}`,
        departmentId: DEMO_ICU.id,
        scheduleId: S,
        reason: null,
        data: { date: DAY, nurseId: U.icuNurse1.id, before: null, after: "N" },
      },
    ]);
    // The list read afterwards no longer offers anyone: coverage is met.
    expect(
      (
        await getCoverageCandidates(as(actors.icuHead), {
          scheduleId: S,
          date: DAY,
          shift: "N",
        })
      ).status,
    ).toBe("NO_SHORTAGE");
  });

  it("records exactly what an equivalent planning edit records (same audit, same revision step)", async () => {
    const candidateRevision = await currentRevision();
    ok(await assign({ nurseId: U.icuNurse1.id, shift: "N" }));
    const editorRevision = await currentRevision();
    ok(
      await setAssignments(as(actors.icuHead), {
        scheduleId: S,
        expectedRevision: editorRevision,
        changes: [
          { nurseId: U.icuNurse2.id, date: isoDate("2026-10-26"), shift: "N" },
        ],
      }),
    );
    expect(editorRevision - candidateRevision).toBe(1);
    expect((await currentRevision()) - editorRevision).toBe(1);
    const [candidate, editor] = (await listAuditEventsForSchedule(db, S)).slice(
      -2,
    );
    const shape = (e: typeof candidate) => ({
      actorId: e!.actorId,
      action: e!.action,
      entityType: e!.entityType,
      departmentId: e!.departmentId,
      scheduleId: e!.scheduleId,
      reason: e!.reason,
      dataKeys: Object.keys(e!.data).sort(),
    });
    expect(shape(candidate)).toEqual(shape(editor));
    expect(editor!.data).toEqual({
      date: "2026-10-26",
      nurseId: U.icuNurse2.id,
      before: null,
      after: "N",
    });
  });

  it.each(["M", "E", "N"] as const)(
    "replaces an OFF decision with %s in its own cell",
    async (shift) => {
      await put(U.icuNurse2.id, DAY, "OFF");
      const result = ok(await assign({ nurseId: U.icuNurse2.id, shift }));
      expect(result.change).toEqual({
        nurseId: U.icuNurse2.id,
        date: DAY,
        before: "OFF",
        after: shift,
      });
      // One decision for the day: the OFF row is gone, not kept beside it.
      expect(await cellsOf(U.icuNurse2.id)).toEqual([shift]);
      expect((await listAuditEventsForSchedule(db, S)).at(-1)).toMatchObject({
        action: "assignment.changed",
        data: { before: "OFF", after: shift },
      });
    },
  );

  it.each(["M", "E", "N"] as const)(
    "accepts the coverage period %s as the target",
    async (shift) => {
      expect(ok(await assign({ shift })).change.after).toBe(shift);
    },
  );

  it("adds no past-date restriction of its own", async () => {
    const afterThePeriod = () => new Date("2027-01-15T08:00:00Z");
    ok(await assignAs(actors.icuHead, {}, afterThePeriod));
    expect(await cellsOf(U.icuNurse1.id)).toEqual(["N"]);
  });

  it("never touches the schedule-change machinery (no change record, no revision, no status change)", async () => {
    await setStatus("FINALIZED");
    ok(await assign());
    const after = await state();
    expect(after).toMatchObject({ revisions: 0, changes: 0 });
    expect((await findScheduleById(db, S))!.status).toBe("FINALIZED");
    expect(
      (await listAuditEventsForSchedule(db, S)).map((e) => e.action),
    ).toEqual(["assignment.created"]);
  });
});

describe("input", () => {
  it.each(["ME", "OFF", "X", ""])(
    "rejects %s as a target before reading anything",
    async (shift) => {
      const error = await refusedWithoutWrites(() => assign({ shift }));
      expect(error).toMatchObject({ code: "VALIDATION" });
      expect(error.fieldErrors).toHaveProperty("shift");
    },
  );

  it("rejects a date outside the schedule or not a date", async () => {
    const outside = await refusedWithoutWrites(() =>
      assign({ date: "2026-11-22" }),
    );
    expect(outside).toMatchObject({ code: "VALIDATION" });
    expect(outside.fieldErrors).toHaveProperty("date");
    const malformed = failure(await assign({ date: "25 Aban" }));
    expect(malformed.fieldErrors).toHaveProperty("date");
  });
});

describe("the nurse's target day must still be undecided or OFF", () => {
  it.each(["M", "E", "N", "ME"] as const)(
    "refuses to replace a %s decision",
    async (shift) => {
      await put(U.icuNurse1.id, DAY, shift);
      // Target N: for an N nurse the period is no longer short either, but
      // the day status is checked first and names the real reason.
      const error = await refusedWithoutWrites(() => assign({ shift: "N" }));
      expect(error).toMatchObject({
        code: "CONFLICT",
        reason: "CANDIDATE_ALREADY_WORKING",
      });
      expect(await cellsOf(U.icuNurse1.id)).toEqual([shift]);
    },
  );

  it("refuses a nurse who started working that day after the list was read", async () => {
    const revision = await currentRevision();
    // Another edit after the list: the stale revision alone would refuse,
    // so the fresh one is sent to reach the day-status check.
    ok(
      await setAssignments(as(actors.icuHead), {
        scheduleId: S,
        expectedRevision: revision,
        changes: [{ nurseId: U.icuNurse1.id, date: isoDate(DAY), shift: "E" }],
      }),
    );
    const error = await refusedWithoutWrites(() => assign());
    expect(error.reason).toBe("CANDIDATE_ALREADY_WORKING");
  });
});

describe("the candidate universe is checked again at write time", () => {
  it("refuses an inactive account", async () => {
    await setUserActive(db, U.icuNurse3.id, false);
    const error = await refusedWithoutWrites(() =>
      assign({ nurseId: U.icuNurse3.id }),
    );
    expect(error).toMatchObject({
      code: "CONFLICT",
      reason: "NOT_A_CANDIDATE",
    });
  });

  it("refuses a department member who is not on the roster", async () => {
    const joiner = await newNurse("joiner");
    await addMembership(db, {
      userId: joiner.id,
      departmentId: DEMO_ICU.id,
      role: "NURSE",
      startedOn: isoDate("2026-01-01"),
    });
    const error = await refusedWithoutWrites(() =>
      assign({ nurseId: joiner.id }),
    );
    expect(error.reason).toBe("NOT_A_CANDIDATE");
  });

  it("refuses a rostered nurse whose membership ended before the date", async () => {
    await endMembership(db, {
      userId: U.icuNurse4.id,
      departmentId: DEMO_ICU.id,
      endedOn: isoDate("2026-10-30"),
    });
    const error = await refusedWithoutWrites(() =>
      assign({ nurseId: U.icuNurse4.id, date: "2026-11-05" }),
    );
    expect(error.reason).toBe("NOT_A_CANDIDATE");
    // The last day is inclusive (D19).
    ok(await assign({ nurseId: U.icuNurse4.id, date: "2026-10-30" }));
  });

  it("refuses a rostered nurse whose membership starts after the date", async () => {
    const future = await newNurse("future");
    await addMembership(db, {
      userId: future.id,
      departmentId: DEMO_ICU.id,
      role: "NURSE",
      startedOn: isoDate("2026-11-10"),
    });
    await addToRoster(db, {
      scheduleId: S,
      userId: future.id,
      role: "NURSE",
      addedBy: U.icuHead.id,
    });
    const error = await refusedWithoutWrites(() =>
      assign({ nurseId: future.id, date: "2026-11-05" }),
    );
    expect(error.reason).toBe("NOT_A_CANDIDATE");
  });

  it("refuses a rostered nurse who is a member of another department only", async () => {
    await addToRoster(db, {
      scheduleId: S,
      userId: U.erNurse1.id,
      role: "NURSE",
      addedBy: U.icuHead.id,
    });
    const error = await refusedWithoutWrites(() =>
      assign({ nurseId: U.erNurse1.id }),
    );
    expect(error.reason).toBe("NOT_A_CANDIDATE");
  });

  it("refuses an unknown person", async () => {
    const error = await refusedWithoutWrites(() =>
      assign({ nurseId: "20000000-0000-4000-8000-000000000999" }),
    );
    expect(error.reason).toBe("NOT_A_CANDIDATE");
  });
});

describe("authorization (assignment.edit only)", () => {
  it("refuses a Supervisor even where they may preview the list", async () => {
    await setStatus("FINALIZED");
    expect(
      (
        await getCoverageCandidates(as(actors.supervisor), {
          scheduleId: S,
          date: DAY,
          shift: "N",
        })
      ).status,
    ).toBe("SHORTAGE");
    const error = await refusedWithoutWrites(() => assignAs(actors.supervisor));
    expect(error).toMatchObject({
      code: "FORBIDDEN",
      reason: "NOT_HEAD_NURSE_OF_DEPARTMENT",
    });
  });

  it("refuses a nurse, another department's Head Nurse and a Hospital Admin alone", async () => {
    const admin = await newNurse("admin");
    await db
      .update(users)
      .set({ isHospitalAdmin: true })
      .where(eq(users.id, admin.id));
    const adminActor = (await loadActor(db, admin.id, TODAY))!;
    for (const actor of [actors.icuNurse, actors.erHead, adminActor]) {
      const error = await refusedWithoutWrites(() => assignAs(actor));
      expect(error.code).toBe("FORBIDDEN");
    }
  });

  it("answers an unknown schedule with NOT_FOUND", async () => {
    const result = await assignCoverageCandidate(as(actors.icuHead), {
      scheduleId: "30000000-0000-4000-8000-000000000999",
      nurseId: U.icuNurse1.id,
      date: DAY,
      shift: "N",
      expectedRevision: 0,
    });
    expect(failure(result).code).toBe("NOT_FOUND");
  });
});

describe("editability (canEditAssignment, unchanged)", () => {
  it("refuses SUBMITTED and APPROVED without withdrawing or starting a revision", async () => {
    for (const status of ["SUBMITTED", "APPROVED"] as const) {
      await setStatus(status);
      const error = await refusedWithoutWrites(() => assign());
      expect(error).toMatchObject({
        code: "INVALID_STATE",
        reason: "EDIT_ASSIGNMENT",
      });
      expect((await findScheduleById(db, S))!.status).toBe(status);
    }
  });

  it("assigns inside the open revision's scope and refuses outside it (REVISING)", async () => {
    await startRevision(db, {
      scheduleId: S,
      reason: "test revision",
      startedBy: U.icuHead.id,
      dates: [isoDate(DAY)],
    });
    await setStatus("REVISING");
    const outside = await refusedWithoutWrites(() =>
      assign({ date: "2026-10-26" }),
    );
    expect(outside).toMatchObject({
      code: "INVALID_STATE",
      reason: "EDIT_ASSIGNMENT_OUTSIDE_REVISION_SCOPE",
    });
    ok(await assign());
    expect(await cellsOf(U.icuNurse1.id)).toEqual(["N"]);
  });

  it("treats RETURNED like the editor: whole period first-cycle, scope once revised", async () => {
    await setStatus("RETURNED");
    ok(await assign({ date: "2026-10-26" }));
    await startRevision(db, {
      scheduleId: S,
      reason: "test revision",
      startedBy: U.icuHead.id,
      dates: [isoDate(DAY)],
    });
    const error = await refusedWithoutWrites(() =>
      assign({ nurseId: U.icuNurse2.id, date: "2026-10-27" }),
    );
    expect(error.reason).toBe("EDIT_ASSIGNMENT_OUTSIDE_REVISION_SCOPE");
    ok(await assign({ nurseId: U.icuNurse2.id }));
  });
});

describe("concurrency and stale recommendations", () => {
  it("refuses a stale revision and writes nothing", async () => {
    const read = await currentRevision();
    ok(
      await setAssignments(as(actors.icuHead), {
        scheduleId: S,
        expectedRevision: read,
        changes: [
          { nurseId: U.icuNurse2.id, date: isoDate("2026-10-26"), shift: "E" },
        ],
      }),
    );
    const error = await refusedWithoutWrites(() =>
      assign({ expectedRevision: read }),
    );
    expect(error.code).toBe("CONFLICT");
    expect(error.reason).toBeUndefined();
    expect(await cellsOf(U.icuNurse1.id)).toEqual([]);
  });

  it("refuses once the shortage was resolved, even with the current revision", async () => {
    const list = await getCoverageCandidates(as(actors.icuHead), {
      scheduleId: S,
      date: DAY,
      shift: "N",
    });
    expect(list).toMatchObject({ status: "SHORTAGE", coverage: { gap: 1 } });
    // Someone else fills the Night; the list is re-read only for its revision.
    ok(
      await setAssignments(as(actors.icuHead), {
        scheduleId: S,
        expectedRevision: list.revision,
        changes: [{ nurseId: U.icuNurse2.id, date: isoDate(DAY), shift: "N" }],
      }),
    );
    const error = await refusedWithoutWrites(() =>
      assign({ expectedRevision: list.revision + 1 }),
    );
    expect(error).toMatchObject({ code: "CONFLICT", reason: "NO_SHORTAGE" });
  });

  it("refuses when the period has no minimum", async () => {
    const version = await publishTestRuleSet(db, {
      departmentId: DEMO_ICU.id,
      content: ruleContent({ min: 0, max: null }),
      createdBy: U.icuHead.id,
    });
    await pinTestRuleSet(db, S, version);
    const error = await refusedWithoutWrites(() => assign());
    expect(error.reason).toBe("NO_SHORTAGE");
  });

  it("refuses when coverage is already at the minimum (ME counts toward M)", async () => {
    await put(U.icuNurse2.id, DAY, "ME");
    const error = await refusedWithoutWrites(() => assign({ shift: "M" }));
    expect(error.reason).toBe("NO_SHORTAGE");
  });

  it("does not re-check preferences: a changed, OFF or missing wish never blocks", async () => {
    const read = await currentRevision();
    await prefer(U.icuNurse1.id, DAY, "N");
    // Preferences do not bump the schedule revision (D36): the list is not stale.
    await prefer(U.icuNurse1.id, DAY, "OFF");
    expect(await currentRevision()).toBe(read);
    ok(await assign({ expectedRevision: read, shift: "N" }));
    // No preference at all.
    ok(await assign({ nurseId: U.icuNurse2.id, shift: "M" }));
  });
});

describe("hard rules at write time (the shared assessEdits)", () => {
  it("refuses a same-month night-rest violation with the structured finding, writing nothing", async () => {
    await put(U.icuNurse1.id, "2026-10-24", "N");
    const error = await refusedWithoutWrites(() => assign({ shift: "M" }));
    expect(error).toMatchObject({ code: "RULE_VIOLATION" });
    expect(error.violations).toEqual([
      {
        rule: "NIGHT_REST",
        severity: "error",
        nurseId: U.icuNurse1.id,
        nightDate: "2026-10-24",
        date: DAY,
        shift: "M",
      },
    ]);
  });

  it("refuses after the previous schedule's last-day Night, for a nurse with no shift this month", async () => {
    const previous = await createSchedule(db, {
      departmentId: DEMO_ICU.id,
      period: { start: isoDate("2026-09-23"), end: isoDate("2026-10-22") },
      label: "مهر ۱۴۰۵",
      createdBy: U.icuHead.id,
    });
    await snapshotRosterFromMemberships(db, {
      scheduleId: previous.id,
      addedBy: U.icuHead.id,
    });
    await put(U.icuNurse2.id, "2026-10-22", "N", previous.id);
    expect(
      (await listAssignments(db, S)).filter(
        (a) => a.nurseId === U.icuNurse2.id,
      ),
    ).toEqual([]);
    const error = await refusedWithoutWrites(() =>
      assign({ nurseId: U.icuNurse2.id, date: "2026-10-23", shift: "M" }),
    );
    expect(error.violations).toMatchObject([
      { rule: "NIGHT_REST", nightDate: "2026-10-22", date: "2026-10-23" },
    ]);
  });

  it("refuses a last-day Night before the next schedule's first-day shift", async () => {
    const next = await createSchedule(db, {
      departmentId: DEMO_ICU.id,
      period: { start: isoDate("2026-11-22"), end: isoDate("2026-12-21") },
      label: "آذر ۱۴۰۵",
      createdBy: U.icuHead.id,
    });
    await snapshotRosterFromMemberships(db, {
      scheduleId: next.id,
      addedBy: U.icuHead.id,
    });
    await put(U.icuNurse1.id, "2026-11-22", "M", next.id);
    const error = await refusedWithoutWrites(() =>
      assign({ date: "2026-11-21", shift: "N" }),
    );
    expect(error.violations).toMatchObject([
      { rule: "NIGHT_REST", nightDate: "2026-11-21", date: "2026-11-22" },
    ]);
  });

  it("checks the hard rules after the shortage, as a separate gate", async () => {
    // Both refuse: an unshort period is reported as such, never as a rule.
    await put(U.icuNurse1.id, "2026-10-24", "N");
    await put(U.icuNurse2.id, DAY, "N");
    const error = await refusedWithoutWrites(() => assign());
    expect(error).toMatchObject({ code: "CONFLICT", reason: "NO_SHORTAGE" });
  });
});
