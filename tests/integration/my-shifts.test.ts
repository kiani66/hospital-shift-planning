import { beforeEach, describe, expect, it } from "vitest";

import { getMyShiftsMonth } from "../../src/application/my-shifts/queries";
import type { ActionResult } from "../../src/application/result";
import { createSchedule } from "../../src/application/schedules/create-schedule";
import {
  approveSchedule,
  finalizeSchedule,
  returnSchedule,
  submitSchedule,
} from "../../src/application/schedules/lifecycle";
import {
  closePreferenceWindow,
  openPreferenceWindow,
} from "../../src/application/schedules/preference-windows";
import { adjustSchedule } from "../../src/application/schedules/schedule-changes";
import type { AppContext } from "../../src/application/use-case";
import type { Actor } from "../../src/domain/authz/actor";
import { ValidationError } from "../../src/domain/shared/errors";
import { isoDate } from "../../src/domain/shared/dates";
import type { ShiftCode } from "../../src/domain/shifts/shift-type";
import {
  DEMO_ER,
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
const TODAY = isoDate("2026-10-01");
const NOW = new Date("2026-10-01T06:30:00Z");
/** Aban 1405, the demo ICU schedule's period. */
const ABAN = { start: isoDate("2026-10-23"), end: isoDate("2026-11-21") };
/** Azar 1405: no demo schedule. */
const AZAR = { start: isoDate("2026-11-22"), end: isoDate("2026-12-21") };

type Who = "head" | "nurse1" | "nurse2" | "erHead" | "erNurse" | "supervisor";
const actors = {} as Record<Who, Actor>;
const as = (actor: Actor, at: Date = NOW): AppContext => ({
  db,
  actor,
  clock: () => at,
});

beforeEach(async () => {
  const load = async (id: string) => (await loadActor(db, id, TODAY))!;
  actors.head = await load(U.icuHead.id);
  actors.nurse1 = await load(U.icuNurse1.id);
  actors.nurse2 = await load(U.icuNurse2.id);
  actors.erHead = await load(U.erHead.id);
  actors.erNurse = await load(U.erNurse1.id);
  actors.supervisor = await load(U.supervisor.id);
});

function ok<T>(result: ActionResult<T>): T {
  if (!result.ok)
    throw new Error(
      `${result.error.code} ${result.error.reason ?? ""}: ${result.error.message}`,
    );
  return result.data;
}

const revision = async (id = S) => (await findScheduleById(db, id))!.revision;

async function step(
  command: typeof finalizeSchedule,
  actor: Actor,
  extra: Record<string, unknown> = {},
) {
  ok(
    await command(as(actor), {
      scheduleId: S,
      expectedRevision: await revision(),
      ...extra,
    }),
  );
}

const assign = (userId: string, date: string, shift: ShiftCode) =>
  setAssignment(db, {
    scheduleId: S,
    userId,
    date: isoDate(date),
    shift,
    updatedBy: U.icuHead.id,
  });

/**
 * nurse1: M on 25 Oct, N on 27 Oct, ME on 29 Oct (no night-rest finding).
 * nurse2: E on 25 Oct, N on 26 Oct. Valid, so it can be finalized.
 */
async function plan() {
  await assign(U.icuNurse1.id, "2026-10-25", "M");
  await assign(U.icuNurse1.id, "2026-10-27", "N");
  await assign(U.icuNurse1.id, "2026-10-29", "ME");
  await assign(U.icuNurse2.id, "2026-10-25", "E");
  await assign(U.icuNurse2.id, "2026-10-26", "N");
}

async function toPlanning() {
  await plan();
  await step(openPreferenceWindow as typeof finalizeSchedule, actors.head);
  await step(closePreferenceWindow as typeof finalizeSchedule, actors.head);
}
async function toFinalized() {
  await toPlanning();
  await completeScheduleFixture(db, S, [
    U.icuHead.id,
    U.icuNurse4.id,
    U.transferNurse.id,
  ]);
  await step(finalizeSchedule, actors.head);
}
async function toSubmitted() {
  await toFinalized();
  await step(submitSchedule, actors.head);
}
async function toApproved() {
  await toSubmitted();
  await step(approveSchedule, actors.supervisor);
}

const month = (actor: Actor, period = ABAN, today = TODAY) =>
  getMyShiftsMonth(as(actor), { period, today });

/** Every visible entry of the month as `date shift publication`. */
const entries = async (actor: Actor, period = ABAN) =>
  (await month(actor, period)).days.flatMap((d) =>
    d.entries
      .filter((e) => e.shift !== "OFF")
      .map((e) => `${d.date} ${e.shift} ${e.publication}`),
  );

describe("getMyShiftsMonth: what a nurse sees (D11 as amended, D98)", () => {
  it("shows the nurse's current assignments as temporary while the schedule is a draft", async () => {
    await plan(); // DRAFT
    const m = await month(actors.nurse1);
    expect(m.onAnyRoster).toBe(true);
    expect(m.schedules).toMatchObject([
      { id: S, status: "DRAFT", publication: "TEMPORARY", shiftCount: 3 },
    ]);
    expect(await entries(actors.nurse1)).toEqual([
      "2026-10-25 M TEMPORARY",
      "2026-10-27 N TEMPORARY",
      "2026-10-29 ME TEMPORARY",
    ]);
    expect(m.totals).toMatchObject({
      shiftCount: 3,
      minutes: 31 * 60,
      includesUnapproved: true,
    });
    // No change request before FINALIZED (D13 is unchanged).
    expect(m.days.flatMap((d) => d.entries).some((e) => e.requestable)).toBe(
      false,
    );
  });

  it("follows the Head Nurse's edits during planning: they may change", async () => {
    await toPlanning();
    expect((await month(actors.nurse1)).schedules[0]).toMatchObject({
      status: "PLANNING",
      publication: "TEMPORARY",
    });
    await assign(U.icuNurse1.id, "2026-10-25", "E");
    await setAssignment(db, {
      scheduleId: S,
      userId: U.icuNurse1.id,
      date: isoDate("2026-11-02"),
      shift: "N",
      updatedBy: U.icuHead.id,
    });
    expect(await entries(actors.nurse1)).toEqual([
      "2026-10-25 E TEMPORARY",
      "2026-10-27 N TEMPORARY",
      "2026-10-29 ME TEMPORARY",
      "2026-11-02 N TEMPORARY",
    ]);
  });

  it("shows a Head Nurse their own assignments during planning, never the rest of the roster", async () => {
    await plan();
    await assign(U.icuHead.id, "2026-10-28", "ME");
    expect(await entries(actors.head)).toEqual(["2026-10-28 ME TEMPORARY"]);
    await step(openPreferenceWindow as typeof finalizeSchedule, actors.head);
    const m = await month(actors.head);
    expect(m.schedules[0]).toMatchObject({
      status: "PLANNING",
      publication: "TEMPORARY",
      shiftCount: 1,
    });
    expect(m.totals.shiftCount).toBe(1);
  });

  it("never returns another nurse's planning-stage assignments", async () => {
    await plan();
    const mine = await entries(actors.nurse2);
    expect(mine).toEqual(["2026-10-25 E TEMPORARY", "2026-10-26 N TEMPORARY"]);
    // nurse1 works 25 Oct too, but only nurse2's own E is in their month.
    const day = (await month(actors.nurse2)).days.find(
      (d) => d.date === "2026-10-25",
    )!;
    expect(day.entries.map((e) => e.shift)).toEqual(["E"]);
  });

  it("shows the finalized working copy as finalized (no approval pending), own shifts only, with totals", async () => {
    await toFinalized();
    const m = await month(actors.nurse1);
    expect(m.period).toEqual(ABAN);
    expect(m.days).toHaveLength(30);
    expect(m.schedules).toMatchObject([
      { status: "FINALIZED", publication: "FINALIZED", shiftCount: 3 },
    ]);
    expect(await entries(actors.nurse1)).toEqual([
      "2026-10-25 M FINALIZED",
      "2026-10-27 N FINALIZED",
      "2026-10-29 ME FINALIZED",
    ]);
    // M 7h + N 12h + ME 12h; one night.
    expect(m.totals).toEqual({
      shiftCount: 3,
      offCount: 27,
      minutes: 31 * 60,
      nightCount: 1,
      byCode: { M: 1, E: 0, N: 1, ME: 1 },
      includesUnapproved: true,
    });
    // Another nurse on the same days sees only their own.
    expect(await entries(actors.nurse2)).toEqual([
      "2026-10-25 E FINALIZED",
      "2026-10-26 N FINALIZED",
    ]);
  });

  it("marks a submitted schedule as awaiting the Supervisor, a returned one as returned", async () => {
    await toSubmitted();
    expect((await month(actors.nurse1)).schedules[0]).toMatchObject({
      status: "SUBMITTED",
      publication: "AWAITING_APPROVAL",
    });
    expect(await entries(actors.nurse1)).toContain(
      "2026-10-25 M AWAITING_APPROVAL",
    );

    await step(returnSchedule, actors.supervisor, { comment: "اصلاح شود" });
    expect((await month(actors.nurse1)).schedules[0]).toMatchObject({
      status: "RETURNED",
      publication: "RETURNED",
    });
  });

  it("shows the approved version as official", async () => {
    await toApproved();
    const m = await month(actors.nurse1);
    expect(m.schedules[0]).toMatchObject({
      status: "APPROVED",
      publication: "OFFICIAL",
      pendingChangeDates: [],
    });
    expect(m.totals.includesUnapproved).toBe(false);
    expect(await entries(actors.nurse1)).toEqual([
      "2026-10-25 M OFFICIAL",
      "2026-10-27 N OFFICIAL",
      "2026-10-29 ME OFFICIAL",
    ]);
  });

  it("keeps the approved shift during a revision and flags the day (D17, D70)", async () => {
    await toApproved();
    ok(
      await adjustSchedule(as(actors.head), {
        scheduleId: S,
        expectedRevision: await revision(),
        changes: [{ nurseId: U.icuNurse1.id, date: "2026-10-25", shift: "E" }],
        reasonCode: "STAFFING_NEED",
      }),
    );
    expect((await findScheduleById(db, S))!.status).toBe("REVISING");

    const m = await month(actors.nurse1);
    expect(m.schedules[0]).toMatchObject({
      status: "REVISING",
      publication: "OFFICIAL",
      pendingChangeDates: ["2026-10-25"],
    });
    const day = m.days.find((d) => d.date === "2026-10-25")!;
    // Still the approved M, not the unapproved E of the revision.
    expect(day.entries).toMatchObject([
      { shift: "M", publication: "OFFICIAL", changePending: true },
    ]);
    // A nurse with no shift that day still learns a change is pending.
    const other = (await month(actors.nurse2)).days.find(
      (d) => d.date === "2026-10-25",
    )!;
    expect(other.entries[0]?.changePending).toBe(true);

    // Approving the revision publishes the change.
    await step(submitSchedule, actors.head);
    await step(approveSchedule, actors.supervisor);
    expect(await entries(actors.nurse1)).toContain("2026-10-25 E OFFICIAL");
    expect(
      (await month(actors.nurse1)).schedules[0]!.pendingChangeDates,
    ).toEqual([]);
  });
});

describe("getMyShiftsMonth: empty months and people without schedules", () => {
  it("returns no schedule for a month without one, and knows the nurse has others", async () => {
    await toFinalized();
    const m = await month(actors.nurse1, AZAR);
    expect(m).toMatchObject({ onAnyRoster: true, schedules: [] });
    expect(m.days).toHaveLength(30);
    expect(m.totals.shiftCount).toBe(0);
  });

  it("tells a user on no roster apart from an empty month", async () => {
    const m = await month(actors.supervisor);
    expect(m).toMatchObject({ onAnyRoster: false, schedules: [] });
  });

  it("lists a schedule without a shift for the nurse, with zero totals", async () => {
    await toFinalized();
    const nurse3 = (await loadActor(db, U.icuNurse3.id, TODAY))!;
    const m = await month(nurse3);
    expect(m.schedules).toMatchObject([
      { publication: "FINALIZED", shiftCount: 0 },
    ]);
    expect(m.totals.shiftCount).toBe(0);
  });

  it("only counts days of the requested month when a schedule overlaps it partly", async () => {
    await toFinalized();
    // 24 Oct to 22 Nov: the first two days of Aban fall outside.
    const shifted = {
      start: isoDate("2026-10-26"),
      end: isoDate("2026-11-24"),
    };
    expect(await entries(actors.nurse1, shifted)).toEqual([
      "2026-10-27 N FINALIZED",
      "2026-10-29 ME FINALIZED",
    ]);
  });

  it("refuses an invalid or oversized period", async () => {
    await expect(
      getMyShiftsMonth(as(actors.nurse1), {
        period: { start: ABAN.start, end: isoDate("2027-03-01") },
        today: TODAY,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      getMyShiftsMonth(as(actors.nurse1), {
        period: { start: ABAN.end, end: ABAN.start },
        today: TODAY,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("getMyShiftsMonth: authorization", () => {
  it("never shows another department's schedule", async () => {
    await toFinalized();
    const m = await month(actors.erNurse);
    expect(m.schedules).toEqual([]);
    expect(m.onAnyRoster).toBe(false);
  });

  it("shows both departments' shifts when a transferred nurse is on two rosters in one month", async () => {
    // The transfer nurse was in ER until 22 Sep and is in ICU from 23 Sep:
    // the snapshots put them on an ER September schedule and an ICU Mehr one.
    const create = async (actor: Actor, departmentId: string, p: object) =>
      ok(await createSchedule(as(actor), { departmentId, ...p })).scheduleId;
    const er = await create(actors.erHead, DEMO_ER.id, {
      periodStart: "2026-09-01",
      periodEnd: "2026-09-30",
      label: "سپتامبر",
    });
    const icu = await create(actors.head, DEMO_SCHEDULE.departmentId, {
      periodStart: "2026-09-23",
      periodEnd: "2026-10-22",
      label: "مهر ۱۴۰۵",
    });
    const nurse = U.transferNurse.id;
    for (const [scheduleId, shift] of [
      [er, "N"],
      [icu, "M"],
    ] as const) {
      await setAssignment(db, {
        scheduleId,
        userId: nurse,
        date: isoDate("2026-09-25"),
        shift,
        updatedBy: nurse,
      });
      // Test-only shortcut to a published state (the workflow is covered above).
      const s = (await findScheduleById(db, scheduleId))!;
      await updateSchedule(db, {
        id: scheduleId,
        expectedRevision: s.revision,
        status: "FINALIZED",
      });
    }

    const actor = (await loadActor(db, nurse, TODAY))!;
    const mehr = { start: isoDate("2026-09-23"), end: isoDate("2026-10-22") };
    // Seen on 24 Sep, so 25 Sep is not past.
    const m = await month(actor, mehr, isoDate("2026-09-24"));
    expect(m.schedules.map((s) => s.id)).toEqual([er, icu]);
    const day = m.days.find((d) => d.date === "2026-09-25")!;
    expect(day.entries).toMatchObject([
      // Former ER member: history stays readable, no new requests (D16).
      { scheduleId: er, shift: "N", requestable: false },
      { scheduleId: icu, shift: "M", requestable: true },
    ]);
    expect(m.totals).toMatchObject({ shiftCount: 2, nightCount: 1 });
    // ER's own nurses never see the ICU schedule.
    expect(
      (await month(actors.erNurse, mehr)).schedules.map((s) => s.id),
    ).toEqual([er]);
  });

  it("keeps a former member's history but offers no change request (D16)", async () => {
    await toFinalized();
    let m = await month(actors.nurse1);
    expect(
      m.days.find((d) => d.date === "2026-10-25")!.entries[0]!.requestable,
    ).toBe(true);

    await endMembership(db, {
      userId: U.icuNurse1.id,
      departmentId: DEMO_SCHEDULE.departmentId,
      endedOn: isoDate("2026-09-30"),
    });
    const former = (await loadActor(db, U.icuNurse1.id, TODAY))!;
    expect(former.memberships).toEqual([]);
    m = await month(former);
    expect(await entries(former)).toHaveLength(3);
    expect(m.days.flatMap((d) => d.entries).some((e) => e.requestable)).toBe(
      false,
    );
  });

  it("shows nothing to a deactivated actor", async () => {
    await toFinalized();
    const m = await month({ ...actors.nurse1, isActive: false });
    expect(m).toMatchObject({ onAnyRoster: false, schedules: [] });
  });

  it("offers a change request only for days that are not past", async () => {
    await toFinalized();
    const m = await getMyShiftsMonth(as(actors.nurse1), {
      period: ABAN,
      today: isoDate("2026-10-27"),
    });
    const requestable = Object.fromEntries(
      m.days.flatMap((d) => d.entries.map((e) => [d.date, e.requestable])),
    );
    expect(requestable).toEqual({
      "2026-10-25": false,
      "2026-10-27": true,
      "2026-10-29": true,
    });
  });
});
