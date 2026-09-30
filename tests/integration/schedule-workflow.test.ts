import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Actor } from "../../src/domain/authz/actor";
import { canEditPreference } from "../../src/domain/preferences/can-edit-preference";
import { isoDate } from "../../src/domain/shared/dates";
import { NotFoundError } from "../../src/application/errors";
import { createSchedule } from "../../src/application/schedules/create-schedule";
import {
  closePreferenceWindow,
  openPreferenceWindow,
} from "../../src/application/schedules/preference-windows";
import { getDepartmentSchedules } from "../../src/application/schedules/queries";
import type { AppContext } from "../../src/application/use-case";
import {
  DEMO_ER,
  DEMO_ICU,
  DEMO_SCHEDULE,
  DEMO_USERS,
} from "../../src/infrastructure/db/seed/demo-data";
import { listAuditEventsForSchedule } from "../../src/infrastructure/repositories/audit";
import {
  addMembership,
  endMembership,
  loadActor,
} from "../../src/infrastructure/repositories/memberships";
import { listNotificationsForRecipient } from "../../src/infrastructure/repositories/notifications";
import { listPreferenceWindows } from "../../src/infrastructure/repositories/preference-windows";
import {
  isOnRoster,
  listRoster,
} from "../../src/infrastructure/repositories/roster";
import {
  findScheduleById,
  listSchedulesForDepartment,
} from "../../src/infrastructure/repositories/schedules";
import { createUser } from "../../src/infrastructure/repositories/users";
import { setupTestDatabase } from "./support/database";

const { db } = setupTestDatabase();
const U = DEMO_USERS;
const S = DEMO_SCHEDULE.id;
const TODAY = isoDate("2026-10-01");
const NOW = new Date("2026-10-01T06:30:00Z");

const actors = {} as Record<
  "icuHead" | "erHead" | "icuNurse" | "supervisor",
  Actor
>;
const as = (actor: Actor, at: Date = NOW): AppContext => ({
  db,
  actor,
  clock: () => at,
});

beforeEach(async () => {
  actors.icuHead = (await loadActor(db, U.icuHead.id, TODAY))!;
  actors.erHead = (await loadActor(db, U.erHead.id, TODAY))!;
  actors.icuNurse = (await loadActor(db, U.icuNurse1.id, TODAY))!;
  actors.supervisor = (await loadActor(db, U.supervisor.id, TODAY))!;
});

const counts = async () => {
  const { rows } = await db.execute<{
    schedules: number;
    roster: number;
    windows: number;
    audit: number;
    notifications: number;
  }>(sql`
    select (select count(*)::int from schedules) as schedules,
           (select count(*)::int from schedule_roster) as roster,
           (select count(*)::int from preference_windows) as windows,
           (select count(*)::int from audit_events) as audit,
           (select count(*)::int from notifications) as notifications
  `);
  return rows[0]!;
};

const ER_ABAN = {
  departmentId: DEMO_ER.id,
  periodStart: "2026-10-23",
  periodEnd: "2026-11-21",
  label: "آبان ۱۴۰۵",
};

const createFor = (actor: Actor, input: Partial<typeof ER_ABAN> = {}) =>
  createSchedule(as(actor), { ...ER_ABAN, ...input });

