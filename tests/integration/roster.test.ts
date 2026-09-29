import { describe, expect, it } from "vitest";

import { decide } from "../../src/domain/authz/policies";
import { isoDate } from "../../src/domain/shared/dates";
import {
  DEMO_ER,
  DEMO_ICU,
  DEMO_SCHEDULE,
  DEMO_USERS,
} from "../../src/infrastructure/db/seed/demo-data";
import { setAssignment } from "../../src/infrastructure/repositories/assignments";
import {
  addMembership,
  endMembership,
  loadActor,
} from "../../src/infrastructure/repositories/memberships";
import {
  addToRoster,
  isOnRoster,
  listFormerMembersOnRoster,
  listRoster,
  removeFromRoster,
  snapshotRosterFromMemberships,
} from "../../src/infrastructure/repositories/roster";
import { createSchedule } from "../../src/infrastructure/repositories/schedules";
import { createUser } from "../../src/infrastructure/repositories/users";
import { setupTestDatabase } from "./support/database";

const { db } = setupTestDatabase();
const U = DEMO_USERS;
const S = DEMO_SCHEDULE.id;

describe("schedule roster", () => {
  it("snapshots active members with their roles (the head nurse is rostered as a nurse)", async () => {
    const roster = await listRoster(db, S);
    expect(roster).toHaveLength(6);
    expect(roster.find((r) => r.userId === U.icuHead.id)?.role).toBe(
      "HEAD_NURSE",
    );
    expect(roster.every((r) => r.displayName.length > 0)).toBe(true);
  });

  const erSchedule = (start: string, end: string) =>
    createSchedule(db, {
      departmentId: DEMO_ER.id,
      period: { start: isoDate(start), end: isoDate(end) },
      label: "x",
      createdBy: U.erHead.id,
    });
  const snapshot = (scheduleId: string) =>
    snapshotRosterFromMemberships(db, { scheduleId, addedBy: U.erHead.id });

  it("does not include memberships ended before the period or other departments", async () => {
    const schedule = await erSchedule("2026-10-23", "2026-11-21");
    expect(await snapshot(schedule.id)).toBe(4);
    expect(await isOnRoster(db, schedule.id, U.transferNurse.id)).toBe(false); // left ER on 09-22
    expect(await isOnRoster(db, schedule.id, U.icuNurse1.id)).toBe(false);
  });

  it("uses the membership dates relative to the period, not whether ended_on is set", async () => {
    // A historical ER schedule, created after the transfer nurse moved to ICU:
    // they were an ER member during that period, so they are rostered.
    const past = await erSchedule("2026-08-23", "2026-09-22");
    expect(await snapshot(past.id)).toBe(5);
    expect(await isOnRoster(db, past.id, U.transferNurse.id)).toBe(true);

    // The period starting on the day after the transfer does not include them.
    const next = await erSchedule("2026-09-23", "2026-10-22");
    expect(await isOnRoster(db, next.id, U.transferNurse.id)).toBe(false);
    await snapshot(next.id);
    expect(await isOnRoster(db, next.id, U.transferNurse.id)).toBe(false);
  });

  it("includes known leavers and joiners who are members on any day of the period", async () => {
    // Leaves on the period's first day; still a member that day.
    await endMembership(db, {
      userId: U.erNurse1.id,
      departmentId: DEMO_ER.id,
      endedOn: isoDate("2026-10-23"),
    });
    // Left the day before the period.
    await endMembership(db, {
      userId: U.erNurse2.id,
      departmentId: DEMO_ER.id,
      endedOn: isoDate("2026-10-22"),
    });
    const joiner = await createUser(db, {
      email: "joiner@demo.invalid",
      displayName: "x",
    });
    const tooLate = await createUser(db, {
      email: "later@demo.invalid",
      displayName: "y",
    });
    // Starts on the period's last day, and the day after it.
    for (const [user, startedOn] of [
      [joiner, "2026-11-21"],
      [tooLate, "2026-11-22"],
    ] as const)
      await addMembership(db, {
        userId: user.id,
        departmentId: DEMO_ER.id,
        role: "NURSE",
        startedOn: isoDate(startedOn),
      });

    const schedule = await erSchedule("2026-10-23", "2026-11-21");
    await snapshot(schedule.id);
    expect(await isOnRoster(db, schedule.id, U.erNurse1.id)).toBe(true);
    expect(await isOnRoster(db, schedule.id, U.erNurse2.id)).toBe(false);
    expect(await isOnRoster(db, schedule.id, joiner.id)).toBe(true);
    expect(await isOnRoster(db, schedule.id, tooLate.id)).toBe(false);
  });

  it("rosters someone promoted mid-period once, with the later role", async () => {
    await endMembership(db, {
      userId: U.erNurse3.id,
      departmentId: DEMO_ER.id,
      endedOn: isoDate("2026-11-05"),
    });
    await addMembership(db, {
      userId: U.erNurse3.id,
      departmentId: DEMO_ER.id,
      role: "HEAD_NURSE",
      startedOn: isoDate("2026-11-06"),
    });
    const schedule = await erSchedule("2026-10-23", "2026-11-21");
    expect(await snapshot(schedule.id)).toBe(4);
    const roster = await listRoster(db, schedule.id);
    expect(roster.find((r) => r.userId === U.erNurse3.id)?.role).toBe(
      "HEAD_NURSE",
    );
  });

  it("does not change an existing roster when memberships change later", async () => {
    const before = await listRoster(db, S);
    await endMembership(db, {
      userId: U.icuNurse2.id,
      departmentId: DEMO_ICU.id,
      endedOn: isoDate("2026-09-30"),
    });
    const joiner = await createUser(db, {
      email: "joiner@demo.invalid",
      displayName: "x",
    });
    await addMembership(db, {
      userId: joiner.id,
      departmentId: DEMO_ICU.id,
      role: "NURSE",
      startedOn: isoDate("2026-10-01"),
    });
    expect(await listRoster(db, S)).toEqual(before);
    // Adding the later joiner is explicit.
    await addToRoster(db, {
      scheduleId: S,
      userId: joiner.id,
      role: "NURSE",
      addedBy: U.icuHead.id,
    });
    expect(await isOnRoster(db, S, joiner.id)).toBe(true);
  });

  it("re-snapshotting keeps existing entries and adds nothing twice", async () => {
    expect(
      await snapshotRosterFromMemberships(db, {
        scheduleId: S,
        addedBy: U.icuHead.id,
      }),
    ).toBe(0);
  });

  it("keeps history when a nurse later leaves the department", async () => {
    await endMembership(db, {
      userId: U.icuNurse1.id,
      departmentId: DEMO_ICU.id,
      endedOn: isoDate("2026-11-30"),
    });

    expect(await isOnRoster(db, S, U.icuNurse1.id)).toBe(true);
    const former = (day: string) =>
      listFormerMembersOnRoster(db, { scheduleId: S, onDate: isoDate(day) });
    expect(await former("2026-11-30")).toEqual([]); // last day of membership
    expect(await former("2026-12-01")).toEqual([U.icuNurse1.id]);

    // D16: the former member keeps read-only access to schedules they were rostered on.
    const actor = (await loadActor(db, U.icuNurse1.id, isoDate("2026-12-01")))!;
    const onRoster = await isOnRoster(db, S, actor.userId);
    expect(
      decide(actor, "schedule.viewOwn", { departmentId: DEMO_ICU.id, onRoster })
        .allowed,
    ).toBe(true);
    expect(
      decide(actor, "preference.editOwn", { departmentId: DEMO_ICU.id })
        .allowed,
    ).toBe(false);
  });

  it("can add someone explicitly (e.g. a float nurse)", async () => {
    await addToRoster(db, {
      scheduleId: S,
      userId: U.erNurse1.id,
      role: "NURSE",
      addedBy: U.icuHead.id,
    });
    expect(await isOnRoster(db, S, U.erNurse1.id)).toBe(true);
    await expect(
      addToRoster(db, {
        scheduleId: S,
        userId: U.erNurse1.id,
        role: "NURSE",
        addedBy: U.icuHead.id,
      }),
    ).rejects.toThrow();
  });

  it("can remove a nurse without data, but not one with assignments (history protected)", async () => {
    expect(
      await removeFromRoster(db, { scheduleId: S, userId: U.icuNurse4.id }),
    ).toBe(true);
    expect(
      await removeFromRoster(db, { scheduleId: S, userId: U.icuNurse4.id }),
    ).toBe(false);

    await setAssignment(db, {
      scheduleId: S,
      userId: U.icuNurse3.id,
      date: isoDate("2026-10-25"),
      shift: "M",
      updatedBy: U.icuHead.id,
    });
    await expect(
      removeFromRoster(db, { scheduleId: S, userId: U.icuNurse3.id }),
    ).rejects.toThrow();
  });
});
