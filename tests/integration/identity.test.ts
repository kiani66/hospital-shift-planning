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

describe("memberships and the domain actor", () => {
  it("loads a head nurse as a department-scoped actor", async () => {
    expect(await loadActor(db, U.icuHead.id)).toEqual({
      userId: U.icuHead.id,
      isActive: true,
      memberships: [{ departmentId: DEMO_ICU.id, role: "HEAD_NURSE" }],
      supervisedDepartmentIds: [],
    });
  });

  it("loads a supervisor with both departments and no memberships", async () => {
    const actor = await loadActor(db, U.supervisor.id);
    expect(actor?.memberships).toEqual([]);
    expect([...(actor?.supervisedDepartmentIds ?? [])].sort()).toEqual(
      [DEMO_ICU.id, DEMO_ER.id].sort(),
    );
  });

  it("includes only active memberships (the transfer nurse is ICU only)", async () => {
    const actor = await loadActor(db, U.transferNurse.id);
    expect(actor?.memberships).toEqual([
      { departmentId: DEMO_ICU.id, role: "NURSE" },
    ]);
  });

  it("returns null for an unknown user and reflects deactivation", async () => {
    expect(
      await loadActor(db, "99999999-0000-4000-8000-000000000000"),
    ).toBeNull();
    await setUserActive(db, U.icuNurse1.id, false);
    const actor = (await loadActor(db, U.icuNurse1.id))!;
    expect(actor.isActive).toBe(false);
    expect(
      decide(actor, "preference.editOwn", { departmentId: DEMO_ICU.id })
        .allowed,
    ).toBe(false);
  });

  it("ending a membership keeps the row and removes the access", async () => {
    expect(
      await endMembership(db, {
        userId: U.icuNurse2.id,
        departmentId: DEMO_ICU.id,
        endedOn: isoDate("2026-10-01"),
      }),
    ).toBe(true);
    expect(
      await endMembership(db, {
        userId: U.icuNurse2.id,
        departmentId: DEMO_ICU.id,
        endedOn: isoDate("2026-10-01"),
      }),
    ).toBe(false);
    expect(
      (await listActiveMembers(db, DEMO_ICU.id)).map((m) => m.userId),
    ).not.toContain(U.icuNurse2.id);
    expect((await loadActor(db, U.icuNurse2.id))?.memberships).toEqual([]);
  });

  it("allows rejoining after leaving, but only one active membership per department", async () => {
    await endMembership(db, {
      userId: U.icuNurse3.id,
      departmentId: DEMO_ICU.id,
      endedOn: isoDate("2026-10-01"),
    });
    await addMembership(db, {
      userId: U.icuNurse3.id,
      departmentId: DEMO_ICU.id,
      role: "NURSE",
      startedOn: isoDate("2026-11-01"),
    });
    await expect(
      addMembership(db, {
        userId: U.icuNurse3.id,
        departmentId: DEMO_ICU.id,
        role: "NURSE",
        startedOn: isoDate("2026-11-02"),
      }),
    ).rejects.toThrow();
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

  it("ending a supervisor assignment removes that department only", async () => {
    expect(
      await endSupervisorAssignment(db, {
        userId: U.supervisor.id,
        departmentId: DEMO_ER.id,
        endedOn: isoDate("2026-10-01"),
      }),
    ).toBe(true);
    expect(
      (await loadActor(db, U.supervisor.id))?.supervisedDepartmentIds,
    ).toEqual([DEMO_ICU.id]);
    expect(
      await endSupervisorAssignment(db, {
        userId: U.supervisor.id,
        departmentId: DEMO_ER.id,
        endedOn: isoDate("2026-10-01"),
      }),
    ).toBe(false);
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