describe("createSchedule", () => {
  it("lets the Head Nurse create a DRAFT schedule with a roster snapshot and an audit event", async () => {
    const result = await createFor(actors.erHead);

    expect(result).toEqual({
      ok: true,
      data: {
        scheduleId: expect.any(String),
        revision: 0,
        roster: { total: 4, nurses: 3, headNurses: 1 },
      },
    });
    const id = result.ok ? result.data.scheduleId : "";
    expect(await findScheduleById(db, id)).toMatchObject({
      departmentId: DEMO_ER.id,
      period: { start: "2026-10-23", end: "2026-11-21" },
      label: "آبان ۱۴۰۵",
      status: "DRAFT",
      revision: 0,
      createdBy: U.erHead.id,
    });

    const events = await listAuditEventsForSchedule(db, id);
    expect(events).toEqual([
      expect.objectContaining({
        actorId: U.erHead.id,
        action: "schedule.created",
        entityType: "schedule",
        entityId: id,
        departmentId: DEMO_ER.id,
        scheduleId: id,
        data: {
          periodStart: "2026-10-23",
          periodEnd: "2026-11-21",
          label: "آبان ۱۴۰۵",
          status: "DRAFT",
          roster: { total: 4, nurses: 3, headNurses: 1 },
        },
      }),
    ]);
  });

  it.each([
    ["a nurse", "icuNurse", DEMO_ICU.id, "NOT_HEAD_NURSE_OF_DEPARTMENT"],
    [
      "a supervisor without Head Nurse membership",
      "supervisor",
      DEMO_ICU.id,
      "NOT_HEAD_NURSE_OF_DEPARTMENT",
    ],
    [
      "another department's Head Nurse",
      "icuHead",
      DEMO_ER.id,
      "NOT_HEAD_NURSE_OF_DEPARTMENT",
    ],
  ] as const)("forbids %s", async (_, who, departmentId, reason) => {
    const before = await counts();
    const result = await createFor(actors[who], {
      departmentId,
      periodStart: "2026-12-22",
      periodEnd: "2027-01-20",
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN", reason },
    });
    expect(await counts()).toEqual(before);
  });

  it("forbids a deactivated Head Nurse even with a stale actor", async () => {
    const result = await createFor({ ...actors.erHead, isActive: false });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN", reason: "ACTOR_INACTIVE" },
    });
  });

  it.each([
    ["end before start", "2026-11-21", "2026-10-23", "periodEnd"],
    ["an impossible date", "2026-02-30", "2026-03-20", "periodStart"],
    [
      "a Jalali string instead of an ISO date",
      "1405/08/01",
      "2026-11-21",
      "periodStart",
    ],
    ["more than 62 days", "2026-10-23", "2026-12-31", "periodEnd"],
  ])("rejects %s", async (_, periodStart, periodEnd, field) => {
    const before = await counts();
    const result = await createFor(actors.erHead, { periodStart, periodEnd });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION");
      expect(result.error.fieldErrors).toHaveProperty(field);
    }
    expect(await counts()).toEqual(before);
  });

  it("rejects malformed input before touching the database", async () => {
    const result = await createSchedule(as(actors.erHead), {
      departmentId: "not-a-uuid",
      periodStart: "2026-10-23",
      periodEnd: "2026-11-21",
      label: "",
    });
    expect(result).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
    if (!result.ok)
      expect(Object.keys(result.error.fieldErrors ?? {})).toEqual([
        "departmentId",
        "label",
      ]);
  });

  it("rejects a period overlapping an existing schedule of the department (CONFLICT, nothing written)", async () => {
    const before = await counts();
    // ICU already has Aban 1405 (2026-10-23..2026-11-21).
    for (const [periodStart, periodEnd] of [
      ["2026-10-23", "2026-11-21"],
      ["2026-11-21", "2026-12-20"],
      ["2026-10-01", "2026-10-23"],
      ["2026-11-01", "2026-11-10"],
    ]) {
      const result = await createFor(actors.icuHead, {
        departmentId: DEMO_ICU.id,
        periodStart,
        periodEnd,
      });
      expect(result, `${periodStart}..${periodEnd}`).toMatchObject({
        ok: false,
        error: { code: "CONFLICT" },
      });
    }
    expect(await counts()).toEqual(before);
  });

  it("accepts periods adjacent to an existing one, before and after", async () => {
    const mehr = await createFor(actors.icuHead, {
      departmentId: DEMO_ICU.id,
      periodStart: "2026-09-23",
      periodEnd: "2026-10-22",
      label: "مهر ۱۴۰۵",
    });
    const azar = await createFor(actors.icuHead, {
      departmentId: DEMO_ICU.id,
      periodStart: "2026-11-22",
      periodEnd: "2026-12-21",
      label: "آذر ۱۴۰۵",
    });
    expect(mehr.ok && azar.ok).toBe(true);
    expect(
      (await listSchedulesForDepartment(db, DEMO_ICU.id)).map((s) => s.label),
    ).toEqual(["مهر ۱۴۰۵", "آبان ۱۴۰۵", "آذر ۱۴۰۵"]);
  });

  it("lets different departments use the same period", async () => {
    expect((await createFor(actors.erHead)).ok).toBe(true);
  });

  it("creates exactly one schedule when two requests race for the same period", async () => {
    const results = await Promise.all([
      createFor(actors.erHead),
      createFor(actors.erHead),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({
      ok: false,
      error: { code: "CONFLICT" },
    });
    expect(await listSchedulesForDepartment(db, DEMO_ER.id)).toHaveLength(1);
  });

  it("rolls back the schedule and roster when no member is effective in the period", async () => {
    const before = await counts();
    // Every demo membership starts on 2026-01-01.
    const result = await createFor(actors.erHead, {
      periodStart: "2025-10-23",
      periodEnd: "2025-11-21",
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "VALIDATION", fieldErrors: { period: expect.any(Array) } },
    });
    expect(await counts()).toEqual(before);
  });
});

