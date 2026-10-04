import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HolidayCalendar } from "../../src/application/calendar/holidays";
import { NotFoundError } from "../../src/application/errors";
import { getDepartmentSchedules } from "../../src/application/schedules/queries";
import { getScheduleReview } from "../../src/application/schedules/review";
import type { StaffingRequirementsSource } from "../../src/application/schedules/staffing-requirements";
import type { AppContext } from "../../src/application/use-case";
import type { Actor } from "../../src/domain/authz/actor";
import {
  conflictsWithPreference,
  summarizePreferenceAlignment,
} from "../../src/domain/preferences/preference-alignment";
import { addDays, isoDate, type IsoDate } from "../../src/domain/shared/dates";
import type { ShiftCode } from "../../src/domain/shifts/shift-type";
import {
  departmentMemberships,
  scheduleRoster,
  schedules,
  shiftAssignments,
  users,
} from "../../src/infrastructure/db/schema";
import {
  DEMO_ER,
  DEMO_ICU,
  DEMO_SCHEDULE,
  DEMO_USERS,
} from "../../src/infrastructure/db/seed/demo-data";
import { setAssignment } from "../../src/infrastructure/repositories/assignments";
import { createDepartment } from "../../src/infrastructure/repositories/departments";
import { loadActor } from "../../src/infrastructure/repositories/memberships";
import { setPreference } from "../../src/infrastructure/repositories/preferences";
import { snapshotRosterFromMemberships } from "../../src/infrastructure/repositories/roster";
import { createSchedule } from "../../src/infrastructure/repositories/schedules";
import { setUserActive } from "../../src/infrastructure/repositories/users";
import { setupTestDatabase } from "./support/database";

const { db, pool } = setupTestDatabase();
const U = DEMO_USERS;
const S = DEMO_SCHEDULE.id; // ICU, Aban 1405: 2026-10-23 .. 2026-11-21, DRAFT
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

const assign = (
  userId: string,
  date: string,
  shift: ShiftCode,
  scheduleId = S,
) =>
  setAssignment(db, {
    scheduleId,
    userId,
    date: isoDate(date),
    shift,
    updatedBy: U.icuHead.id,
  });

const review = (
  actor: Actor,
  input: { day?: string; scheduleId?: string; departmentId?: string } = {},
  sources?: Parameters<typeof getScheduleReview>[2],
) =>
  getScheduleReview(
    as(actor),
    {
      departmentId: input.departmentId ?? DEMO_ICU.id,
      scheduleId: input.scheduleId ?? S,
      day: input.day,
    },
    sources,
  );

const setStatus = (status: "FINALIZED" | "PLANNING") =>
  db.update(schedules).set({ status }).where(eq(schedules.id, S));

const tableCounts = async () =>
  (
    await db.execute<Record<string, number>>(sql`
      select (select count(*)::int from shift_assignments) as assignments,
             (select count(*)::int from audit_events) as audit,
             (select count(*)::int from notifications) as notifications,
             (select sum(revision)::int from schedules) as revisions,
             (select count(*)::int from nurse_preferences) as preferences
    `)
  ).rows[0];

