import { and, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NotFoundError } from "../../src/application/errors";
import {
  getCoverageCandidates,
  type CoverageCandidates,
} from "../../src/application/schedules/coverage-candidates";
import { previewScheduleAdjustment } from "../../src/application/schedules/schedule-changes";
import { loadWorkingCopy } from "../../src/application/schedules/working-copy-validation";
import type { AppContext } from "../../src/application/use-case";
import type { Actor } from "../../src/domain/authz/actor";
import type { ScheduleStatus } from "../../src/domain/schedule/status";
import { addDays, isoDate } from "../../src/domain/shared/dates";
import { ValidationError } from "../../src/domain/shared/errors";
import type {
  AssignmentCode,
  PreferenceValue,
} from "../../src/domain/shifts/shift-type";
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
import {
  listAssignments,
  setAssignment,
} from "../../src/infrastructure/repositories/assignments";
import { createDepartment } from "../../src/infrastructure/repositories/departments";
import {
  addMembership,
  endMembership,
  listActiveMembers,
  loadActor,
} from "../../src/infrastructure/repositories/memberships";
import { setPreference } from "../../src/infrastructure/repositories/preferences";
import { startRevision } from "../../src/infrastructure/repositories/revisions";
import {
  addToRoster,
  isOnRoster,
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

const { db, pool } = setupTestDatabase();
const U = DEMO_USERS;
// ICU, Aban 1405: 2026-10-23 .. 2026-11-21, DRAFT, pinned to the legacy
// baseline (M, E and N minimum 1, no maximum): every empty period is short.
const S = DEMO_SCHEDULE.id;
const TODAY = isoDate("2026-10-01");
const DAY = "2026-10-25";
// The seeded roster: the ICU Head Nurse, four ICU nurses and the nurse who
// transferred from ER on 2026-09-23 (demo ids sort in this order).
const ROSTER = [
  U.icuHead.id,
  U.icuNurse1.id,
  U.icuNurse2.id,
  U.icuNurse3.id,
  U.icuNurse4.id,
  U.transferNurse.id,
];

const actors = {} as Record<
  "icuHead" | "erHead" | "icuNurse" | "supervisor",
  Actor
>;
const as = (actor: Actor, clock?: () => Date): AppContext => ({
  db,
  actor,
  clock,
});

beforeEach(async () => {
  actors.icuHead = (await loadActor(db, U.icuHead.id, TODAY))!;
  actors.erHead = (await loadActor(db, U.erHead.id, TODAY))!;
  actors.icuNurse = (await loadActor(db, U.icuNurse1.id, TODAY))!;
  actors.supervisor = (await loadActor(db, U.supervisor.id, TODAY))!;
});

const query = (
  actor: Actor,
  input: { date?: string; shift?: string; scheduleId?: string } = {},
  clock?: () => Date,
) =>
  getCoverageCandidates(as(actor, clock), {
    scheduleId: input.scheduleId ?? S,
    date: input.date ?? DAY,
    shift: input.shift ?? "N",
  });

type Shortage = Extract<CoverageCandidates, { status: "SHORTAGE" }>;
async function shortage(
  actor: Actor,
  input: Parameters<typeof query>[1] = {},
  clock?: () => Date,
): Promise<Shortage> {
  const result = await query(actor, input, clock);
  if (result.status !== "SHORTAGE")
    throw new Error(`expected a shortage, got ${JSON.stringify(result)}`);
  return result;
}

const assign = (
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
const setStatus = (status: ScheduleStatus, scheduleId = S) =>
  db.update(schedules).set({ status }).where(eq(schedules.id, scheduleId));
const everyone = (result: Shortage) => [
  ...result.available.map((c) => c.userId),
  ...result.notAllowed.map((c) => c.userId),
];
const newNurse = (key: string, isActive = true) =>
  createUser(db, {
    email: `${key}@test.invalid`,
    displayName: `پرستار ${key}`,
    isActive,
  });

const tableCounts = async () =>
  (
    await db.execute<Record<string, number>>(sql`
      select (select count(*)::int from shift_assignments) as assignments,
             (select count(*)::int from schedule_roster) as roster,
             (select count(*)::int from department_memberships) as memberships,
             (select count(*)::int from schedule_revisions) as revisions,
             (select count(*)::int from audit_events) as audit,
             (select sum(revision)::int from schedules) as scheduleRevisions,
             (select string_agg(status::text, ',' order by id) from schedules) as statuses
    `)
  ).rows[0];

describe("a real shortage in the Head Nurse's own department", () => {
  it("lists the roster members who could fill it, with the coverage, and writes nothing", async () => {
    const before = await tableCounts();
    const result = await shortage(actors.icuHead);
    expect(result).toMatchObject({
      status: "SHORTAGE",
      scheduleId: S,
      revision: (await findScheduleById(db, S))!.revision,
      date: DAY,
      shift: "N",
      coverage: {
        period: "N",
        covered: 0,
        bounds: { min: 1 },
        status: "BELOW_MINIMUM",
        gap: 1,
      },
      canAssign: true,
      assignDenial: null,
      notAllowed: [],
    });
    expect(result.available.map((c) => c.userId)).toEqual(ROSTER);
    expect(result.available[1]).toEqual({
      userId: U.icuNurse1.id,
      displayName: U.icuNurse1.displayName,
      personnelNumber: U.icuNurse1.personnelNumber,
      dayStatus: "UNASSIGNED",
      preference: "NONE",
      requiresOffReplacement: false,
    });
    expect(await tableCounts()).toEqual(before);
  });
});

describe("candidate universe: roster ∩ active account ∩ membership on the date", () => {
  it("leaves out an active department member who is not on the schedule's roster", async () => {
    const joiner = await newNurse("joiner");
    await addMembership(db, {
      userId: joiner.id,
      departmentId: DEMO_ICU.id,
      role: "NURSE",
      startedOn: isoDate("2026-01-01"),
    });
    const members = await listActiveMembers(db, DEMO_ICU.id, isoDate(DAY));
    expect(members.map((m) => m.userId)).toContain(joiner.id);
    expect(await isOnRoster(db, S, joiner.id)).toBe(false);
    expect(everyone(await shortage(actors.icuHead))).toEqual(ROSTER);
  });

  it("leaves out a rostered nurse whose membership ended before the date", async () => {
    await endMembership(db, {
      userId: U.icuNurse4.id,
      departmentId: DEMO_ICU.id,
      endedOn: isoDate("2026-10-30"),
    });
    expect(
      everyone(await shortage(actors.icuHead, { date: "2026-10-30" })),
    ).toContain(U.icuNurse4.id); // the last day is inclusive (D19)
    expect(
      everyone(await shortage(actors.icuHead, { date: "2026-11-05" })),
    ).toEqual(ROSTER.filter((id) => id !== U.icuNurse4.id));
  });

  it("leaves out a rostered nurse whose membership starts after the date", async () => {
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
    expect(
      everyone(await shortage(actors.icuHead, { date: "2026-11-05" })),
    ).not.toContain(future.id);
    expect(
      everyone(await shortage(actors.icuHead, { date: "2026-11-10" })),
    ).toContain(future.id);
  });

  it("leaves out a rostered nurse whose account is inactive", async () => {
    await setUserActive(db, U.icuNurse3.id, false);
    expect(everyone(await shortage(actors.icuHead))).toEqual(
      ROSTER.filter((id) => id !== U.icuNurse3.id),
    );
  });

  it("leaves out a rostered nurse who is a member of another department only", async () => {
    // Test data: an ER nurse on the ICU roster, with no ICU membership.
    await addToRoster(db, {
      scheduleId: S,
      userId: U.erNurse1.id,
      role: "NURSE",
      addedBy: U.icuHead.id,
    });
    const result = await shortage(actors.icuHead);
    expect(everyone(result)).toEqual(ROSTER);
    for (const id of [U.erNurse1.id, U.erNurse2.id, U.erHead.id])
      expect(everyone(result)).not.toContain(id);
  });
});

describe("day status, preferences and ordering (the domain's, preserved)", () => {
  it("omits nurses already working that day from both groups", async () => {
    await assign(U.icuNurse1.id, DAY, "E");
    await assign(U.icuNurse3.id, DAY, "ME");
    await assign(U.icuNurse4.id, DAY, "M");
    const result = await shortage(actors.icuHead);
    expect(everyone(result)).toEqual([
      U.icuHead.id,
      U.icuNurse2.id,
      U.transferNurse.id,
    ]);
  });

  it("offers a nurse with an explicit OFF, flagged for replacement", async () => {
    await assign(U.icuNurse2.id, DAY, "OFF");
    const result = await shortage(actors.icuHead);
    expect(result.available.at(-1)).toMatchObject({
      userId: U.icuNurse2.id,
      dayStatus: "OFF_ASSIGNMENT",
      requiresOffReplacement: true,
    });
  });

  it("reads the target day's preferences and keeps the domain order after mapping", async () => {
    await assign(U.icuNurse2.id, DAY, "OFF");
    await prefer(U.icuNurse2.id, DAY, "N"); // OFF decision, same wish
    await prefer(U.icuNurse1.id, DAY, "N"); // same wish
    await prefer(U.icuNurse3.id, DAY, "ME"); // a different shift
    await prefer(U.transferNurse.id, DAY, "E"); // a different shift
    await prefer(U.icuNurse4.id, DAY, "OFF"); // a rest wish
    await prefer(U.icuHead.id, "2026-10-26", "N"); // another day: no preference today
    const result = await shortage(actors.icuHead);
    expect(
      result.available.map((c) => [c.userId, c.dayStatus, c.preference]),
    ).toEqual([
      [U.icuNurse1.id, "UNASSIGNED", "SAME_SHIFT"],
      [U.icuHead.id, "UNASSIGNED", "NONE"],
      [U.icuNurse3.id, "UNASSIGNED", "DIFFERENT_SHIFT"],
      [U.transferNurse.id, "UNASSIGNED", "DIFFERENT_SHIFT"],
      [U.icuNurse4.id, "UNASSIGNED", "OFF_PREFERENCE"],
      [U.icuNurse2.id, "OFF_ASSIGNMENT", "SAME_SHIFT"],
    ]);
  });
});

describe("hard rules (the shared assessment, with real context)", () => {
  it("lists a night-rest violation under Not Allowed with the structured finding", async () => {
    await assign(U.icuNurse1.id, "2026-10-24", "N");
    const result = await shortage(actors.icuHead);
    expect(result.available.map((c) => c.userId)).not.toContain(U.icuNurse1.id);
    expect(result.notAllowed).toEqual([
      {
        userId: U.icuNurse1.id,
        displayName: U.icuNurse1.displayName,
        personnelNumber: U.icuNurse1.personnelNumber,
        dayStatus: "UNASSIGNED",
        preference: "NONE",
        findings: [
          {
            code: "NIGHT_REST",
            scope: "NURSE",
            severity: "error",
            blocking: true,
            date: DAY,
            dates: ["2026-10-24", DAY],
            nurseIds: [U.icuNurse1.id],
            shift: "N",
            violation: {
              rule: "NIGHT_REST",
              severity: "error",
              nurseId: U.icuNurse1.id,
              nightDate: "2026-10-24",
              date: DAY,
              shift: "N",
            },
            nurses: [
              { userId: U.icuNurse1.id, displayName: U.icuNurse1.displayName },
            ],
          },
        ],
      },
    ]);
  });

  it("sees the previous schedule's last-day Night for a nurse with no shift this month (D20)", async () => {
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
    await assign(U.icuNurse2.id, "2026-10-22", "N", previous.id);
    // The trap: nurse 2 has no shift in this schedule, so the review's
    // working-copy load (boundary days only for nurses with shifts here)
    // does not carry that Night. The candidate query must.
    expect(
      (await listAssignments(db, S)).filter(
        (a) => a.nurseId === U.icuNurse2.id,
      ),
    ).toEqual([]);
    const reviewLoad = await loadWorkingCopy(
      db,
      (await findScheduleById(db, S))!,
      { listOfficialHolidays: async () => [] },
    );
    expect(reviewLoad.adjacent).toEqual([]);

    const result = await shortage(actors.icuHead, {
      date: "2026-10-23",
      shift: "M",
    });
    expect(result.notAllowed).toMatchObject([
      {
        userId: U.icuNurse2.id,
        findings: [
          {
            code: "NIGHT_REST",
            violation: {
              nightDate: "2026-10-22",
              date: "2026-10-23",
              shift: "M",
            },
          },
        ],
      },
    ]);
    expect(result.available.map((c) => c.userId)).toEqual(
      ROSTER.filter((id) => id !== U.icuNurse2.id),
    );
  });

  it("sees the next schedule's first-day shift after a last-day Night (D20)", async () => {
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
    await assign(U.icuNurse1.id, "2026-11-22", "M", next.id);
    await assign(U.icuNurse3.id, "2026-11-22", "OFF", next.id);
    const result = await shortage(actors.icuHead, { date: "2026-11-21" });
    expect(result.notAllowed).toMatchObject([
      {
        userId: U.icuNurse1.id,
        findings: [
          {
            code: "NIGHT_REST",
            violation: { nightDate: "2026-11-21", date: "2026-11-22" },
          },
        ],
      },
    ]);
    expect(result.available.map((c) => c.userId)).toContain(U.icuNurse3.id);
  });

  it("blocks exactly what the existing change assessment blocks for the same cell", async () => {
    await assign(U.icuNurse1.id, "2026-10-24", "N");
    await assign(U.icuNurse1.id, "2026-10-26", "M");
    await setStatus("FINALIZED");
    const result = await shortage(actors.icuHead);
    const preview = await previewScheduleAdjustment(
      as(actors.icuHead, () => new Date("2026-10-01T08:00:00Z")),
      {
        scheduleId: S,
        changes: [{ nurseId: U.icuNurse1.id, date: isoDate(DAY), shift: "N" }],
      },
    );
    expect(preview.ok).toBe(true);
    const blocking = preview.ok ? preview.evaluation.assessment.blocking : [];
    expect(blocking.map((v) => v.rule)).toEqual(["NIGHT_REST", "NIGHT_REST"]);
    expect(result.notAllowed[0]!.findings.map((f) => f.violation)).toEqual(
      blocking,
    );
  });

  it("uses the pinned bounds: filling up to a maximum is allowed", async () => {
    const version = await publishTestRuleSet(db, {
      departmentId: DEMO_ICU.id,
      content: ruleContent({ min: 2, max: 2 }),
      createdBy: U.icuHead.id,
    });
    await pinTestRuleSet(db, S, version);
    await assign(U.icuNurse1.id, DAY, "N");
    const result = await shortage(actors.icuHead);
    expect(result.coverage).toEqual({
      period: "N",
      covered: 1,
      bounds: { min: 2, max: 2 },
      status: "BELOW_MINIMUM",
      gap: 1,
    });
    expect(result.notAllowed).toEqual([]);
    expect(result.available).toHaveLength(ROSTER.length - 1);
  });
});

describe("authorization (schedule.viewDepartment, D12)", () => {
  it("lets a Supervisor preview from FINALIZED on, never assign", async () => {
    for (const status of [
      "FINALIZED",
      "SUBMITTED",
      "RETURNED",
      "APPROVED",
      "REVISING",
    ] as const) {
      await setStatus(status);
      const result = await shortage(actors.supervisor);
      expect(result).toMatchObject({
        canAssign: false,
        assignDenial: "NOT_AUTHORIZED",
      });
      expect(result.available.length).toBeGreaterThan(0);
    }
  });

  it("hides DRAFT and PLANNING schedules from a Supervisor", async () => {
    for (const status of ["DRAFT", "PLANNING"] as const) {
      await setStatus(status);
      await expect(query(actors.supervisor)).rejects.toBeInstanceOf(
        NotFoundError,
      );
    }
  });

  it("refuses a nurse, another department's Head Nurse and a Hospital Admin alone", async () => {
    const admin = await newNurse("admin");
    await db
      .update(users)
      .set({ isHospitalAdmin: true })
      .where(eq(users.id, admin.id));
    const adminActor = (await loadActor(db, admin.id, TODAY))!;
    expect(adminActor.isHospitalAdmin).toBe(true);
    await setStatus("FINALIZED");
    for (const actor of [actors.icuNurse, actors.erHead, adminActor])
      await expect(query(actor)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("follows the Head Nurse role of an admin who also leads the department (D78)", async () => {
    await db
      .update(users)
      .set({ isHospitalAdmin: true })
      .where(eq(users.id, U.icuHead.id));
    const both = (await loadActor(db, U.icuHead.id, TODAY))!;
    expect((await shortage(both)).canAssign).toBe(true);
  });

  it("answers an unknown or malformed schedule id with NotFoundError", async () => {
    for (const scheduleId of [
      "not-a-uuid",
      "30000000-0000-4000-8000-000000000999",
    ])
      await expect(
        query(actors.icuHead, { scheduleId }),
      ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("canAssign (assignment.edit and canEditAssignment)", () => {
  it("is true for the Head Nurse on an editable day", async () => {
    for (const status of ["DRAFT", "PLANNING", "FINALIZED"] as const) {
      await setStatus(status);
      expect(await shortage(actors.icuHead)).toMatchObject({
        canAssign: true,
        assignDenial: null,
      });
    }
  });

  it("is false while SUBMITTED or APPROVED, the list still previewable", async () => {
    for (const status of ["SUBMITTED", "APPROVED"] as const) {
      await setStatus(status);
      const result = await shortage(actors.icuHead);
      expect(result).toMatchObject({
        canAssign: false,
        assignDenial: "SCHEDULE_LOCKED",
      });
      expect(result.available.length).toBeGreaterThan(0);
    }
  });

  it("follows the open revision's scope (D14)", async () => {
    await startRevision(db, {
      scheduleId: S,
      reason: "test revision",
      startedBy: U.icuHead.id,
      dates: [isoDate(DAY)],
    });
    for (const status of ["REVISING", "RETURNED"] as const) {
      await setStatus(status);
      expect(await shortage(actors.icuHead)).toMatchObject({
        canAssign: true,
      });
      expect(
        await shortage(actors.icuHead, { date: "2026-10-26" }),
      ).toMatchObject({
        canAssign: false,
        assignDenial: "DATE_OUTSIDE_REVISION_SCOPE",
      });
    }
  });

  it("adds no past-date restriction of its own", async () => {
    const afterThePeriod = () => new Date("2027-01-15T08:00:00Z");
    expect(await shortage(actors.icuHead, {}, afterThePeriod)).toMatchObject({
      canAssign: true,
    });
  });
});

describe("entry condition: a real BELOW_MINIMUM shortage (D111)", () => {
  it("is not offered when the period has no minimum", async () => {
    const version = await publishTestRuleSet(db, {
      departmentId: DEMO_ICU.id,
      content: ruleContent({ min: 0, max: null }),
      createdBy: U.icuHead.id,
    });
    await pinTestRuleSet(db, S, version);
    const result = await query(actors.icuHead);
    expect(result).toEqual({
      status: "NO_SHORTAGE",
      scheduleId: S,
      revision: expect.any(Number),
      date: DAY,
      shift: "N",
      coverage: {
        period: "N",
        covered: 0,
        bounds: { min: 0 },
        status: "WITHIN_BOUNDS",
        gap: 0,
      },
    });
  });

  it("is not offered once the minimum is met, ME counting toward M and E (D42)", async () => {
    await assign(U.icuNurse1.id, DAY, "N");
    await assign(U.icuNurse2.id, DAY, "ME");
    for (const shift of ["N", "M", "E"])
      expect(await query(actors.icuHead, { shift })).toMatchObject({
        status: "NO_SHORTAGE",
        shift,
        coverage: { covered: 1, status: "WITHIN_BOUNDS", gap: 0 },
      });
  });

  it.each(["M", "E", "N"] as const)(
    "evaluates a %s shortage with the target shift %s only",
    async (shift) => {
      await prefer(U.icuNurse1.id, DAY, shift);
      await prefer(U.icuNurse2.id, DAY, "ME");
      const result = await shortage(actors.icuHead, { shift });
      expect(result).toMatchObject({ shift, coverage: { period: shift } });
      expect(
        result.available.find((c) => c.userId === U.icuNurse1.id)!.preference,
      ).toBe("SAME_SHIFT");
      expect(
        result.available.find((c) => c.userId === U.icuNurse2.id)!.preference,
      ).toBe("DIFFERENT_SHIFT");
    },
  );

  it.each(["ME", "OFF", "X"])("rejects %s as a target", async (shift) => {
    const error = await query(actors.icuHead, { shift }).catch((e) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect(error).toMatchObject({ field: "shift" });
  });

  it("rejects a date outside the period or not a date", async () => {
    for (const date of ["2026-11-22", "1405-08-03", "tomorrow"]) {
      const error = await query(actors.icuHead, { date }).catch((e) => e);
      expect(error).toMatchObject({ code: "VALIDATION", field: "date" });
    }
  });
});

describe("performance", () => {
  /** A department of `size` nurses with a 31-day month assigned except the target day's Nights. */
  async function largeDepartment(size: number) {
    const department = await createDepartment(db, {
      code: `cand-${size}`,
      name: `بخش ${size} نفره`,
    });
    const people = await db
      .insert(users)
      .values(
        Array.from({ length: size }, (_, i) => ({
          email: `cand${size}.${i}@test.invalid`,
          displayName: `پرستار ${i}`,
        })),
      )
      .returning({ id: users.id });
    await db.insert(departmentMemberships).values(
      people.map((p, i) => ({
        userId: p.id,
        departmentId: department.id,
        role: i === 0 ? ("HEAD_NURSE" as const) : ("NURSE" as const),
        startedOn: "2026-01-01",
      })),
    );
    const period = { start: isoDate("2027-03-21"), end: isoDate("2027-04-20") };
    const schedule = await createSchedule(db, {
      departmentId: department.id,
      period,
      label: "فروردین ۱۴۰۶",
      createdBy: people[0]!.id,
    });
    await snapshotRosterFromMemberships(db, {
      scheduleId: schedule.id,
      addedBy: people[0]!.id,
    });
    const target = isoDate("2027-04-01");
    const pattern: AssignmentCode[] = ["M", "E", "ME", "N", "OFF"];
    await db.insert(shiftAssignments).values(
      people.flatMap((p, i) =>
        Array.from({ length: 31 }, (_, d) => {
          const date = addDays(period.start, d);
          const shift = pattern[(i + d) % pattern.length]!;
          return {
            scheduleId: schedule.id,
            userId: p.id,
            date,
            // The target day's Nights are left open: a Night shortage.
            shiftCode: date === target && shift === "N" ? "OFF" : shift,
            updatedBy: people[0]!.id,
          };
        }),
      ),
    );
    const head = (await loadActor(db, people[0]!.id, TODAY))!;
    return { schedule, head, target };
  }

  it("uses a constant number of statements whatever the roster size (6 vs 60, no N+1)", async () => {
    const small = await largeDepartment(6);
    const large = await largeDepartment(60);

    const statementsFor = async (
      d: Awaited<ReturnType<typeof largeDepartment>>,
    ) => {
      const spy = vi.spyOn(pool, "query");
      const result = await shortage(d.head, {
        scheduleId: d.schedule.id,
        date: d.target,
        shift: "N",
      });
      const count = spy.mock.calls.length;
      spy.mockRestore();
      return { count, result };
    };

    const few = await statementsFor(small);
    const many = await statementsFor(large);
    // Both groups are populated: OFF candidates and Night-before candidates.
    expect(many.result.available.length).toBeGreaterThan(5);
    expect(many.result.notAllowed.length).toBeGreaterThan(5);
    expect(many.count).toBe(few.count);
    // Schedule; working copy; pinned rule set (version, day-type bounds,
    // date exceptions); universe with names; the day's preferences; the
    // boundary days. No per-nurse statement.
    expect(many.count).toBe(8);
  });

  it("adds only the open revision's two statements in a revision-scoped status", async () => {
    await startRevision(db, {
      scheduleId: S,
      reason: "test revision",
      startedBy: U.icuHead.id,
      dates: [isoDate(DAY)],
    });
    await setStatus("REVISING");
    const spy = vi.spyOn(pool, "query");
    await shortage(actors.icuHead);
    const count = spy.mock.calls.length;
    spy.mockRestore();
    expect(count).toBe(10);
  });

  it("stops after the coverage check when there is no shortage", async () => {
    await assign(U.icuNurse1.id, DAY, "N");
    const spy = vi.spyOn(pool, "query");
    const result = await query(actors.icuHead);
    const count = spy.mock.calls.length;
    spy.mockRestore();
    expect(result.status).toBe("NO_SHORTAGE");
    // Schedule, working copy and pinned rule set only.
    expect(count).toBe(5);
  });
});

// Keeps the cross-department fixture honest: ER nurses are ER members only.
it("seeds ER nurses without an ICU membership", async () => {
  const rows = await db
    .select({ departmentId: departmentMemberships.departmentId })
    .from(departmentMemberships)
    .where(
      and(
        eq(departmentMemberships.userId, U.erNurse1.id),
        eq(departmentMemberships.departmentId, DEMO_ICU.id),
      ),
    );
  expect(rows).toEqual([]);
});
