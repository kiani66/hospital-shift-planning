import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearMyPreference,
  setMyPreference,
} from "../../src/application/preferences/commands";
import {
  getMyPreferenceSchedules,
  getMyPreferences,
  getMyPreferencesPage,
} from "../../src/application/preferences/queries";
import type { HolidayCalendar } from "../../src/application/calendar/holidays";
import { createSchedule } from "../../src/application/schedules/create-schedule";
import {
  closePreferenceWindow,
  openPreferenceWindow,
} from "../../src/application/schedules/preference-windows";
import type { AppContext } from "../../src/application/use-case";
import type { Actor } from "../../src/domain/authz/actor";
import { eachDay, isoDate, type IsoDate } from "../../src/domain/shared/dates";
import {
  jalaliMonthPeriod,
  toJalali,
} from "../../src/features/calendar/jalali";
import {
  DEMO_ER,
  DEMO_ICU,
  DEMO_SCHEDULE,
  DEMO_USERS,
} from "../../src/infrastructure/db/seed/demo-data";
import { listAuditEventsForSchedule } from "../../src/infrastructure/repositories/audit";
import {
  endMembership,
  loadActor,
} from "../../src/infrastructure/repositories/memberships";
import { listNotificationsForRecipient } from "../../src/infrastructure/repositories/notifications";
import {
  closeOpenPreferenceWindows,
  createPreferenceWindow,
} from "../../src/infrastructure/repositories/preference-windows";
import {
  listPreferences,
  setPreference,
} from "../../src/infrastructure/repositories/preferences";
import {
  lockScheduleForUpdate,
  updateSchedule,
} from "../../src/infrastructure/repositories/schedules";
import { setUserActive } from "../../src/infrastructure/repositories/users";
import { setupTestDatabase } from "./support/database";

const { db } = setupTestDatabase();
const U = DEMO_USERS;
const S = DEMO_SCHEDULE.id;
const TODAY = isoDate("2026-10-01");
const NOW = new Date("2026-10-01T06:30:00Z");
const LATER = new Date("2026-10-05T10:00:00Z");
const DAY = "2026-10-25";
const UNKNOWN = "30000000-0000-4000-8000-00000000ffff";

type Who =
  "icuHead" | "icuNurse1" | "icuNurse2" | "erHead" | "erNurse1" | "supervisor";
const actors = {} as Record<Who, Actor>;
const as = (actor: Actor, at: Date = NOW): AppContext => ({
  db,
  actor,
  clock: () => at,
});

const WHO: readonly Who[] = [
  "icuHead",
  "icuNurse1",
  "icuNurse2",
  "erHead",
  "erNurse1",
  "supervisor",
];

beforeEach(async () => {
  for (const who of WHO) actors[who] = (await loadActor(db, U[who].id, TODAY))!;
});