describe("month overview", () => {
  it("shows every day of the period as unplanned before anything is assigned", async () => {
    const { month, day } = await review(actors.icuHead);
    expect(month).toMatchObject({
      scheduleId: S,
      period: { start: "2026-10-23", end: "2026-11-21" },
      label: "آبان ۱۴۰۵",
      status: "DRAFT",
      totals: { UNPLANNED: 30, VALID: 0, NEEDS_ATTENTION: 0 },
      unattributedFindings: 0,
    });
    expect(month.days).toHaveLength(30);
    expect(month.days[0]!.date).toBe("2026-10-23");
    expect(month.days.at(-1)!.date).toBe("2026-11-21");
    expect(day).toBeNull();
  });

  it("aggregates per day: assignment types, coverage (ME counts for M and E) and health", async () => {
    await assign(U.icuNurse1.id, "2026-10-24", "M");
    await assign(U.icuNurse2.id, "2026-10-24", "ME");
    await assign(U.icuNurse3.id, "2026-10-24", "N");
    // Night-rest: N on the 25th, then M on the 26th.
    await assign(U.icuNurse4.id, "2026-10-25", "N");
    await assign(U.icuNurse4.id, "2026-10-26", "M");

    const { month } = await review(actors.icuHead);
    const byDate = new Map(month.days.map((d) => [d.date, d]));
    expect(byDate.get(isoDate("2026-10-24"))).toMatchObject({
      health: "VALID",
      shifts: { M: 1, E: 0, N: 1, ME: 1 },
      coverage: { M: 2, E: 1, N: 1 },
      findings: { blocking: 0, other: 0 },
      holiday: null,
    });
    expect(byDate.get(isoDate("2026-10-25"))!.health).toBe("VALID");
    expect(byDate.get(isoDate("2026-10-26"))).toMatchObject({
      health: "NEEDS_ATTENTION",
      findings: { blocking: 1, other: 0 },
    });
    expect(month.totals).toEqual({
      UNPLANNED: 27,
      VALID: 2,
      NEEDS_ATTENTION: 1,
    });
  });

  it("applies night-rest across the boundary with the previous schedule (D7, D20)", async () => {
    const mehr = await createSchedule(db, {
      departmentId: DEMO_ICU.id,
      period: { start: isoDate("2026-09-23"), end: isoDate("2026-10-22") },
      label: "مهر ۱۴۰۵",
      createdBy: U.icuHead.id,
    });
    await snapshotRosterFromMemberships(db, {
      scheduleId: mehr.id,
      addedBy: U.icuHead.id,
    });
    await assign(U.icuNurse1.id, "2026-10-22", "N", mehr.id);
    await assign(U.icuNurse1.id, "2026-10-23", "E");

    const { month, day } = await review(actors.icuHead, { day: "2026-10-23" });
    expect(month.days[0]).toMatchObject({
      health: "NEEDS_ATTENTION",
      findings: { blocking: 1, other: 0 },
    });
    expect(day!.findings).toEqual([
      expect.objectContaining({
        code: "NIGHT_REST",
        scope: "NURSE",
        blocking: true,
        date: "2026-10-23",
        dates: ["2026-10-22", "2026-10-23"],
        shift: "E",
        nurses: [
          { userId: U.icuNurse1.id, displayName: U.icuNurse1.displayName },
        ],
      }),
    ]);
  });

  it("attributes a night on the last day followed by the next schedule's first day to the last day", async () => {
    const azar = await createSchedule(db, {
      departmentId: DEMO_ICU.id,
      period: { start: isoDate("2026-11-22"), end: isoDate("2026-12-21") },
      label: "آذر ۱۴۰۵",
      createdBy: U.icuHead.id,
    });
    await snapshotRosterFromMemberships(db, {
      scheduleId: azar.id,
      addedBy: U.icuHead.id,
    });
    await assign(U.icuNurse2.id, "2026-11-21", "N");
    await assign(U.icuNurse2.id, "2026-11-22", "M", azar.id);

    const { month } = await review(actors.icuHead);
    expect(month.days.at(-1)).toMatchObject({
      date: "2026-11-21",
      health: "NEEDS_ATTENTION",
    });
  });

  it("marks official holidays from the calendar source independently of health", async () => {
    await assign(U.icuNurse1.id, "2026-10-24", "M");
    const holidays: HolidayCalendar = {
      listOfficialHolidays: async () => [
        { date: isoDate("2026-10-24"), name: "تعطیل آزمایشی" },
        { date: isoDate("2026-10-30"), name: "تعطیل دوم" },
        // Outside the period: ignored.
        { date: isoDate("2026-12-30"), name: "بیرون از دوره" },
      ],
    };
    const { month } = await review(actors.icuHead, {}, { holidays });
    const holidayDays = month.days.filter((d) => d.holiday);
    expect(holidayDays.map((d) => [d.date, d.health, d.holiday!.name])).toEqual(
      [
        ["2026-10-24", "VALID", "تعطیل آزمایشی"],
        ["2026-10-30", "UNPLANNED", "تعطیل دوم"],
      ],
    );
  });
});

