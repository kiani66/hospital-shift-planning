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

  it("does not include ended memberships or other departments", async () => {
    const schedule = await createSchedule(db, {
      departmentId: DEMO_ER.id,
      period: { start: isoDate("2026-10-23"), end: isoDate("2026-11-21") },
      label: "آبان",
      createdBy: U.erHead.id,
    });
    const added = await snapshotRosterFromMemberships(db, {
      scheduleId: schedule.id,
      departmentId: DEMO_ER.id,
      addedBy: U.erHead.id,
    });
    expect(added).toBe(4);
    expect(await isOnRoster(db, schedule.id, U.transferNurse.id)).toBe(false); // left ER
    expect(await isOnRoster(db, schedule.id, U.icuNurse1.id)).toBe(false);
  });

  it("re-snapshotting keeps existing entries and adds nothing twice", async () => {
    expect(
      await snapshotRosterFromMemberships(db, {
        scheduleId: S,
        departmentId: DEMO_ICU.id,
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
    expect(
      await listFormerMembersOnRoster(db, {
        scheduleId: S,
        departmentId: DEMO_ICU.id,
      }),
    ).toEqual([U.icuNurse1.id]);

    // D16: the former member keeps read-only access to schedules they were rostered on.
    const actor = (await loadActor(db, U.icuNurse1.id))!;
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
