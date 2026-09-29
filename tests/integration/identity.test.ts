import { describe, expect, it } from "vitest";

import { decide } from "../../src/domain/authz/policies";
import { isoDate } from "../../src/domain/shared/dates";
import {
  DEMO_ER,
  DEMO_ICU,
  DEMO_USERS,
} from "../../src/infrastructure/db/seed/demo-data";
import {
  createDepartment,
  findDepartmentById,
  listDepartments,
} from "../../src/infrastructure/repositories/departments";
import {
  addMembership,
  assignSupervisor,
  endMembership,
  endSupervisorAssignment,
  listActiveMembers,
  loadActor,
} from "../../src/infrastructure/repositories/memberships";
import {
  createUser,
  findUserByEmail,
  findUserById,
  setUserActive,
} from "../../src/infrastructure/repositories/users";
import { setupTestDatabase } from "./support/database";

const { db } = setupTestDatabase();
const U = DEMO_USERS;

describe("users and departments", () => {
  it("creates and finds users; e-mail lookup is case-insensitive", async () => {
    const user = await createUser(db, {
      email: "New.Nurse@demo.invalid",
      displayName: "پرستار جدید",
    });
    expect(await findUserById(db, user.id)).toEqual(user);
    expect(await findUserByEmail(db, "new.nurse@DEMO.invalid")).toEqual(user);
    expect(user.isActive).toBe(true);
  });

  it("rejects a duplicate e-mail differing only in case", async () => {
    await expect(
      createUser(db, { email: "SUPERVISOR@demo.invalid", displayName: "x" }),
    ).rejects.toThrow();
  });

  it("returns null for unknown ids", async () => {
    expect(
      await findUserById(db, "99999999-0000-4000-8000-000000000000"),
    ).toBeNull();
    expect(
      await findDepartmentById(db, "99999999-0000-4000-8000-000000000000"),
    ).toBeNull();
  });

  it("creates departments with the default timezone", async () => {
    const d = await createDepartment(db, { code: "ccu", name: "CCU" });
    expect(d.timezone).toBe("Asia/Tehran");
    expect((await listDepartments(db)).map((x) => x.code)).toEqual([
      "ccu",
      "er",
      "icu",
    ]);
  });
});

const TODAY = isoDate("2026-10-01");