describe("day detail", () => {
  beforeEach(async () => {
    await assign(U.icuHead.id, "2026-10-28", "ME");
    await assign(U.icuNurse1.id, "2026-10-28", "M");
    await assign(U.icuNurse2.id, "2026-10-28", "E");
    await assign(U.icuNurse3.id, "2026-10-28", "N");
    await setPreference(db, {
      scheduleId: S,
      userId: U.icuNurse1.id,
      date: isoDate("2026-10-28"),
      value: "N",
    });
    await setPreference(db, {
      scheduleId: S,
      userId: U.icuNurse4.id,
      date: isoDate("2026-10-28"),
      value: "OFF",
    });
    // Another day's preference is not loaded for this day.
    await setPreference(db, {
      scheduleId: S,
      userId: U.icuNurse4.id,
      date: isoDate("2026-10-29"),
      value: "M",
    });
  });

  it("lists who works each of the four shifts, with preferences, and who is off", async () => {
    const { day } = await review(actors.icuHead, { day: "2026-10-28" });
    expect(day).toMatchObject({
      date: "2026-10-28",
      health: "VALID",
      holiday: null,
      findings: [],
    });
    const names = (code: ShiftCode) =>
      day!.shifts.find((s) => s.code === code)!.nurses;
    expect(day!.shifts.map((s) => s.code)).toEqual(["M", "E", "N", "ME"]);
    expect(names("M")).toEqual([
      {
        userId: U.icuNurse1.id,
        displayName: U.icuNurse1.displayName,
        role: "NURSE",
        preference: "N",
      },
    ]);
    expect(names("ME")).toEqual([
      expect.objectContaining({ userId: U.icuHead.id, role: "HEAD_NURSE" }),
    ]);
    expect(names("E").map((n) => n.userId)).toEqual([U.icuNurse2.id]);
    expect(names("N").map((n) => n.userId)).toEqual([U.icuNurse3.id]);
    expect(day!.unassigned.map((n) => [n.userId, n.preference]).sort()).toEqual(
      [
        [U.icuNurse4.id, "OFF"],
        [U.transferNurse.id, null],
      ].sort(),
    );
  });

  it("feeds the preference-alignment summary from the day's roster (OFF is neither 'no preference' nor a match without a decision)", async () => {
    const { day } = await review(actors.icuHead, { day: "2026-10-28" });
    expect(summarizePreferenceAlignment(day!.roster)).toEqual({
      rostered: 6,
      withPreference: 2,
      matches: 0,
      // Nurse 1 wished N and works M.
      differs: 1,
      // Nurse 4 wished rest (OFF) and has no assignment: no decision is
      // recorded, so it is awaiting, never a match (D99).
      pending: 1,
      // The Head Nurse, nurses 2 and 3 and the transferred nurse.
      noPreference: 4,
      // Nurse 4 and the transferred nurse: overlaps the fit counts.
      unassigned: 2,
    });
    expect(
      day!.roster
        .filter((n) =>
          conflictsWithPreference({ preference: n.preference, shift: n.shift }),
        )
        .map((n) => n.userId),
    ).toEqual([U.icuNurse1.id]);
  });

  it("reports operational coverage with no staffing requirement configured", async () => {
    const { day } = await review(actors.icuHead, { day: "2026-10-28" });
    expect(day!.coverage).toEqual([
      { period: "M", covered: 2, bounds: null, status: "NOT_CONFIGURED" },
      { period: "E", covered: 2, bounds: null, status: "NOT_CONFIGURED" },
      { period: "N", covered: 1, bounds: null, status: "NOT_CONFIGURED" },
    ]);
  });

  it("compares coverage (not codes) with requirements once a source provides them", async () => {
    const requirementsFor = vi.fn<
      StaffingRequirementsSource["requirementsFor"]
    >(
      async () =>
        new Map([[isoDate("2026-10-28"), { M: { min: 3 }, E: { max: 1 } }]]),
    );
    const { day } = await review(
      actors.icuHead,
      { day: "2026-10-28" },
      { staffing: { requirementsFor } },
    );
    expect(requirementsFor).toHaveBeenCalledWith({
      departmentId: DEMO_ICU.id,
      dates: ["2026-10-28"],
    });
    expect(day!.coverage.map((c) => [c.period, c.status])).toEqual([
      ["M", "BELOW_MINIMUM"],
      ["E", "ABOVE_MAXIMUM"],
      ["N", "NOT_CONFIGURED"],
    ]);
  });

  it.each([
    ["not a date", "tomorrow"],
    ["an impossible date", "2026-02-30"],
    ["a day before the period", "2026-10-22"],
    ["a day after the period", "2026-11-22"],
  ])("ignores %s", async (_, day) => {
    const result = await review(actors.icuHead, { day });
    expect(result.day).toBeNull();
    expect(result.month.days).toHaveLength(30);
  });
});