describe("roster snapshot on creation", () => {
  const rosterOf = async (input: Partial<typeof ER_ABAN>) => {
    const result = await createFor(actors.erHead, input);
    if (!result.ok) throw new Error(result.error.message);
    return result.data.scheduleId;
  };

  it("includes active members and the Head Nurse, excludes other departments", async () => {
    const id = await rosterOf({});
    const roster = await listRoster(db, id);
    expect(roster.map((r) => r.userId).sort()).toEqual(
      [U.erHead.id, U.erNurse1.id, U.erNurse2.id, U.erNurse3.id].sort(),
    );
    expect(roster.find((r) => r.userId === U.erHead.id)?.role).toBe(
      "HEAD_NURSE",
    );
  });

  it("includes a fixed-term member who overlaps only part of the period", async () => {
    await addMembership(db, {
      userId: U.icuNurse4.id,
      departmentId: DEMO_ER.id,
      role: "NURSE",
      startedOn: isoDate("2026-11-05"),
      endedOn: isoDate("2026-11-10"),
    });
    const id = await rosterOf({});
    expect(await isOnRoster(db, id, U.icuNurse4.id)).toBe(true);
  });

  it("includes a member who leaves on the first day or joins on the last day", async () => {
    const joiner = await createUser(db, {
      email: "joiner@demo.invalid",
      displayName: "تازه‌وارد نمونه",
    });
    await addMembership(db, {
      userId: joiner.id,
      departmentId: DEMO_ER.id,
      role: "NURSE",
      startedOn: isoDate("2026-11-21"),
    });
    await endMembership(db, {
      userId: U.erNurse1.id,
      departmentId: DEMO_ER.id,
      endedOn: isoDate("2026-10-23"),
    });
    const id = await rosterOf({});
    expect(await isOnRoster(db, id, joiner.id)).toBe(true);
    expect(await isOnRoster(db, id, U.erNurse1.id)).toBe(true);
  });

  it("excludes memberships entirely outside the period", async () => {
    // The transfer nurse left ER on 2026-09-22 (before Aban).
    const aban = await rosterOf({});
    expect(await isOnRoster(db, aban, U.transferNurse.id)).toBe(false);
    // ...but was an ER member during Shahrivar 1405.
    const shahrivar = await rosterOf({
      periodStart: "2026-08-23",
      periodEnd: "2026-09-22",
      label: "شهریور ۱۴۰۵",
    });
    expect(await isOnRoster(db, shahrivar, U.transferNurse.id)).toBe(true);
  });

  it("is not changed by later membership changes", async () => {
    const id = await rosterOf({});
    const before = await listRoster(db, id);

    await endMembership(db, {
      userId: U.erNurse2.id,
      departmentId: DEMO_ER.id,
      endedOn: isoDate("2026-10-01"),
    });
    await addMembership(db, {
      userId: U.icuNurse3.id,
      departmentId: DEMO_ER.id,
      role: "NURSE",
      startedOn: isoDate("2026-10-25"),
    });

    expect(await listRoster(db, id)).toEqual(before);
  });
});

