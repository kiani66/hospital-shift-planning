import { describe, expect, it } from "vitest";

import { canEditPreference } from "../../src/domain/preferences/can-edit-preference";
import { countActiveWindows } from "../../src/domain/preferences/preference-window";
import { expandDateScope } from "../../src/domain/scope/date-scope";
import { isoDate } from "../../src/domain/shared/dates";
import {
  DEMO_SCHEDULE,
  DEMO_USERS,
} from "../../src/infrastructure/db/seed/demo-data";
import {
  clearPreference,
  listPreferences,
  setPreference,
} from "../../src/infrastructure/repositories/preferences";
import {
  closeOpenPreferenceWindows,
  createPreferenceWindow,
  listPreferenceWindows,
} from "../../src/infrastructure/repositories/preference-windows";
import { findScheduleById } from "../../src/infrastructure/repositories/schedules";
import { setupTestDatabase } from "./support/database";

const { db } = setupTestDatabase();
const U = DEMO_USERS;
const S = DEMO_SCHEDULE.id;
const day = isoDate("2026-10-25");

describe("nurse preferences", () => {
  it("stores one preference per nurse and day; setting again replaces it", async () => {
    await setPreference(db, {
      scheduleId: S,
      userId: U.icuNurse1.id,
      date: day,
      value: "N",
    });
    await setPreference(db, {
      scheduleId: S,
      userId: U.icuNurse1.id,
      date: day,
      value: "OFF",
    });
    expect(await listPreferences(db, S)).toEqual([
      { userId: U.icuNurse1.id, date: "2026-10-25", value: "OFF" },
    ]);
  });

  it.each(["M", "E", "N", "ME", "OFF"] as const)(
    "accepts %s",
    async (value) => {
      await setPreference(db, {
        scheduleId: S,
        userId: U.icuNurse2.id,
        date: day,
        value,
      });
      expect(
        (await listPreferences(db, S, { userId: U.icuNurse2.id }))[0]?.value,
      ).toBe(value);
    },
  );

  it("filters by nurse and clears", async () => {
    await setPreference(db, {
      scheduleId: S,
      userId: U.icuNurse1.id,
      date: day,
      value: "M",
    });
    await setPreference(db, {
      scheduleId: S,
      userId: U.icuNurse2.id,
      date: day,
      value: "E",
    });
    expect(
      await listPreferences(db, S, { userId: U.icuNurse2.id }),
    ).toHaveLength(1);
    expect(
      await clearPreference(db, {
        scheduleId: S,
        userId: U.icuNurse2.id,
        date: day,
      }),
    ).toBe(true);
    expect(
      await clearPreference(db, {
        scheduleId: S,
        userId: U.icuNurse2.id,
        date: day,
      }),
    ).toBe(false);
    expect(await listPreferences(db, S)).toHaveLength(1);
  });

  it("rejects preferences from nurses who are not on the roster", async () => {
    await expect(
      setPreference(db, {
        scheduleId: S,
        userId: U.erNurse1.id,
        date: day,
        value: "M",
      }),
    ).rejects.toThrow();
  });
});

describe("preference windows", () => {
  const period = {
    start: isoDate(DEMO_SCHEDULE.periodStart),
    end: isoDate(DEMO_SCHEDULE.periodEnd),
  };

  it("round-trips an INITIAL whole-period window as a domain window", async () => {
    const scope = expandDateScope({ kind: "PERIOD" }, period);
    if (!scope.ok) throw scope.error;
    await createPreferenceWindow(db, {
      scheduleId: S,
      kind: "INITIAL",
      scope: scope.value,
      openedBy: U.icuHead.id,
    });

    const [window] = await listPreferenceWindows(db, S);
    expect(window).toMatchObject({
      kind: "INITIAL",
      scopeKind: "PERIOD",
      closedAt: null,
      closesAt: null,
    });
    expect(window!.dates.size).toBe(30);
    expect(window!.nurseIds.size).toBe(0);
    expect([...window!.dates][0]).toBe("2026-10-23");
  });

  it("round-trips a targeted REOPEN window and feeds canEditPreference", async () => {
    const scope = expandDateScope(
      { kind: "DAYS", dates: ["2026-11-19", "2026-11-20"] },
      period,
    );
    if (!scope.ok) throw scope.error;
    await createPreferenceWindow(db, {
      scheduleId: S,
      kind: "REOPEN",
      scope: scope.value,
      nurseIds: [U.icuNurse1.id, U.icuNurse2.id],
      reason: "Coordinated swap",
      closesAt: new Date("2026-11-01T20:30:00Z"),
      openedBy: U.icuHead.id,
    });
    const windows = await listPreferenceWindows(db, S);
    expect(windows[0]).toMatchObject({
      kind: "REOPEN",
      scopeKind: "DAYS",
      reason: "Coordinated swap",
    });
    expect(windows[0]!.closesAt).toEqual(new Date("2026-11-01T20:30:00Z"));

    const schedule = {
      ...(await findScheduleById(db, S))!,
      status: "FINALIZED" as const,
    };
    const now = new Date("2026-10-30T08:00:00Z");
    const check = (nurseId: string, date: string) =>
      canEditPreference({
        nurseId,
        date: isoDate(date),
        schedule,
        onRoster: true,
        windows,
        now,
      }).allowed;
    expect(check(U.icuNurse1.id, "2026-11-19")).toBe(true);
    expect(check(U.icuNurse3.id, "2026-11-19")).toBe(false);
    expect(check(U.icuNurse1.id, "2026-11-18")).toBe(false);
  });

  it("closes all open windows at once", async () => {
    const scope = expandDateScope(
      { kind: "WEEK", anyDateInWeek: "2026-10-28" },
      period,
    );
    if (!scope.ok) throw scope.error;
    await createPreferenceWindow(db, {
      scheduleId: S,
      kind: "INITIAL",
      scope: scope.value,
      openedBy: U.icuHead.id,
    });
    await createPreferenceWindow(db, {
      scheduleId: S,
      kind: "REOPEN",
      scope: scope.value,
      openedBy: U.icuHead.id,
    });
    const now = new Date("2026-10-30T08:00:00Z");
    expect(countActiveWindows(await listPreferenceWindows(db, S), now)).toBe(2);

    expect(
      await closeOpenPreferenceWindows(db, {
        scheduleId: S,
        closedBy: U.icuHead.id,
        now,
      }),
    ).toBe(2);
    expect(
      await closeOpenPreferenceWindows(db, {
        scheduleId: S,
        closedBy: U.icuHead.id,
        now,
      }),
    ).toBe(0);
    expect(countActiveWindows(await listPreferenceWindows(db, S), now)).toBe(0);
  });

  it("returns no windows for a schedule without any", async () => {
    expect(await listPreferenceWindows(db, S)).toEqual([]);
  });
});