/** Opens preference collection on the demo ICU schedule (DRAFT → PLANNING). */
async function openIcu(
  input: { scope?: unknown; nurseIds?: string[] } = {},
): Promise<number> {
  const result = await openPreferenceWindow(as(actors.icuHead), {
    scheduleId: S,
    expectedRevision: 0,
    ...input,
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.data.revision;
}

/** An ER schedule (another department) with preferences open. */
async function openEr(): Promise<string> {
  const created = await createSchedule(as(actors.erHead), {
    departmentId: DEMO_ER.id,
    periodStart: "2026-10-23",
    periodEnd: "2026-11-21",
    label: "آبان ۱۴۰۵",
  });
  if (!created.ok) throw new Error(created.error.message);
  const opened = await openPreferenceWindow(as(actors.erHead), {
    scheduleId: created.data.scheduleId,
    expectedRevision: created.data.revision,
  });
  if (!opened.ok) throw new Error(opened.error.message);
  return created.data.scheduleId;
}

const set = (
  actor: Actor,
  value: string,
  date: string = DAY,
  scheduleId: string = S,
  at: Date = NOW,
) => setMyPreference(as(actor, at), { scheduleId, date, value });

const clear = (actor: Actor, date: string = DAY, scheduleId: string = S) =>
  clearMyPreference(as(actor), { scheduleId, date });

const rows = () => listPreferences(db, S);
const preferenceAudit = async (scheduleId = S) =>
  (await listAuditEventsForSchedule(db, scheduleId)).filter((e) =>
    e.action.startsWith("preference."),
  );

describe("getMyPreferenceSchedules", () => {
  it("lists only schedules whose window includes the nurse (1, 2)", async () => {
    expect(
      await getMyPreferenceSchedules(as(actors.icuNurse1), { today: TODAY }),
    ).toEqual([]); // DRAFT: nothing opened yet
    await openIcu();
    const erId = await openEr();

    expect(
      await getMyPreferenceSchedules(as(actors.icuNurse1), { today: TODAY }),
    ).toEqual([
      {
        id: S,
        label: "آبان ۱۴۰۵",
        departmentName: DEMO_ICU.name,
        period: { start: "2026-10-23", end: "2026-11-21" },
        state: "OPEN",
      },
    ]);
    const er = await getMyPreferenceSchedules(as(actors.erNurse1), {
      today: TODAY,
    });
    expect(er.map((s) => s.id)).toEqual([erId]);
  });

  it("hides a schedule whose window is for other nurses only", async () => {
    await openIcu({ nurseIds: [U.icuNurse2.id] });
    expect(
      await getMyPreferenceSchedules(as(actors.icuNurse1), { today: TODAY }),
    ).toEqual([]);
    expect(
      await getMyPreferenceSchedules(as(actors.icuNurse2), { today: TODAY }),
    ).toHaveLength(1);
  });

  it("lists nothing for a supervisor without roster membership, or a deactivated actor", async () => {
    await openIcu();
    expect(
      await getMyPreferenceSchedules(as(actors.supervisor), { today: TODAY }),
    ).toEqual([]);
    expect(
      await getMyPreferenceSchedules(
        as({ ...actors.icuNurse1, isActive: false }),
        { today: TODAY },
      ),
    ).toEqual([]);
  });

  it("keeps a closed but current schedule and drops an ended, closed one", async () => {
    const revision = await openIcu();
    await closePreferenceWindow(as(actors.icuHead, LATER), {
      scheduleId: S,
      expectedRevision: revision,
    });
    const list = (today: string) =>
      getMyPreferenceSchedules(as(actors.icuNurse1, LATER), {
        today: isoDate(today),
      });
    expect((await list("2026-10-05"))[0]).toMatchObject({
      id: S,
      state: "CLOSED",
    });
    expect(await list("2026-11-22")).toEqual([]);
  });
});

describe("getMyPreferences", () => {
  it("loads only the actor's own preferences (3, 4)", async () => {
    await openIcu();
    await setPreference(db, {
      scheduleId: S,
      userId: U.icuNurse1.id,
      date: isoDate(DAY),
      value: "N",
    });
    await setPreference(db, {
      scheduleId: S,
      userId: U.icuNurse2.id,
      date: isoDate("2026-10-26"),
      value: "M",
    });

    const mine = await getMyPreferences(as(actors.icuNurse1), {
      scheduleId: S,
    });
    expect(mine).toMatchObject({
      id: S,
      label: "آبان ۱۴۰۵",
      departmentName: DEMO_ICU.name,
      status: "PLANNING",
      state: "OPEN",
      editable: true,
      window: {
        firstDate: "2026-10-23",
        lastDate: "2026-11-21",
        dateCount: 30,
        closesAt: null,
        closedAt: null,
      },
      summary: { total: 1, N: 1, M: 0, E: 0, ME: 0, OFF: 0 },
    });
    expect(mine.days).toHaveLength(30);
    expect(mine.days.filter((d) => d.value !== null)).toEqual([
      { date: DAY, value: "N", lock: null, holiday: null },
    ]);
    // Nurse 2's M on 2026-10-26 is not in nurse 1's view.
    expect(mine.days.find((d) => d.date === "2026-10-26")?.value).toBeNull();
  });

  it("explains read-only days: outside the reopened scope and closed", async () => {
    await openIcu({
      scope: { kind: "RANGE", from: "2026-10-23", to: "2026-10-31" },
    });
    const view = await getMyPreferences(as(actors.icuNurse1), {
      scheduleId: S,
    });
    expect(view.days.find((d) => d.date === "2026-10-31")?.lock).toBeNull();
    expect(view.days.find((d) => d.date === "2026-11-01")?.lock).toBe(
      "DATE_NOT_IN_WINDOW",
    );
    expect(view.window).toMatchObject({
      firstDate: "2026-10-23",
      lastDate: "2026-10-31",
      dateCount: 9,
    });
  });

  it("reports the earliest deadline of an active window", async () => {
    await openIcu();
    const deadline = new Date("2026-10-10T20:30:00Z");
    await createPreferenceWindow(db, {
      scheduleId: S,
      kind: "REOPEN",
      scope: { kind: "DAY", dates: [isoDate(DAY)] },
      closesAt: deadline,
      openedBy: U.icuHead.id,
    });
    const view = await getMyPreferences(as(actors.icuNurse1), {
      scheduleId: S,
    });
    expect(view.window.closesAt).toEqual(deadline);
  });

  it.each([
    ["an unknown schedule (19)", "icuNurse1", UNKNOWN],
    ["a malformed id", "icuNurse1", "not-a-uuid"],
    ["another department's schedule (20)", "icuNurse1", "ER"],
    ["a supervisor without roster membership (18)", "supervisor", S],
  ] as const)("answers NOT_FOUND for %s", async (_, who, id) => {
    await openIcu();
    const erId = await openEr();
    await expect(
      getMyPreferences(as(actors[who]), {
        scheduleId: id === "ER" ? erId : id,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("answers NOT_FOUND to a deactivated actor and before any window opens", async () => {
    await expect(
      getMyPreferences(as(actors.icuNurse1), { scheduleId: S }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await openIcu();
    await expect(
      getMyPreferences(as({ ...actors.icuNurse1, isActive: false }), {
        scheduleId: S,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("keeps saved preferences visible, read-only, after the window closes (22)", async () => {
    const revision = await openIcu();
    expect((await set(actors.icuNurse1, "ME")).ok).toBe(true);
    await closePreferenceWindow(as(actors.icuHead, LATER), {
      scheduleId: S,
      expectedRevision: revision,
    });
    const view = await getMyPreferences(as(actors.icuNurse1, LATER), {
      scheduleId: S,
    });
    expect(view).toMatchObject({
      state: "CLOSED",
      editable: false,
      window: { closedAt: LATER, closesAt: null, dateCount: 30 },
      summary: { total: 1, ME: 1 },
    });
    expect(view.days.find((d) => d.date === DAY)).toEqual({
      date: DAY,
      value: "ME",
      lock: "WINDOW_CLOSED",
      holiday: null,
    });
    expect(view.days.every((d) => d.lock === "WINDOW_CLOSED")).toBe(true);
  });

  it("marks every day NOT_MEMBER after the actor's membership ended (history stays readable)", async () => {
    await openIcu();
    await endMembership(db, {
      userId: U.icuNurse1.id,
      departmentId: DEMO_ICU.id,
      endedOn: isoDate("2026-09-30"),
    });
    const former = (await loadActor(db, U.icuNurse1.id, TODAY))!;
    const view = await getMyPreferences(as(former), { scheduleId: S });
    expect(view.editable).toBe(false);
    expect(new Set(view.days.map((d) => d.lock))).toEqual(
      new Set(["NOT_MEMBER"]),
    );
  });
});

/** The page's calendar: Jalali months, as `/preferences` hands it in. */
const calendar = {
  monthOf: (date: IsoDate) => {
    const j = toJalali(date);
    return jalaliMonthPeriod({ year: j.year, month: j.month });
  },
};
const MEHR = { start: isoDate("2026-09-23"), end: isoDate("2026-10-22") };
const ABAN = { start: isoDate("2026-10-23"), end: isoDate("2026-11-21") };
const AZAR = { start: isoDate("2026-11-22"), end: isoDate("2026-12-21") };

const page = (
  actor: Actor,
  input: { scheduleId?: string; month?: { start: IsoDate; end: IsoDate } } = {},
  at: Date = NOW,
  today: IsoDate = TODAY,
) => getMyPreferencesPage(as(actor, at), { ...input, today, calendar });

/** A second ICU schedule (Azar 1405) with preference collection open. */
async function openIcuAzar(): Promise<string> {
  const created = await createSchedule(as(actors.icuHead), {
    departmentId: DEMO_ICU.id,
    periodStart: AZAR.start,
    periodEnd: AZAR.end,
    label: "آذر ۱۴۰۵",
  });
  if (!created.ok) throw new Error(created.error.message);
  const opened = await openPreferenceWindow(as(actors.icuHead), {
    scheduleId: created.data.scheduleId,
    expectedRevision: created.data.revision,
  });
  if (!opened.ok) throw new Error(opened.error.message);
  return created.data.scheduleId;
}

const closeIcu = (revision: number) =>
  closePreferenceWindow(as(actors.icuHead, LATER), {
    scheduleId: S,
    expectedRevision: revision,
  });

describe("getMyPreferencesPage and the notification deep link (21)", () => {
  it("selects the schedule of a PREFERENCES_OPENED notification and its month after authorizing it", async () => {
    await openIcu();
    const [notification] = await listNotificationsForRecipient(
      db,
      U.icuNurse1.id,
    );
    expect(notification).toMatchObject({
      type: "PREFERENCES_OPENED",
      scheduleId: S,
    });
    const view = await page(actors.icuNurse1, {
      scheduleId: notification!.scheduleId!,
    });
    expect(view.requestedNotFound).toBe(false);
    expect(view.selected?.id).toBe(S);
    expect(view.month).toEqual(ABAN);
    expect(view.schedules.map((s) => s.id)).toEqual([S]);
    expect(view.monthSchedules.map((s) => s.id)).toEqual([S]);
  });

  it("treats a foreign or unknown schedule id as not found and falls back to the default", async () => {
    await openIcu();
    const erId = await openEr();
    for (const id of [erId, UNKNOWN, "garbage"]) {
      const view = await page(actors.icuNurse1, { scheduleId: id });
      expect(view.requestedNotFound).toBe(true);
      expect(view.selected?.id).toBe(S);
      expect(view.schedules.map((s) => s.id)).toEqual([S]);
      // Never the other department's schedule of the same month.
      expect(view.monthSchedules.map((s) => s.id)).toEqual([S]);
    }
  });

  it("has no selection, on the current month, when nothing is available", async () => {
    expect(await page(actors.icuNurse1)).toEqual({
      month: MEHR,
      schedules: [],
      monthSchedules: [],
      selected: null,
      requestedNotFound: false,
    });
  });

  it("still opens a directly requested schedule that the list leaves out", async () => {
    const revision = await openIcu();
    await closeIcu(revision);
    const view = await page(
      actors.icuNurse1,
      { scheduleId: S },
      LATER,
      isoDate("2026-12-01"),
    );
    expect(view.selected?.id).toBe(S);
    expect(view.schedules).toEqual([]);
    expect(view.monthSchedules.map((s) => s.id)).toEqual([S]);
  });
});

describe("getMyPreferencesPage: month navigation", () => {
  it("defaults to the earliest month whose collection is open", async () => {
    await openIcu();
    const azar = await openIcuAzar();
    const view = await page(actors.icuNurse1);
    expect(view.month).toEqual(ABAN);
    expect(view.selected).toMatchObject({ id: S, editable: true });
    expect(view.schedules.map((s) => [s.id, s.state])).toEqual([
      [S, "OPEN"],
      [azar, "OPEN"],
    ]);
  });

  it("skips a closed month: Aban closed, Azar open → Azar", async () => {
    const revision = await openIcu();
    const azar = await openIcuAzar();
    await closeIcu(revision);
    const view = await page(actors.icuNurse1, {}, LATER);
    expect(view.month).toEqual(AZAR);
    expect(view.selected).toMatchObject({ id: azar, editable: true });
    expect(view.schedules.map((s) => [s.id, s.state])).toEqual([
      [S, "CLOSED"],
      [azar, "OPEN"],
    ]);
  });

  it("falls back to the current month when no collection is open", async () => {
    const revision = await openIcu();
    await closeIcu(revision);
    const view = await page(actors.icuNurse1, {}, LATER);
    expect(view.month).toEqual(MEHR);
    expect(view.selected).toBeNull();
    // The closed month stays reachable.
    expect(view.schedules.map((s) => [s.id, s.state])).toEqual([[S, "CLOSED"]]);
  });

  it("navigates to a closed month: read-only, saved preferences kept", async () => {
    const revision = await openIcu();
    await openIcuAzar();
    expect((await set(actors.icuNurse1, "OFF")).ok).toBe(true);
    await closeIcu(revision);
    const view = await page(actors.icuNurse1, { month: ABAN }, LATER);
    expect(view.month).toEqual(ABAN);
    expect(view.selected).toMatchObject({
      id: S,
      state: "CLOSED",
      editable: false,
      summary: { total: 1, OFF: 1 },
    });
    expect(view.selected!.days.find((d) => d.date === DAY)?.value).toBe("OFF");
  });

  it("navigates to another open month", async () => {
    await openIcu();
    const azar = await openIcuAzar();
    const view = await page(actors.icuNurse1, { month: AZAR });
    expect(view.month).toEqual(AZAR);
    expect(view.selected).toMatchObject({ id: azar, editable: true });
  });

  it("shows a month without a schedule as empty, and never another department's", async () => {
    await openIcu();
    await openEr();
    expect(
      await page(actors.icuNurse1, {
        month: { start: isoDate("2027-01-21"), end: isoDate("2027-02-19") },
      }),
    ).toMatchObject({ selected: null, monthSchedules: [] });
    const er = await page(actors.erNurse1, { month: ABAN });
    expect(er.monthSchedules.map((s) => s.departmentName)).toEqual([
      DEMO_ER.name,
    ]);
    expect(er.selected?.departmentName).toBe(DEMO_ER.name);
  });

  it("a reopened window makes the same saved preferences editable again", async () => {
    const revision = await openIcu();
    expect((await set(actors.icuNurse1, "N")).ok).toBe(true);
    await closeIcu(revision);
    const closed = await page(actors.icuNurse1, { month: ABAN }, LATER);
    expect(closed.selected?.editable).toBe(false);

    // Collection active again for the whole period (closing deleted nothing).
    await createPreferenceWindow(db, {
      scheduleId: S,
      kind: "REOPEN",
      scope: { kind: "PERIOD", dates: eachDay(ABAN.start, ABAN.end) },
      openedBy: U.icuHead.id,
    });
    const reopened = await page(actors.icuNurse1, {}, LATER);
    expect(reopened.month).toEqual(ABAN);
    expect(reopened.selected).toMatchObject({
      id: S,
      state: "OPEN",
      editable: true,
      summary: { total: 1, N: 1 },
    });
    expect(reopened.selected!.days.find((d) => d.date === DAY)).toMatchObject({
      value: "N",
      lock: null,
    });
    expect((await set(actors.icuNurse1, "E", DAY, S, LATER)).ok).toBe(true);
    expect(await rows()).toMatchObject([{ date: DAY, value: "E" }]);
  });

  it("marks official holidays from the calendar source without locking them", async () => {
    await openIcu();
    const holidays: HolidayCalendar = {
      listOfficialHolidays: async () => [
        { date: isoDate(DAY), name: "تعطیل آزمایشی" },
      ],
    };
    const view = await getMyPreferences(
      as(actors.icuNurse1),
      { scheduleId: S },
      { holidays },
    );
    expect(view.days.find((d) => d.date === DAY)).toEqual({
      date: DAY,
      value: null,
      lock: null,
      holiday: { date: DAY, name: "تعطیل آزمایشی" },
    });
    expect(view.days.filter((d) => d.holiday !== null)).toHaveLength(1);
    // No holiday data is connected by default (D41): nothing is invented.
    const plain = await getMyPreferences(as(actors.icuNurse1), {
      scheduleId: S,
    });
    expect(plain.days.every((d) => d.holiday === null)).toBe(true);
  });
});

describe("setMyPreference", () => {
  beforeEach(async () => {
    await openIcu();
  });

  it.each(["M", "E", "N", "ME"] as const)(
    "creates a %s preference (5–8) and audits it (25)",
    async (value) => {
      expect(await set(actors.icuNurse1, value)).toEqual({
        ok: true,
        data: { date: DAY, value, changed: true },
      });
      expect(await rows()).toEqual([
        { userId: U.icuNurse1.id, date: DAY, value },
      ]);
      expect(await preferenceAudit()).toEqual([
        expect.objectContaining({
          actorId: U.icuNurse1.id,
          action: "preference.created",
          entityType: "preference",
          entityId: `${U.icuNurse1.id}:${DAY}`,
          departmentId: DEMO_ICU.id,
          scheduleId: S,
          data: { date: DAY, before: null, after: value },
        }),
      ]);
    },
  );

  it("supports the existing OFF value of the preference model", async () => {
    expect((await set(actors.icuNurse1, "OFF")).ok).toBe(true);
    expect((await rows())[0]?.value).toBe("OFF");
  });

  it("replaces the old value, keeps one row and audits the change (9, 11, 26)", async () => {
    await set(actors.icuNurse1, "M");
    expect(await set(actors.icuNurse1, "E")).toMatchObject({
      ok: true,
      data: { value: "E", changed: true },
    });
    expect(await rows()).toEqual([
      { userId: U.icuNurse1.id, date: DAY, value: "E" },
    ]);
    const events = await preferenceAudit();
    expect(events.map((e) => [e.action, e.data])).toEqual([
      ["preference.created", { date: DAY, before: null, after: "M" }],
      ["preference.changed", { date: DAY, before: "M", after: "E" }],
    ]);
  });

  it("is idempotent: the same value again writes and audits nothing", async () => {
    await set(actors.icuNurse1, "N");
    expect(await set(actors.icuNurse1, "N")).toEqual({
      ok: true,
      data: { date: DAY, value: "N", changed: false },
    });
    expect(await preferenceAudit()).toHaveLength(1);
  });

  it("accepts N followed by any shift the next day: wishes are not assignments", async () => {
    expect((await set(actors.icuNurse1, "N", "2026-10-25")).ok).toBe(true);
    expect((await set(actors.icuNurse1, "M", "2026-10-26")).ok).toBe(true);
    expect((await set(actors.icuNurse1, "N", "2026-10-27")).ok).toBe(true);
    expect((await rows()).map((r) => r.value)).toEqual(["N", "M", "N"]);
  });

  it("ignores a tampered user id: the target is always the actor (12)", async () => {
    const result = await setMyPreference(as(actors.icuNurse1), {
      scheduleId: S,
      date: DAY,
      value: "M",
      userId: U.icuNurse2.id,
      nurseId: U.icuNurse2.id,
    });
    expect(result.ok).toBe(true);
    expect(await rows()).toEqual([
      { userId: U.icuNurse1.id, date: DAY, value: "M" },
    ]);
    const cleared = await clearMyPreference(as(actors.icuNurse2), {
      scheduleId: S,
      date: DAY,
      userId: U.icuNurse1.id,
    });
    expect(cleared).toMatchObject({ ok: true, data: { changed: false } });
    expect(await rows()).toHaveLength(1);
  });

  it("rejects a date outside the window scope (13)", async () => {
    expect(await set(actors.icuNurse1, "M", "2026-11-22")).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN", reason: "DATE_OUTSIDE_PERIOD" },
    });
    expect(await rows()).toEqual([]);
  });

  it("rejects malformed input", async () => {
    for (const [date, value] of [
      ["2026-02-30", "M"],
      ["25/10/2026", "M"],
      [DAY, "X"],
      [DAY, ""],
    ]) {
      expect(await set(actors.icuNurse1, value!, date)).toMatchObject({
        ok: false,
        error: { code: "VALIDATION" },
      });
    }
    expect(
      await setMyPreference(as(actors.icuNurse1), {
        scheduleId: "nope",
        date: DAY,
        value: "M",
      }),
    ).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
  });

  it.each([
    ["an unknown schedule (19)", "icuNurse1", UNKNOWN],
    ["another department's schedule (20)", "icuNurse1", "ER"],
    ["a supervisor without roster membership (18)", "supervisor", S],
  ] as const)("answers NOT_FOUND for %s", async (_, who, id) => {
    const erId = await openEr();
    expect(
      await set(actors[who], "M", DAY, id === "ER" ? erId : id),
    ).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(await rows()).toEqual([]);
  });

  it("lets the Head Nurse enter their own preference when rostered (17)", async () => {
    expect(await set(actors.icuHead, "ME")).toMatchObject({ ok: true });
    expect(await rows()).toEqual([
      { userId: U.icuHead.id, date: DAY, value: "ME" },
    ]);
  });

  it("rejects a deactivated user (16)", async () => {
    await setUserActive(db, U.icuNurse1.id, false);
    const stale = { ...actors.icuNurse1, isActive: false };
    expect(await set(stale, "M")).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN", reason: "ACTOR_INACTIVE" },
    });
    expect(await loadActor(db, U.icuNurse1.id, TODAY)).toMatchObject({
      isActive: false,
    });
    expect(await rows()).toEqual([]);
  });

  it("rejects a former member (membership ended) even though still rostered", async () => {
    await endMembership(db, {
      userId: U.icuNurse1.id,
      departmentId: DEMO_ICU.id,
      endedOn: isoDate("2026-09-30"),
    });
    const former = (await loadActor(db, U.icuNurse1.id, TODAY))!;
    expect(await set(former, "M")).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN", reason: "NOT_MEMBER_OF_DEPARTMENT" },
    });
  });

  it("rejects a write after the window closed (15), keeping stored values", async () => {
    await set(actors.icuNurse1, "M");
    await closePreferenceWindow(as(actors.icuHead, LATER), {
      scheduleId: S,
      expectedRevision: 1,
    });
    expect(await set(actors.icuNurse1, "E", DAY, S, LATER)).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN", reason: "WINDOW_CLOSED" },
    });
    expect(
      await clearMyPreference(as(actors.icuNurse1, LATER), {
        scheduleId: S,
        date: DAY,
      }),
    ).toMatchObject({ ok: false, error: { reason: "WINDOW_CLOSED" } });
    expect(await rows()).toEqual([
      { userId: U.icuNurse1.id, date: DAY, value: "M" },
    ]);
  });

  it("rejects a write after the window deadline passed", async () => {
    await db.execute(
      sql`update preference_windows set closes_at = ${LATER.toISOString()}::timestamptz`,
    );
    expect((await set(actors.icuNurse1, "M", DAY, S, NOW)).ok).toBe(true);
    expect(
      await set(actors.icuNurse1, "E", DAY, S, new Date(LATER.getTime() + 1)),
    ).toMatchObject({ ok: false, error: { reason: "WINDOW_CLOSED" } });
  });

  it("rejects a schedule frozen for review even with a stale open window", async () => {
    await db.execute(
      sql`update schedules set status = 'SUBMITTED' where id = ${S}`,
    );
    expect(await set(actors.icuNurse1, "M")).toMatchObject({
      ok: false,
      error: {
        code: "FORBIDDEN",
        reason: "SCHEDULE_NOT_ACCEPTING_PREFERENCES",
      },
    });
  });

  it("does not bump the schedule revision or notify anyone", async () => {
    const before = await listNotificationsForRecipient(db, U.icuHead.id);
    await set(actors.icuNurse1, "M");
    await clear(actors.icuNurse1);
    // The Head Nurse's close with the revision they saw still works.
    expect(
      (
        await closePreferenceWindow(as(actors.icuHead, LATER), {
          scheduleId: S,
          expectedRevision: 1,
        })
      ).ok,
    ).toBe(true);
    expect(await listNotificationsForRecipient(db, U.icuHead.id)).toEqual(
      before,
    );
  });

  it("rolls the preference and its audit event back together (28)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await db.execute(
      sql`alter table audit_events add constraint test_reject_preferences check (action not like 'preference.%') not valid`,
    );
    try {
      expect((await set(actors.icuNurse1, "M")).ok).toBe(false);
    } finally {
      await db.execute(
        sql`alter table audit_events drop constraint test_reject_preferences`,
      );
    }
    expect(await rows()).toEqual([]);
    expect(await preferenceAudit()).toEqual([]);
    log.mockRestore();
  });
});

describe("window nurse scope", () => {
  it("rejects a nurse outside the window's nurse scope as NOT_FOUND (14)", async () => {
    await openIcu({ nurseIds: [U.icuNurse2.id] });
    expect(await set(actors.icuNurse1, "M")).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
    expect((await set(actors.icuNurse2, "M")).ok).toBe(true);
  });

  it("rejects a date outside a narrower window as DATE_NOT_IN_WINDOW", async () => {
    await openIcu({
      scope: { kind: "RANGE", from: "2026-10-23", to: "2026-10-31" },
    });
    expect(await set(actors.icuNurse1, "M", "2026-11-05")).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN", reason: "DATE_NOT_IN_WINDOW" },
    });
  });
});

describe("clearMyPreference", () => {
  beforeEach(async () => {
    await openIcu();
  });

  it("removes the row and audits the old value (10, 27)", async () => {
    await set(actors.icuNurse1, "N");
    expect(await clear(actors.icuNurse1)).toEqual({
      ok: true,
      data: { date: DAY, value: null, changed: true },
    });
    expect(await rows()).toEqual([]);
    expect((await preferenceAudit()).at(-1)).toMatchObject({
      actorId: U.icuNurse1.id,
      action: "preference.cleared",
      data: { date: DAY, before: "N", after: null },
    });
  });

  it("is a no-op without a stored preference", async () => {
    expect(await clear(actors.icuNurse1)).toEqual({
      ok: true,
      data: { date: DAY, value: null, changed: false },
    });
    expect(await preferenceAudit()).toEqual([]);
  });

  it("never touches another nurse's row", async () => {
    await set(actors.icuNurse2, "E");
    await clear(actors.icuNurse1);
    expect(await rows()).toEqual([
      { userId: U.icuNurse2.id, date: DAY, value: "E" },
    ]);
  });
});

describe("concurrency", () => {
  beforeEach(async () => {
    await openIcu();
  });

  it("concurrent edits from several tabs leave one row and a consistent audit trail (23)", async () => {
    const values = ["M", "E", "N", "ME", "M", "E", "N", "ME"] as const;
    const results = await Promise.all(
      values.map((v) => set(actors.icuNurse1, v)),
    );
    expect(results.every((r) => r.ok)).toBe(true);

    const stored = await rows();
    expect(stored).toHaveLength(1);
    const events = await preferenceAudit();
    // Serialized per nurse: one create, then each real change chains on the last.
    expect(events[0]?.action).toBe("preference.created");
    events.slice(1).forEach((e, i) => {
      expect(e.action).toBe("preference.changed");
      expect(e.data.before).toBe(events[i]!.data.after);
    });
    expect(events.at(-1)?.data.after).toBe(stored[0]!.value);
  });

  it("does not block or disturb other nurses writing at the same time", async () => {
    const results = await Promise.all([
      set(actors.icuNurse1, "M"),
      set(actors.icuNurse2, "N"),
      set(actors.icuHead, "E"),
      clear(actors.icuNurse1, "2026-10-26"),
    ]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(await rows()).toHaveLength(3);
  });

  it("a save waiting on a closing transaction is rejected once the close commits (24)", async () => {
    let save: ReturnType<typeof set> | undefined;
    await db.transaction(async (tx) => {
      // The Head Nurse's close holds the schedule row lock...
      const schedule = (await lockScheduleForUpdate(tx, S))!;
      // ...while a nurse's stale tab submits a preference.
      save = set(actors.icuNurse1, "M", DAY, S, LATER);
      await vi.waitFor(
        async () => {
          const { rows: waiting } = await db.execute<{ n: number }>(sql`
            select count(*)::int as n from pg_stat_activity
            where datname = current_database() and wait_event_type = 'Lock'
          `);
          expect(waiting[0]!.n).toBeGreaterThan(0);
        },
        { timeout: 5_000, interval: 20 },
      );
      await closeOpenPreferenceWindows(tx, {
        scheduleId: S,
        closedBy: U.icuHead.id,
        now: LATER,
      });
      await updateSchedule(tx, { id: S, expectedRevision: schedule.revision });
    });

    expect(await save).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN", reason: "WINDOW_CLOSED" },
    });
    expect(await rows()).toEqual([]);
    expect(await preferenceAudit()).toEqual([]);
  });

  it("racing saves and the real close: nothing is written after the close (24)", async () => {
    const dates = Array.from(
      { length: 12 },
      (_, i) => `2026-10-${String(23 + (i % 9)).padStart(2, "0")}`,
    );
    const saves = dates.map((date, i) =>
      set(i % 2 ? actors.icuNurse1 : actors.icuNurse2, "M", date, S, LATER),
    );
    const close = closePreferenceWindow(as(actors.icuHead, LATER), {
      scheduleId: S,
      expectedRevision: 1,
    });
    const [closed, ...results] = await Promise.all([close, ...saves]);
    expect(closed.ok).toBe(true);

    for (const r of results)
      if (!r.ok)
        expect(r.error).toMatchObject({
          code: "FORBIDDEN",
          reason: "WINDOW_CLOSED",
        });

    const events = await listAuditEventsForSchedule(db, S);
    const closeEvent = events.find(
      (e) => e.action === "schedule.preferencesClosed",
    )!;
    const writes = events.filter((e) => e.action.startsWith("preference."));
    // Every committed save precedes the close; none follows it.
    expect(writes.every((e) => e.id < closeEvent.id)).toBe(true);
    expect(writes).toHaveLength(
      results.filter((r) => r.ok && r.data.changed).length,
    );
    // And afterwards every save is rejected.
    expect(await set(actors.icuNurse1, "E", DAY, S, LATER)).toMatchObject({
      ok: false,
      error: { reason: "WINDOW_CLOSED" },
    });
  });
});