describe("memberships and the domain actor", () => {
  it("loads a head nurse as a department-scoped actor", async () => {
    expect(await loadActor(db, U.icuHead.id, TODAY)).toEqual({
      userId: U.icuHead.id,
      isActive: true,
      memberships: [{ departmentId: DEMO_ICU.id, role: "HEAD_NURSE" }],
      supervisedDepartmentIds: [],
    });
  });

  it("loads a supervisor with both departments and no memberships", async () => {
    const actor = await loadActor(db, U.supervisor.id, TODAY);
    expect(actor?.memberships).toEqual([]);
    expect([...(actor?.supervisedDepartmentIds ?? [])].sort()).toEqual(
      [DEMO_ICU.id, DEMO_ER.id].sort(),
    );
  });

  it("uses the memberships in effect on the given day (the transfer nurse)", async () => {
    const on = async (day: string) =>
      (await loadActor(db, U.transferNurse.id, isoDate(day)))?.memberships;
    // ER through 2026-09-22 (inclusive), ICU from 2026-09-23.
    expect(await on("2026-09-22")).toEqual([
      { departmentId: DEMO_ER.id, role: "NURSE" },
    ]);
    expect(await on("2026-09-23")).toEqual([
      { departmentId: DEMO_ICU.id, role: "NURSE" },
    ]);
    expect(await on("2025-12-31")).toEqual([]); // before any membership
  });

  it("returns null for an unknown user and reflects deactivation", async () => {
    expect(
      await loadActor(db, "99999999-0000-4000-8000-000000000000", TODAY),
    ).toBeNull();
    await setUserActive(db, U.icuNurse1.id, false);
    const actor = (await loadActor(db, U.icuNurse1.id, TODAY))!;
    expect(actor.isActive).toBe(false);
    expect(
      decide(actor, "preference.editOwn", { departmentId: DEMO_ICU.id })
        .allowed,
    ).toBe(false);
  });

  it("keeps a membership with a future end date active until that day (inclusive)", async () => {
    expect(
      await endMembership(db, {
        userId: U.icuNurse2.id,
        departmentId: DEMO_ICU.id,
        endedOn: isoDate("2026-11-10"),
      }),
    ).toBe(true);
    const members = async (day: string) =>
      (await listActiveMembers(db, DEMO_ICU.id, isoDate(day))).map(
        (m) => m.userId,
      );
    expect(await members("2026-10-01")).toContain(U.icuNurse2.id);
    expect(await members("2026-11-10")).toContain(U.icuNurse2.id);
    expect(await members("2026-11-11")).not.toContain(U.icuNurse2.id);

    expect(
      (await loadActor(db, U.icuNurse2.id, TODAY))?.memberships,
    ).toHaveLength(1);
    expect(
      (await loadActor(db, U.icuNurse2.id, isoDate("2026-11-11")))?.memberships,
    ).toEqual([]);
    // The row is kept (history) and there is no open-ended one left to end.
    expect(
      await endMembership(db, {
        userId: U.icuNurse2.id,
        departmentId: DEMO_ICU.id,
        endedOn: isoDate("2026-11-10"),
      }),
    ).toBe(false);
  });

  it("does not treat a future start date as active yet", async () => {
    const user = await createUser(db, {
      email: "joiner@demo.invalid",
      displayName: "x",
    });
    await addMembership(db, {
      userId: user.id,
      departmentId: DEMO_ER.id,
      role: "NURSE",
      startedOn: isoDate("2026-11-01"),
    });
    expect((await loadActor(db, user.id, TODAY))?.memberships).toEqual([]);
    expect(
      (await loadActor(db, user.id, isoDate("2026-11-01")))?.memberships,
    ).toEqual([{ departmentId: DEMO_ER.id, role: "NURSE" }]);
    expect(
      (await listActiveMembers(db, DEMO_ER.id, TODAY)).map((m) => m.userId),
    ).not.toContain(user.id);
  });

  it("stores a fixed-term membership (both dates known up front)", async () => {
    const user = await createUser(db, {
      email: "fixed@demo.invalid",
      displayName: "x",
    });
    await addMembership(db, {
      userId: user.id,
      departmentId: DEMO_ER.id,
      role: "NURSE",
      startedOn: isoDate("2026-10-01"),
      endedOn: isoDate("2026-10-31"),
    });
    const ids = async (day: string) =>
      (await listActiveMembers(db, DEMO_ER.id, isoDate(day))).map(
        (m) => m.userId,
      );
    expect(await ids("2026-10-31")).toContain(user.id);
    expect(await ids("2026-11-01")).not.toContain(user.id);
  });

  it("allows rejoining the day after leaving, but never overlapping memberships", async () => {
    await endMembership(db, {
      userId: U.icuNurse3.id,
      departmentId: DEMO_ICU.id,
      endedOn: isoDate("2026-10-31"),
    });
    // Adjacent: the old one ends on 10-31, the new one starts on 11-01.
    await addMembership(db, {
      userId: U.icuNurse3.id,
      departmentId: DEMO_ICU.id,
      role: "HEAD_NURSE",
      startedOn: isoDate("2026-11-01"),
    });
    const conflict = (startedOn: string, endedOn?: string) =>
      addMembership(db, {
        userId: U.icuNurse3.id,
        departmentId: DEMO_ICU.id,
        role: "NURSE",
        startedOn: isoDate(startedOn),
        endedOn: endedOn ? isoDate(endedOn) : null,
      });
    // Overlaps the old range, closed or not, and the open-ended new one.
    await expect(conflict("2026-10-31", "2026-10-31")).rejects.toMatchObject({
      cause: { code: "23P01", constraint: "department_memberships_no_overlap" },
    });
    await expect(conflict("2026-12-01", "2026-12-31")).rejects.toMatchObject({
      cause: { code: "23P01" },
    });
    await expect(conflict("2025-01-01", "2026-01-01")).rejects.toMatchObject({
      cause: { code: "23P01" },
    });
    // Before the first membership, not touching it: fine.
    await conflict("2025-01-01", "2025-12-31");
    expect(
      (await loadActor(db, U.icuNurse3.id, isoDate("2026-11-01")))?.memberships,
    ).toEqual([{ departmentId: DEMO_ICU.id, role: "HEAD_NURSE" }]);
  });

  it("rejects a membership that ends before it starts", async () => {
    const user = await createUser(db, {
      email: "x@demo.invalid",
      displayName: "x",
    });
    await addMembership(db, {
      userId: user.id,
      departmentId: DEMO_ER.id,
      role: "NURSE",
      startedOn: isoDate("2026-05-01"),
    });
    await expect(
      endMembership(db, {
        userId: user.id,
        departmentId: DEMO_ER.id,
        endedOn: isoDate("2026-04-01"),
      }),
    ).rejects.toThrow();
  });

  it("ends a supervisor assignment for that department only, from the day after", async () => {
    expect(
      await endSupervisorAssignment(db, {
        userId: U.supervisor.id,
        departmentId: DEMO_ER.id,
        endedOn: isoDate("2026-10-15"),
      }),
    ).toBe(true);
    const supervised = async (day: string) =>
      (await loadActor(db, U.supervisor.id, isoDate(day)))
        ?.supervisedDepartmentIds;
    expect([...((await supervised("2026-10-15")) ?? [])].sort()).toEqual(
      [DEMO_ICU.id, DEMO_ER.id].sort(),
    );
    expect(await supervised("2026-10-16")).toEqual([DEMO_ICU.id]);
    expect(
      await endSupervisorAssignment(db, {
        userId: U.supervisor.id,
        departmentId: DEMO_ER.id,
        endedOn: isoDate("2026-10-15"),
      }),
    ).toBe(false);
  });

  it("rejects overlapping supervisor assignments", async () => {
    await expect(
      assignSupervisor(db, {
        userId: U.supervisor.id,
        departmentId: DEMO_ICU.id,
        startedOn: isoDate("2026-06-01"),
        endedOn: isoDate("2026-06-30"),
      }),
    ).rejects.toMatchObject({
      cause: { code: "23P01", constraint: "supervisor_assignments_no_overlap" },
    });
    // A different supervisor for the same department is fine.
    const other = await createUser(db, {
      email: "sup2@demo.invalid",
      displayName: "x",
    });
    await assignSupervisor(db, {
      userId: other.id,
      departmentId: DEMO_ICU.id,
      startedOn: isoDate("2026-06-01"),
    });
  });

  it("rejects memberships for unknown users or departments (foreign keys)", async () => {
    await expect(
      addMembership(db, {
        userId: "99999999-0000-4000-8000-000000000000",
        departmentId: DEMO_ICU.id,
        role: "NURSE",
        startedOn: isoDate("2026-01-01"),
      }),
    ).rejects.toThrow();
  });
});
