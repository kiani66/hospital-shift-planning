import { beforeEach, describe, expect, it } from "vitest";

import { getNurseDashboard } from "../../src/application/my-shifts/dashboard";
import {
  approveSchedule,
  finalizeSchedule,
  submitSchedule,
} from "../../src/application/schedules/lifecycle";
import type { AppContext } from "../../src/application/use-case";
import { isoDate } from "../../src/domain/shared/dates";
import { currentOrNextShift } from "../../src/domain/shifts/interval";
import type { AssignmentCode } from "../../src/domain/shifts/shift-type";
import {
  DEMO_SCHEDULE,
  DEMO_USERS,
} from "../../src/infrastructure/db/seed/demo-data";
import { setAssignment } from "../../src/infrastructure/repositories/assignments";
import {
  endMembership,
  loadActor,
} from "../../src/infrastructure/repositories/memberships";
import {
  findScheduleById,
  updateSchedule,
} from "../../src/infrastructure/repositories/schedules";
import { completeScheduleFixture } from "../support/complete-schedule";
import { setupTestDatabase } from "./support/database";

const { db } = setupTestDatabase();
const U = DEMO_USERS;
const S = DEMO_SCHEDULE.id;
const date = isoDate("2026-10-24");
const today = isoDate("2026-10-23");
const month = { start: today, end: isoDate("2026-11-21") };
const calendar = { start: today, end: isoDate("2026-10-29") };
let ctx: AppContext;
const assign = (userId: string, day: string, shift: AssignmentCode) =>
  setAssignment(db, {
    scheduleId: S,
    userId,
    date: isoDate(day),
    shift,
    updatedBy: U.icuHead.id,
  });
const read = (selected = date, actor = ctx.actor) =>
  getNurseDashboard({ db, actor }, { month, calendar, selected, today });
const revision = async () => (await findScheduleById(db, S))!.revision;
async function status(value: "FINALIZED" | "PLANNING" | "REVISING") {
  await updateSchedule(db, {
    id: S,
    expectedRevision: await revision(),
    status: value,
  });
}
beforeEach(async () => {
  ctx = { db, actor: (await loadActor(db, U.icuNurse1.id, today))! };
});

describe("nurse dashboard sources and coworker privacy", () => {
  it.each([
    ["M", ["M", "ME"]],
    ["E", ["E", "ME"]],
    ["N", ["N"]],
    ["ME", ["M", "E", "ME"]],
  ] as const)(
    "returns only coworkers overlapping %s, excluding self, OFF and leave",
    async (mine, expected) => {
      await assign(U.icuNurse1.id, date, mine);
      const other = [
        U.icuHead,
        U.icuNurse2,
        U.icuNurse3,
        U.icuNurse4,
        U.transferNurse,
      ];
      const codes = ["M", "E", "N", "ME", "OFF"] as const;
      for (let i = 0; i < other.length; i++)
        await assign(other[i]!.id, date, codes[i]!);
      await status("FINALIZED");
      const data = await read();
      const names = data.coworkers[0]!.names;
      expect(names).toHaveLength(expected.length);
      for (const code of expected)
        expect(names).toContain(other[codes.indexOf(code)]!.displayName);
      expect(names).not.toContain(U.icuNurse1.displayName);
      expect(names).not.toContain(U.transferNurse.displayName);
      await assign(U.icuNurse4.id, date, "H");
      expect((await read()).coworkers[0]!.names).not.toContain(
        U.icuNurse4.displayName,
      );
      expect(Object.keys(data.coworkers[0]!)).toEqual([
        "scheduleId",
        "departmentName",
        "shift",
        "available",
        "names",
      ]);
    },
  );

  it("keeps own planning assignments temporary but never discloses planning coworkers", async () => {
    await assign(U.icuNurse1.id, date, "M");
    await assign(U.icuHead.id, date, "ME");
    for (const planning of [false, true]) {
      if (planning) await status("PLANNING");
      const data = await read();
      expect(data.upcoming[0]!.entry.publication).toBe("TEMPORARY");
      expect(data.month.totals.includesUnapproved).toBe(true);
      expect(data.coworkers).toMatchObject([{ available: false, names: [] }]);
    }
  });

  it("isolates departments, ignores injected user ids and denies inactive actors", async () => {
    await assign(U.icuNurse1.id, date, "M");
    await status("FINALIZED");
    const foreign = (await loadActor(db, U.erNurse1.id, today))!;
    expect(await read(date, foreign)).toMatchObject({
      coworkers: [],
      upcoming: [],
      requests: [],
      month: { schedules: [] },
    });
    expect(await read(date, { ...ctx.actor, isActive: false })).toMatchObject({
      coworkers: [],
      upcoming: [],
      requests: [],
      month: { schedules: [] },
    });
    const data = await getNurseDashboard(ctx, {
      month,
      calendar,
      selected: date,
      today,
      ...{ nurseId: U.erNurse1.id },
    });
    expect(data.month.totals.shiftCount).toBe(1);
  });

  it("preserves former members' own history without disclosing coworkers", async () => {
    await assign(U.icuNurse1.id, date, "M");
    await assign(U.icuHead.id, date, "ME");
    await status("FINALIZED");
    await endMembership(db, {
      userId: ctx.actor.userId,
      departmentId: DEMO_SCHEDULE.departmentId,
      endedOn: isoDate("2026-10-22"),
    });
    const former = (await loadActor(db, ctx.actor.userId, today))!;
    const data = await read(date, former);
    expect(data.month.totals.shiftCount).toBe(1);
    expect(data.coworkers).toMatchObject([{ available: false, names: [] }]);
  });

  it("uses approved assignments for both nurse and coworkers during revision", async () => {
    await assign(U.icuNurse1.id, date, "M");
    await assign(U.icuHead.id, date, "ME");
    await completeScheduleFixture(db, S, [
      U.icuNurse2.id,
      U.icuNurse4.id,
      U.transferNurse.id,
    ]);
    const head = (await loadActor(db, U.icuHead.id, today))!;
    const supervisor = (await loadActor(db, U.supervisor.id, today))!;
    for (const [command, actor] of [
      [finalizeSchedule, head],
      [submitSchedule, head],
      [approveSchedule, supervisor],
    ] as const) {
      const result = await command(
        { db, actor },
        { scheduleId: S, expectedRevision: await revision() },
      );
      expect(result.ok, JSON.stringify(result)).toBe(true);
    }
    const baseline = await read();
    await assign(U.icuNurse1.id, date, "N");
    await assign(U.icuHead.id, date, "OFF");
    await status("REVISING");
    const revised = await read();
    expect(revised.coworkers).toEqual(baseline.coworkers);
    expect(revised.upcoming.find((s) => s.date === date)!.entry.shift).toBe(
      "M",
    );
    expect(revised.month.totals.includesUnapproved).toBe(false);
  });
});