describe("openPreferenceWindow", () => {
  const open = (actor: Actor, input: Record<string, unknown> = {}) =>
    openPreferenceWindow(as(actor), {
      scheduleId: S,
      expectedRevision: 0,
      ...input,
    });

  it("opens the whole period for the whole roster by default (DRAFT → PLANNING)", async () => {
    const result = await open(actors.icuHead);
    expect(result).toEqual({
      ok: true,
      data: { revision: 1, windowIds: [expect.any(String)] },
    });

    expect(await findScheduleById(db, S)).toMatchObject({
      status: "PLANNING",
      revision: 1,
    });
    const [window] = await listPreferenceWindows(db, S);
    expect(window).toMatchObject({
      kind: "INITIAL",
      scopeKind: "PERIOD",
      openedBy: U.icuHead.id,
      openedAt: NOW,
      closedAt: null,
    });
    expect(window!.dates.size).toBe(30);
    expect(window!.nurseIds.size).toBe(0);

    const events = await listAuditEventsForSchedule(db, S);
    expect(events).toEqual([
      expect.objectContaining({
        actorId: U.icuHead.id,
        action: "schedule.preferencesOpened",
        departmentId: DEMO_ICU.id,
        scheduleId: S,
        entityId: window!.id,
        data: expect.objectContaining({
          scopeKind: "PERIOD",
          firstDate: "2026-10-23",
          lastDate: "2026-11-21",
          dateCount: 30,
          nurseScope: "ROSTER",
          from: "DRAFT",
          to: "PLANNING",
        }),
      }),
    ]);
  });

  it("notifies every rostered nurse except the Head Nurse who opened it", async () => {
    await open(actors.icuHead);
    const [mine] = await listNotificationsForRecipient(db, U.icuNurse1.id);
    expect(mine).toMatchObject({
      type: "PREFERENCES_OPENED",
      scheduleId: S,
      data: {
        label: "آبان ۱۴۰۵",
        firstDate: "2026-10-23",
        lastDate: "2026-11-21",
      },
    });
    expect(await listNotificationsForRecipient(db, U.icuHead.id)).toEqual([]);
    expect((await counts()).notifications).toBe(5);
  });

  it("supports a narrower date and nurse scope inside the period and roster", async () => {
    const result = await open(actors.icuHead, {
      scope: { kind: "RANGE", from: "2026-10-24", to: "2026-10-30" },
      nurseIds: [U.icuNurse2.id, U.icuNurse1.id, U.icuNurse1.id],
    });
    expect(result.ok).toBe(true);
    const [window] = await listPreferenceWindows(db, S);
    expect(window!.scopeKind).toBe("RANGE");
    expect(window!.dates.size).toBe(7);
    expect([...window!.nurseIds].sort()).toEqual(
      [U.icuNurse1.id, U.icuNurse2.id].sort(),
    );
    expect((await counts()).notifications).toBe(2);
  });

  it.each([
    ["a nurse", "icuNurse"],
    ["a supervisor", "supervisor"],
    ["another department's Head Nurse", "erHead"],
  ] as const)("forbids %s and changes nothing", async (_, who) => {
    const before = await counts();
    expect(await open(actors[who])).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    // Even with a stale revision the outsider gets FORBIDDEN, not CONFLICT.
    expect(await open(actors[who], { expectedRevision: 7 })).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    expect(await counts()).toEqual(before);
    expect((await findScheduleById(db, S))!.status).toBe("DRAFT");
  });

  it.each([
    [{ kind: "RANGE", from: "2026-10-20", to: "2026-10-30" }, "from"],
    [{ kind: "RANGE", from: "2026-11-15", to: "2026-11-22" }, "to"],
    [{ kind: "DAY", date: "2026-11-22" }, "date"],
    [{ kind: "DAYS", dates: ["2026-10-25", "2026-12-01"] }, "dates"],
    [{ kind: "DAYS", dates: [] }, "dates"],
  ])("rejects window dates outside the schedule: %o", async (scope, field) => {
    const before = await counts();
    const result = await open(actors.icuHead, { scope });
    expect(result).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
    if (!result.ok) expect(result.error.fieldErrors).toHaveProperty(field);
    expect(await counts()).toEqual(before);
  });

  it("rejects nurses who are not on the schedule roster", async () => {
    const before = await counts();
    for (const outsider of [
      U.erNurse1.id,
      U.inactiveNurse.id,
      U.supervisor.id,
    ]) {
      const result = await open(actors.icuHead, {
        nurseIds: [U.icuNurse1.id, outsider],
      });
      expect(result).toMatchObject({
        ok: false,
        error: {
          code: "VALIDATION",
          fieldErrors: { nurseIds: expect.any(Array) },
        },
      });
    }
    expect(await counts()).toEqual(before);
  });

  it("does not open twice: a repeat is INVALID_STATE, a stale repeat CONFLICT", async () => {
    expect((await open(actors.icuHead)).ok).toBe(true);
    expect(await open(actors.icuHead, { expectedRevision: 1 })).toMatchObject({
      ok: false,
      error: { code: "INVALID_STATE" },
    });
    expect(await open(actors.icuHead)).toMatchObject({
      ok: false,
      error: { code: "CONFLICT" },
    });
    expect(await listPreferenceWindows(db, S)).toHaveLength(1);
  });

  it("resolves concurrent opens from two tabs to one window and one CONFLICT", async () => {
    const results = await Promise.all([
      open(actors.icuHead),
      open(actors.icuHead),
      open(actors.icuHead),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    for (const failed of results.filter((r) => !r.ok))
      expect(failed).toMatchObject({ error: { code: "CONFLICT" } });
    expect(await listPreferenceWindows(db, S)).toHaveLength(1);
    expect(await counts()).toMatchObject({ windows: 1, audit: 1 });
    expect(await findScheduleById(db, S)).toMatchObject({
      status: "PLANNING",
      revision: 1,
    });
  });

  it("returns CONFLICT for a stale revision and changes nothing", async () => {
    const before = await counts();
    expect(await open(actors.icuHead, { expectedRevision: 3 })).toMatchObject({
      ok: false,
      error: { code: "CONFLICT" },
    });
    expect(await counts()).toEqual(before);
  });

  it("returns NOT_FOUND for an unknown schedule", async () => {
    expect(
      await open(actors.icuHead, {
        scheduleId: "30000000-0000-4000-8000-00000000ffff",
      }),
    ).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });

  it("rolls back status, window, audit and notifications when a later write fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const before = await counts();
    // Make the last write of the transaction (the notifications) fail.
    await db.execute(
      sql`alter table notifications add constraint test_reject_all check (recipient_id is null) not valid`,
    );
    try {
      const result = await open(actors.icuHead);
      expect(result.ok).toBe(false);
    } finally {
      await db.execute(
        sql`alter table notifications drop constraint test_reject_all`,
      );
    }
    expect(await counts()).toEqual(before);
    expect(await findScheduleById(db, S)).toMatchObject({
      status: "DRAFT",
      revision: 0,
    });
    log.mockRestore();
  });
});

describe("closePreferenceWindow", () => {
  const openInitial = async () => {
    const result = await openPreferenceWindow(as(actors.icuHead), {
      scheduleId: S,
      expectedRevision: 0,
    });
    if (!result.ok) throw new Error(result.error.message);
    return result.data;
  };
  const LATER = new Date("2026-10-05T10:00:00Z");
  const close = (actor: Actor, expectedRevision: number) =>
    closePreferenceWindow(as(actor, LATER), {
      scheduleId: S,
      expectedRevision,
    });

  it("closes the open window, bumps the revision, audits and keeps the status", async () => {
    const opened = await openInitial();
    const result = await close(actors.icuHead, opened.revision);
    expect(result).toEqual({
      ok: true,
      data: { revision: 2, windowIds: opened.windowIds },
    });

    const [window] = await listPreferenceWindows(db, S);
    expect(window).toMatchObject({ closedAt: LATER, closedBy: U.icuHead.id });
    expect(await findScheduleById(db, S)).toMatchObject({
      status: "PLANNING",
      revision: 2,
    });
    const events = await listAuditEventsForSchedule(db, S);
    expect(events.map((e) => e.action)).toEqual([
      "schedule.preferencesOpened",
      "schedule.preferencesClosed",
    ]);
    expect(events[1]).toMatchObject({
      actorId: U.icuHead.id,
      departmentId: DEMO_ICU.id,
      data: {
        windowIds: opened.windowIds,
        periodStart: "2026-10-23",
        periodEnd: "2026-11-21",
        status: "PLANNING",
      },
    });
  });

  it("stops nurses from editing preferences once closed", async () => {
    const opened = await openInitial();
    const schedule = (await findScheduleById(db, S))!;
    const editable = async (now: Date) =>
      canEditPreference({
        nurseId: U.icuNurse1.id,
        date: isoDate("2026-10-30"),
        schedule,
        onRoster: true,
        windows: await listPreferenceWindows(db, S),
        now,
      }).allowed;

    expect(await editable(NOW)).toBe(true);
    await close(actors.icuHead, opened.revision);
    expect(await editable(new Date("2026-10-06T00:00:00Z"))).toBe(false);
  });

  it("is INVALID_STATE when nothing is open (never opened or already closed)", async () => {
    expect(await close(actors.icuHead, 0)).toMatchObject({
      ok: false,
      error: { code: "INVALID_STATE" },
    });
    const opened = await openInitial();
    expect((await close(actors.icuHead, opened.revision)).ok).toBe(true);
    expect(await close(actors.icuHead, 2)).toMatchObject({
      ok: false,
      error: { code: "INVALID_STATE" },
    });
  });

  it("returns CONFLICT to a tab holding a stale revision", async () => {
    const opened = await openInitial();
    const [first, second] = await Promise.all([
      close(actors.icuHead, opened.revision),
      close(actors.icuHead, opened.revision),
    ]);
    expect([first.ok, second.ok].sort()).toEqual([false, true]);
    expect([first, second].find((r) => !r.ok)).toMatchObject({
      error: { code: "CONFLICT" },
    });
    expect((await counts()).audit).toBe(2);
  });

  it.each([
    ["a nurse", "icuNurse"],
    ["a supervisor", "supervisor"],
    ["another department's Head Nurse", "erHead"],
  ] as const)("forbids %s", async (_, who) => {
    const opened = await openInitial();
    expect(await close(actors[who], opened.revision)).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    expect((await listPreferenceWindows(db, S))[0]!.closedAt).toBeNull();
  });
});

describe("getDepartmentSchedules", () => {
  const query = (
    actor: Actor,
    departmentId = DEMO_ICU.id,
    scheduleId?: string,
  ) =>
    getDepartmentSchedules(as(actor), {
      departmentId,
      scheduleId,
      today: TODAY,
    });

  it("summarises the current schedule for its Head Nurse", async () => {
    const view = await query(actors.icuHead);
    expect(view.schedules).toHaveLength(1);
    expect(view.selected).toMatchObject({
      id: S,
      label: "آبان ۱۴۰۵",
      status: "DRAFT",
      revision: 0,
      dayCount: 30,
      roster: { total: 6, nurses: 5, headNurses: 1 },
      preferences: { state: "NONE", windows: [] },
      actions: { openPreferences: true, closePreferences: false },
    });
  });

  it("follows the window through open and closed", async () => {
    await openPreferenceWindow(as(actors.icuHead), {
      scheduleId: S,
      expectedRevision: 0,
    });
    const open = (await query(actors.icuHead)).selected!;
    expect(open.preferences.state).toBe("OPEN");
    expect(open.actions).toEqual({
      openPreferences: false,
      closePreferences: true,
    });
    expect(open.preferences.windows[0]).toMatchObject({
      active: true,
      coversWholePeriod: true,
      allRoster: true,
      nurseCount: 6,
      firstDate: "2026-10-23",
      lastDate: "2026-11-21",
      openedBy: U.icuHead.displayName,
      closedBy: null,
    });

    await closePreferenceWindow(as(actors.icuHead), {
      scheduleId: S,
      expectedRevision: 1,
    });
    const closed = (await query(actors.icuHead)).selected!;
    expect(closed.preferences.state).toBe("CLOSED");
    expect(closed.actions).toEqual({
      openPreferences: false,
      closePreferences: false,
    });
    expect(closed.preferences.windows[0]).toMatchObject({
      active: false,
      closedBy: U.icuHead.displayName,
    });
  });

  it("returns no selection for a department without schedules", async () => {
    expect(await query(actors.erHead, DEMO_ER.id)).toEqual({
      schedules: [],
      selected: null,
      canCreate: true,
    });
  });

  it("never selects another department's schedule by id", async () => {
    const view = await query(actors.erHead, DEMO_ER.id, S);
    expect(view.selected).toBeNull();
  });

  it("prefers the current or next schedule over past ones", async () => {
    await createFor(actors.icuHead, {
      departmentId: DEMO_ICU.id,
      periodStart: "2026-08-23",
      periodEnd: "2026-09-22",
      label: "شهریور ۱۴۰۵",
    });
    expect((await query(actors.icuHead)).selected!.label).toBe("آبان ۱۴۰۵");
  });

  it.each([
    ["a nurse", "icuNurse", DEMO_ICU.id],
    ["a supervisor", "supervisor", DEMO_ICU.id],
    ["another department's Head Nurse", "erHead", DEMO_ICU.id],
  ] as const)("hides the page from %s (NotFound)", async (_, who, dept) => {
    await expect(query(actors[who], dept)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
