import { describe, expect, it } from "vitest";

import { validateSchedule } from "../../src/domain/rules/validate-schedule";
import { addDays, isoDate } from "../../src/domain/shared/dates";
import {
  DEMO_ICU,
  DEMO_SCHEDULE,
  DEMO_USERS,
} from "../../src/infrastructure/db/seed/demo-data";
import {
  clearAssignment,
  listAdjacentAssignments,
  listAssignments,
  setAssignment,
} from "../../src/infrastructure/repositories/assignments";
import { snapshotRosterFromMemberships } from "../../src/infrastructure/repositories/roster";
import {
  createSchedule,
  findScheduleById,
} from "../../src/infrastructure/repositories/schedules";
import { setupTestDatabase } from "./support/database";

const { db } = setupTestDatabase();
const U = DEMO_USERS;
const S = DEMO_SCHEDULE.id;
const head = U.icuHead.id;

describe("shift assignments (working copy)", () => {
  it("stores one assignment per nurse per day; setting again replaces it (D15)", async () => {
    const date = isoDate("2026-10-25");
    await setAssignment(db, {
      scheduleId: S,
      userId: U.icuNurse1.id,
      date,
      shift: "M",
      updatedBy: head,
    });
    await setAssignment(db, {
      scheduleId: S,
      userId: U.icuNurse1.id,
      date,
      shift: "E",
      updatedBy: head,
    });
    expect(await listAssignments(db, S)).toEqual([
      { nurseId: U.icuNurse1.id, date: "2026-10-25", shift: "E" },
    ]);
  });

  it("stores ME as a single assignment", async () => {
    await setAssignment(db, {
      scheduleId: S,
      userId: U.icuNurse1.id,
      date: isoDate("2026-10-26"),
      shift: "ME",
      updatedBy: head,
    });
    expect(await listAssignments(db, S)).toEqual([
      { nurseId: U.icuNurse1.id, date: "2026-10-26", shift: "ME" },
    ]);
  });

  it("assigns shifts to the head nurse too (a head nurse is also a nurse)", async () => {
    await setAssignment(db, {
      scheduleId: S,
      userId: head,
      date: isoDate("2026-10-27"),
      shift: "M",
      updatedBy: head,
    });
    expect((await listAssignments(db, S))[0]?.nurseId).toBe(head);
  });

  it("returns dates as ISO strings, not Date objects", async () => {
    await setAssignment(db, {
      scheduleId: S,
      userId: U.icuNurse1.id,
      date: isoDate("2026-11-21"),
      shift: "N",
      updatedBy: head,
    });
    const [a] = await listAssignments(db, S);
    expect(a?.date).toBe("2026-11-21");
    expect(typeof a?.date).toBe("string");
  });

  it("clears an assignment (the nurse is off)", async () => {
    const date = isoDate("2026-10-25");
    await setAssignment(db, {
      scheduleId: S,
      userId: U.icuNurse1.id,
      date,
      shift: "M",
      updatedBy: head,
    });
    expect(
      await clearAssignment(db, {
        scheduleId: S,
        userId: U.icuNurse1.id,
        date,
      }),
    ).toBe(true);
    expect(
      await clearAssignment(db, {
        scheduleId: S,
        userId: U.icuNurse1.id,
        date,
      }),
    ).toBe(false);
    expect(await listAssignments(db, S)).toEqual([]);
  });

  it("rejects unknown shift codes and nurses not on the roster", async () => {
    await expect(
      setAssignment(db, {
        scheduleId: S,
        userId: U.icuNurse1.id,
        date: isoDate("2026-10-25"),
        shift: "X" as "M",
        updatedBy: head,
      }),
    ).rejects.toThrow();
    await expect(
      setAssignment(db, {
        scheduleId: S,
        userId: U.erNurse1.id,
        date: isoDate("2026-10-25"),
        shift: "M",
        updatedBy: head,
      }),
    ).rejects.toThrow();
  });

  it("finds neighbouring-schedule assignments so night-rest holds across periods", async () => {
    // Mehr 1405 precedes the seeded Aban schedule.
    const mehr = await createSchedule(db, {
      departmentId: DEMO_ICU.id,
      period: { start: isoDate("2026-09-23"), end: isoDate("2026-10-22") },
      label: "مهر",
      createdBy: head,
    });
    await snapshotRosterFromMemberships(db, {
      scheduleId: mehr.id,
      departmentId: DEMO_ICU.id,
      addedBy: head,
    });
    await setAssignment(db, {
      scheduleId: mehr.id,
      userId: U.icuNurse1.id,
      date: isoDate("2026-10-22"),
      shift: "N",
      updatedBy: head,
    });
    await setAssignment(db, {
      scheduleId: S,
      userId: U.icuNurse1.id,
      date: isoDate("2026-10-23"),
      shift: "M",
      updatedBy: head,
    });

    const aban = (await findScheduleById(db, S))!;
    const assignments = await listAssignments(db, S);
    const adjacentAssignments = await listAdjacentAssignments(db, {
      departmentId: DEMO_ICU.id,
      excludeScheduleId: S,
      nurseIds: [...new Set(assignments.map((a) => a.nurseId))],
      dates: [addDays(aban.period.start, -1), addDays(aban.period.end, 1)],
    });
    expect(adjacentAssignments).toEqual([
      { nurseId: U.icuNurse1.id, date: "2026-10-22", shift: "N" },
    ]);

    const violations = validateSchedule({
      period: aban.period,
      assignments,
      adjacentAssignments,
    });
    expect(violations).toEqual([
      expect.objectContaining({
        rule: "NIGHT_REST",
        nurseId: U.icuNurse1.id,
        nightDate: "2026-10-22",
        date: "2026-10-23",
      }),
    ]);
  });

  it("returns no adjacent assignments for empty inputs", async () => {
    expect(
      await listAdjacentAssignments(db, {
        departmentId: DEMO_ICU.id,
        excludeScheduleId: S,
        nurseIds: [],
        dates: [],
      }),
    ).toEqual([]);
  });
});