describe("authorization", () => {
  const expectNotFound = (promise: Promise<unknown>) =>
    expect(promise).rejects.toBeInstanceOf(NotFoundError);

  it("denies the Head Nurse of another department, even with its own department id", async () => {
    await expectNotFound(review(actors.erHead));
    await expectNotFound(review(actors.erHead, { departmentId: DEMO_ER.id }));
  });

  it("denies a nurse of the department", async () => {
    await expectNotFound(review(actors.icuNurse));
  });

  it("gives a supervisor nothing before FINALIZED and read access from then on (D12)", async () => {
    await expectNotFound(review(actors.supervisor));
    await setStatus("PLANNING");
    await expectNotFound(review(actors.supervisor));
    await setStatus("FINALIZED");
    const { month } = await review(actors.supervisor);
    expect(month.status).toBe("FINALIZED");
  });

  it("denies a deactivated Head Nurse", async () => {
    await setUserActive(db, U.icuHead.id, false);
    await expectNotFound(review({ ...actors.icuHead, isActive: false }));
  });

  it("answers an unknown, malformed or foreign schedule id with the same NotFoundError", async () => {
    await expectNotFound(
      review(actors.icuHead, {
        scheduleId: "00000000-0000-4000-8000-000000000000",
      }),
    );
    await expectNotFound(review(actors.icuHead, { scheduleId: "not-a-uuid" }));
    // The schedule exists, but not in the department of the page.
    await expectNotFound(review(actors.icuHead, { departmentId: DEMO_ER.id }));
  });
});