describe("nurse dashboard summaries, next shifts and empty states", () => {
  it("counts ME once, sums catalog intervals, and distinguishes future OFF from absent days and H", async () => {
    await assign(U.icuNurse1.id, date, "M");
    await assign(U.icuNurse1.id, "2026-10-25", "E");
    await assign(U.icuNurse1.id, "2026-10-26", "N");
    await assign(U.icuNurse1.id, "2026-10-27", "OFF");
    await assign(U.icuNurse1.id, "2026-10-28", "ME");
    await assign(U.icuNurse1.id, "2026-10-29", "H");
    const data = await read();
    expect(data.month.totals).toMatchObject({
      shiftCount: 4,
      nightCount: 1,
      minutes: 36 * 60,
      offCount: 1,
      leaveCount: 1,
    });
    expect(data.upcomingOffDates).toEqual(["2026-10-27"]);
    expect(data.calendar.days[0]!.entries).toEqual([]);
    expect((await read(isoDate("2026-10-27"))).coworkers).toEqual([]);
    expect((await read(today)).coworkers).toEqual([]);
    expect((await read(isoDate("2026-10-29"))).coworkers).toEqual([]);
  });

  it("finds active previous-month nights and shifts beyond the displayed week/month", async () => {
    await assign(U.icuNurse1.id, "2026-11-21", "N");
    const nextMonth = {
      start: isoDate("2026-11-22"),
      end: isoDate("2026-12-21"),
    };
    const data = await getNurseDashboard(ctx, {
      month: nextMonth,
      calendar: nextMonth,
      selected: nextMonth.start,
      today: nextMonth.start,
    });
    expect(data.month.totals.shiftCount).toBe(0);
    expect(
      currentOrNextShift(data.upcoming, Date.parse("2026-11-22T00:00:00Z")),
    ).toMatchObject({ active: true, shift: { date: "2026-11-21" } });
    const earlier = {
      start: isoDate("2026-09-23"),
      end: isoDate("2026-10-22"),
    };
    const far = await getNurseDashboard(ctx, {
      month: earlier,
      calendar: earlier,
      selected: earlier.start,
      today: earlier.start,
    });
    expect(
      currentOrNextShift(far.upcoming, Date.parse("2026-09-23T00:00:00Z")),
    ).toMatchObject({ active: false, shift: { date: "2026-11-21" } });
  });

  it("handles empty schedules and an out-of-range selected day without unrelated coworkers", async () => {
    const data = await read();
    expect(data).toMatchObject({
      upcoming: [],
      coworkers: [],
      requests: [],
      upcomingOffDates: [],
      month: { totals: { shiftCount: 0, minutes: 0 } },
    });
    await assign(U.icuNurse1.id, date, "M");
    await status("FINALIZED");
    expect((await read(isoDate("2026-12-01"))).coworkers).toEqual([]);
  });
});