describe("month selection by calendar period", () => {
  // Whole Jalali months of 1405; only Aban has a schedule (the demo seed).
  const MEHR = { start: isoDate("2026-09-23"), end: isoDate("2026-10-22") };
  const ABAN = { start: isoDate("2026-10-23"), end: isoDate("2026-11-21") };
  const AZAR = { start: isoDate("2026-11-22"), end: isoDate("2026-12-21") };

  const schedulesFor = (
    actor: Actor,
    input: { period?: typeof ABAN; scheduleId?: string } = {},
  ) =>
    getDepartmentSchedules(as(actor), {
      departmentId: DEMO_ICU.id,
      today: TODAY,
      ...input,
    });

  it("selects the schedule that covers the month", async () => {
    const data = await schedulesFor(actors.icuHead, { period: ABAN });
    expect(data.selected).toMatchObject({ id: S, label: "آبان ۱۴۰۵" });
    expect(data.schedules.map((x) => x.id)).toEqual([S]);
  });

  it("selects nothing for a month without a schedule, instead of the nearest one", async () => {
    for (const period of [MEHR, AZAR]) {
      const data = await schedulesFor(actors.icuHead, { period });
      expect(data.selected).toBeNull();
      // The department still has its schedule; it is just not this month's.
      expect(data.schedules.map((x) => x.id)).toEqual([S]);
      expect(data.canCreate).toBe(true);
    }
  });

  it("does not skip months: a schedule created later shows up for exactly its month", async () => {
    const azar = await createSchedule(db, {
      departmentId: DEMO_ICU.id,
      period: AZAR,
      label: "آذر ۱۴۰۵",
      createdBy: U.icuHead.id,
    });
    expect(
      (await schedulesFor(actors.icuHead, { period: AZAR })).selected?.id,
    ).toBe(azar.id);
    expect(
      (await schedulesFor(actors.icuHead, { period: ABAN })).selected?.id,
    ).toBe(S);
    // Mehr, before Aban, is still empty although both neighbours have schedules.
    expect(
      (await schedulesFor(actors.icuHead, { period: MEHR })).selected,
    ).toBeNull();
  });

  it("lets a requested period win over a schedule id, without falling back", async () => {
    const data = await schedulesFor(actors.icuHead, {
      period: MEHR,
      scheduleId: S,
    });
    expect(data.selected).toBeNull();
  });

  it("keeps the schedule-id behaviour: an unknown id falls back to the default", async () => {
    const data = await schedulesFor(actors.icuHead, {
      scheduleId: "00000000-0000-4000-8000-000000000000",
    });
    expect(data.selected?.id).toBe(S);
  });

  it("is denied to everyone but the Head Nurse, empty months included", async () => {
    for (const actor of [actors.icuNurse, actors.erHead, actors.supervisor])
      await expect(
        schedulesFor(actor, { period: MEHR }),
      ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("read-only", () => {
  it("writes nothing, whatever it reads", async () => {
    await assign(U.icuNurse1.id, "2026-10-24", "N");
    await assign(U.icuNurse1.id, "2026-10-25", "M");
    const before = await tableCounts();
    await review(actors.icuHead, { day: "2026-10-25" });
    await review(actors.icuHead);
    expect(await tableCounts()).toEqual(before);
  });
});

describe("performance", () => {
  /** A department of `size` nurses with a fully assigned 31-day month (Farvardin 1406). */
  async function largeDepartment(size: number) {
    const department = await createDepartment(db, {
      code: `load-${size}`,
      name: `بخش ${size} نفره`,
    });
    const people = await db
      .insert(users)
      .values(
        Array.from({ length: size }, (_, i) => ({
          email: `load${size}.${i}@test.invalid`,
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
    // Rotating M, E, N-then-rest pattern: realistic and night-rest safe.
    const pattern: (ShiftCode | null)[] = ["M", "E", "ME", "N", null];
    const rows = people.flatMap((p, i) =>
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
    );
    await db.insert(shiftAssignments).values(rows);
    const head = (await loadActor(db, people[0]!.id, TODAY))!;
    return { department, schedule, head, assignments: rows.length };
  }

  it("uses a constant number of queries for 60 nurses × 31 days (no N+1)", async () => {
    const small = await largeDepartment(6);
    const large = await largeDepartment(60);
    expect(large.assignments).toBeGreaterThan(1400);

    const queriesFor = async (
      d: Awaited<ReturnType<typeof largeDepartment>>,
      day?: IsoDate,
    ) => {
      const spy = vi.spyOn(pool, "query");
      const result = await getScheduleReview(
        as(d.head),
        { departmentId: d.department.id, scheduleId: d.schedule.id, day },
        {},
      );
      const count = spy.mock.calls.length;
      spy.mockRestore();
      return { count, result };
    };

    const month = await queriesFor(large);
    expect(month.result.month.days).toHaveLength(31);
    expect(month.result.month.totals.NEEDS_ATTENTION).toBe(0);
    expect(month.count).toBe((await queriesFor(small)).count);
    // Schedule, assignments, adjacent boundary days; and for the Phase 8
    // workflow the preference windows and submissions (their people's names
    // are one more query once a submission exists), all independent of size.
    expect(month.count).toBeGreaterThanOrEqual(4);
    expect(month.count).toBeLessThanOrEqual(5);

    const withDay = await queriesFor(large, isoDate("2027-04-01"));
    expect(withDay.count).toBe(
      (await queriesFor(small, isoDate("2027-04-01"))).count,
    );
    expect(withDay.count).toBeLessThanOrEqual(7);
    const detail = withDay.result.day!;
    expect(
      detail.shifts.reduce((n, s) => n + s.nurses.length, 0) +
        detail.unassigned.length,
    ).toBe(60);
    // The month overview carries aggregates only, never people.
    expect(JSON.stringify(month.result.month)).not.toContain("پرستار");
  });

  it("keeps the roster snapshot the source of names (D21)", async () => {
    const { day } = await review(actors.icuHead, { day: "2026-10-23" });
    const roster = await db
      .select()
      .from(scheduleRoster)
      .where(eq(scheduleRoster.scheduleId, S));
    expect(day!.unassigned).toHaveLength(roster.length);
  });
});
