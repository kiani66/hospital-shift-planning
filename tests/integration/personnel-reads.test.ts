import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { bootstrapHospitalAdmin } from "../../src/application/management/bootstrap";
import {
  getDepartmentPeople,
  getPersonnelDetail,
  getPersonnelDirectory,
} from "../../src/application/management/personnel-queries";
import type { AppContext } from "../../src/application/use-case";
import { isoDate } from "../../src/domain/shared/dates";
import { hashPassword } from "../../src/infrastructure/auth/password";
import {
  DEMO_ER,
  DEMO_ICU,
  DEMO_USERS as U,
} from "../../src/infrastructure/db/seed/demo-data";
import {
  auditEvents,
  departmentMemberships,
  departments,
  supervisorAssignments,
  users,
} from "../../src/infrastructure/db/schema";
import {
  addMembership,
  loadActor,
} from "../../src/infrastructure/repositories/memberships";
import { createUser } from "../../src/infrastructure/repositories/users";
import { setupTestDatabase } from "./support/database";

const { db } = setupTestDatabase();
const now = new Date("2026-10-03T08:00:00Z");
const today = isoDate("2026-10-03");
const passwordHash = hashPassword("personnel-read-test-password");
let admin: AppContext;
const as = async (id: string): Promise<AppContext> => ({
  db,
  actor: (await loadActor(db, id, today))!,
  clock: () => now,
});

beforeEach(async () => {
  const user = await createUser(db, {
    email: "admin@reads.invalid",
    displayName: "Read admin",
    passwordHash: await passwordHash,
  });
  await bootstrapHospitalAdmin(
    db,
    { email: user.email, confirm: "ESTABLISH_FIRST_HOSPITAL_ADMIN" },
    now,
  );
  admin = await as(user.id);
});

async function historyPerson() {
  const user = await createUser(db, {
    email: "timeline@reads.invalid",
    displayName: "Timeline",
    isActive: false,
  });
  for (const [start, end, role] of [
    ["2026-01-01", "2026-10-02", "NURSE"],
    ["2026-10-03", "2026-10-03", "HEAD_NURSE"],
    ["2026-10-04", null, "NURSE"],
  ] as const) {
    await addMembership(db, {
      userId: user.id,
      departmentId: DEMO_ICU.id,
      role,
      startedOn: isoDate(start),
      endedOn: end ? isoDate(end) : null,
    });
    await db.insert(supervisorAssignments).values({
      userId: user.id,
      departmentId: DEMO_ER.id,
      startedOn: start,
      endedOn: end,
    });
  }
  return user;
}

describe("authorized personnel read models", () => {
  it("lists all hospital users including inactive accounts, with safe DTOs and no writes", async () => {
    const before = await db.select().from(auditEvents);
    const result = await getPersonnelDirectory(admin);
    expect(result.users).toHaveLength(Object.keys(U).length + 1);
    expect(
      result.users.find((u) => u.id === U.inactiveNurse.id)?.isActive,
    ).toBe(false);
    expect(result.users.find((u) => u.id === admin.actor.userId)).toMatchObject(
      { isHospitalAdmin: true, memberships: [], supervisors: [] },
    );
    expect(JSON.stringify(result)).not.toMatch(
      /password|hash|token|session|auditMetadata/,
    );
    expect(await db.select().from(auditEvents)).toEqual(before);
  });
  it.each([U.icuHead, U.supervisor, U.icuNurse1])(
    "denies the global list and detail to $email",
    async (user) => {
      const ctx = await as(user.id);
      await expect(getPersonnelDirectory(ctx)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(
        getPersonnelDetail(ctx, U.erNurse1.id),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    },
  );
  it("denies an inactive actor even with a stale active database account", async () => {
    const ctx = { ...admin, actor: { ...admin.actor, isActive: false } };
    await expect(getPersonnelDirectory(ctx)).rejects.toMatchObject({
      reason: "ACTOR_INACTIVE",
    });
    await expect(getPersonnelDetail(ctx, U.icuNurse1.id)).rejects.toMatchObject(
      { reason: "ACTOR_INACTIVE" },
    );
    await expect(getDepartmentPeople(ctx, "icu")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
  it.each(["isActive", "isHospitalAdmin"] as const)(
    "rechecks revoked %s rather than trusting the stale actor",
    async (field) => {
      await db
        .update(users)
        .set({ [field]: false })
        .where(eq(users.id, admin.actor.userId));
      await expect(getPersonnelDirectory(admin)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(
        getPersonnelDetail(admin, U.icuNurse1.id),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    },
  );
  it("lets a Head Nurse read only current people in their own department without global identifiers", async () => {
    const result = await getDepartmentPeople(await as(U.icuHead.id), "icu");
    expect(result.memberships.map((m) => m.userId)).toContain(U.icuNurse1.id);
    expect(result.memberships.map((m) => m.userId)).not.toContain(
      U.erNurse1.id,
    );
    expect(result.supervisors.map((s) => s.userId)).toEqual([U.supervisor.id]);
    expect(JSON.stringify(result)).not.toMatch(
      /email|isHospitalAdmin|password|hash/,
    );
    await expect(
      getDepartmentPeople(await as(U.icuHead.id), "er"),
    ).rejects.toMatchObject({ code: "NOT_FOUND", entity: "Department" });
  });
  it("lets a Supervisor read precisely their effective supervised scope", async () => {
    const ctx = await as(U.supervisor.id);
    expect(
      (await getDepartmentPeople(ctx, "icu")).memberships.map((m) => m.userId),
    ).toContain(U.icuNurse1.id);
    expect(
      (await getDepartmentPeople(ctx, "er")).memberships.map((m) => m.userId),
    ).toContain(U.erNurse1.id);
    await db
      .update(supervisorAssignments)
      .set({ endedOn: "2026-10-02" })
      .where(eq(supervisorAssignments.departmentId, DEMO_ER.id));
    await expect(getDepartmentPeople(ctx, "er")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
  it("rechecks a Head Nurse's ended role", async () => {
    const ctx = await as(U.icuHead.id);
    await db
      .update(departmentMemberships)
      .set({ endedOn: "2026-10-02" })
      .where(eq(departmentMemberships.userId, U.icuHead.id));
    await expect(getDepartmentPeople(ctx, "icu")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
  it.each([U.icuNurse1, U.inactiveNurse])(
    "conceals department people from $email",
    async (user) => {
      await expect(
        getDepartmentPeople(await as(user.id), "icu"),
      ).rejects.toMatchObject({ code: "NOT_FOUND", entity: "Department" });
    },
  );
  it("conceals unknown/inactive departments and malformed/unknown user ids", async () => {
    await expect(getDepartmentPeople(admin, "unknown")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await db
      .update(departments)
      .set({ isActive: false })
      .where(eq(departments.id, DEMO_ICU.id));
    await expect(getDepartmentPeople(admin, "icu")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    for (const id of [randomUUID(), "invalid"])
      await expect(getPersonnelDetail(admin, id)).rejects.toMatchObject({
        code: "NOT_FOUND",
        entity: "User",
      });
  });
  it("an admin without department relations can read both department scopes", async () => {
    expect((await getDepartmentPeople(admin, "icu")).department.id).toBe(
      DEMO_ICU.id,
    );
    expect((await getDepartmentPeople(admin, "er")).department.id).toBe(
      DEMO_ER.id,
    );
  });
  it("preserves complete membership and supervisor history with future/current/ended status", async () => {
    const person = await historyPerson();
    const detail = await getPersonnelDetail(admin, person.id);
    expect(detail.isActive).toBe(false);
    expect(detail.createdAt).toBeInstanceOf(Date);
    expect(detail.updatedAt).toBeInstanceOf(Date);
    expect(detail.memberships.map((m) => m.status)).toEqual([
      "ENDED",
      "CURRENT",
      "FUTURE",
    ]);
    expect(detail.supervisors.map((s) => s.status)).toEqual([
      "ENDED",
      "CURRENT",
      "FUTURE",
    ]);
    expect(detail.memberships[1]).toMatchObject({
      role: "HEAD_NURSE",
      department: { name: DEMO_ICU.name },
      startedOn: today,
      endedOn: today,
    });
    expect(detail.supervisors[1]).toMatchObject({
      department: { name: DEMO_ER.name },
    });
    expect(JSON.stringify(detail)).not.toMatch(
      /password|hash|token|session|userId/,
    );
  });
  it("selects inclusive current relations on lists, keeping inactive accounts visible but omitting future/ended people", async () => {
    const person = await historyPerson();
    const directory = await getPersonnelDirectory(admin, {
      search: person.email,
    });
    expect(directory.users[0]?.memberships).toHaveLength(1);
    expect(directory.users[0]?.memberships[0]?.role).toBe("HEAD_NURSE");
    expect(directory.users[0]?.supervisors).toHaveLength(1);
    const people = await getDepartmentPeople(await as(U.icuHead.id), "icu");
    expect(
      people.memberships.find((m) => m.userId === person.id),
    ).toMatchObject({ isActive: false, role: "HEAD_NURSE" });
    const tomorrow = {
      ...admin,
      clock: () => new Date("2026-10-04T08:00:00Z"),
    };
    expect(
      (await getPersonnelDirectory(tomorrow, { search: person.email })).users[0]
        ?.memberships[0]?.role,
    ).toBe("NURSE");
    const futureOnly = await createUser(db, {
      email: "future@reads.invalid",
      displayName: "Future",
    });
    await addMembership(db, {
      userId: futureOnly.id,
      departmentId: DEMO_ICU.id,
      role: "NURSE",
      startedOn: isoDate("2027-01-01"),
    });
    expect(
      (await getDepartmentPeople(admin, "icu")).memberships.map(
        (m) => m.userId,
      ),
    ).not.toContain(futureOnly.id);
    expect(people.memberships.map((m) => m.userId)).not.toContain(
      U.inactiveNurse.id,
    );
  });
  it("keeps inactive-department history visible to admin", async () => {
    await db
      .update(departments)
      .set({ isActive: false })
      .where(eq(departments.id, DEMO_ICU.id));
    expect(
      (await getPersonnelDetail(admin, U.icuNurse1.id)).memberships[0]
        ?.department.isActive,
    ).toBe(false);
  });
});

describe("personnel search, filters, and pagination", () => {
  it("searches names and email case-insensitively", async () => {
    expect(
      (
        await getPersonnelDirectory(admin, { search: "  NURSE1.ICU@  " })
      ).users.map((u) => u.id),
    ).toEqual([U.icuNurse1.id]);
    expect(
      (
        await getPersonnelDirectory(admin, { search: U.icuHead.displayName })
      ).users.map((u) => u.id),
    ).toEqual([U.icuHead.id]);
  });
  it.each(["%", "_", "\\"])(
    "treats %s as literal search text",
    async (search) => {
      const person = await createUser(db, {
        email: "literal@reads.invalid",
        displayName: `Literal ${search}`,
      });
      expect(
        (await getPersonnelDirectory(admin, { search })).users.map((u) => u.id),
      ).toEqual([person.id]);
    },
  );
  it("filters active accounts and system admin independently", async () => {
    expect(
      (await getPersonnelDirectory(admin, { active: "inactive" })).users.map(
        (u) => u.id,
      ),
    ).toEqual([U.inactiveNurse.id]);
    expect(
      (await getPersonnelDirectory(admin, { admin: "admin" })).users.map(
        (u) => u.id,
      ),
    ).toEqual([admin.actor.userId]);
    expect(
      (
        await getPersonnelDirectory(admin, { admin: "other", active: "active" })
      ).users.every((u) => u.isActive && !u.isHospitalAdmin),
    ).toBe(true);
  });
  it("filters current department access including supervisor-only accounts", async () => {
    const result = await getPersonnelDirectory(admin, {
      departmentId: DEMO_ER.id,
    });
    expect(result.users.map((u) => u.id)).toContain(U.supervisor.id);
    expect(result.users.map((u) => u.id)).not.toContain(U.transferNurse.id);
    expect(result.users.map((u) => u.id)).not.toContain(U.icuHead.id);
  });
  it("matches department and role against the same current membership, excluding supervisors", async () => {
    await addMembership(db, {
      userId: U.icuNurse1.id,
      departmentId: DEMO_ER.id,
      role: "HEAD_NURSE",
      startedOn: isoDate("2026-01-01"),
    });
    expect(
      (
        await getPersonnelDirectory(admin, {
          departmentId: DEMO_ICU.id,
          role: "HEAD_NURSE",
        })
      ).users.map((u) => u.id),
    ).toEqual([U.icuHead.id]);
    expect(
      (await getPersonnelDirectory(admin, { role: "HEAD_NURSE" })).users.map(
        (u) => u.id,
      ),
    ).toContain(U.icuNurse1.id);
  });
  it("filters after effective-date selection, excluding ended and future roles", async () => {
    const person = await historyPerson();
    expect(
      (
        await getPersonnelDirectory(admin, {
          search: person.email,
          role: "NURSE",
        })
      ).users,
    ).toEqual([]);
    expect(
      (
        await getPersonnelDirectory(admin, {
          search: person.email,
          role: "HEAD_NURSE",
          active: "inactive",
        })
      ).users.map((u) => u.id),
    ).toEqual([person.id]);
  });
  it("normalizes malformed URL filters and bounds page/search inputs", async () => {
    const result = await getPersonnelDirectory(admin, {
      active: "bad",
      admin: ["admin"],
      departmentId: "invalid",
      role: "SUPERVISOR",
      page: "-1",
      search: "x".repeat(201),
    });
    expect(result.filters).toEqual({
      active: "all",
      admin: "all",
      page: 1,
      search: "",
    });
    expect(
      (await getPersonnelDirectory(admin, { page: "10001" })).filters.page,
    ).toBe(1);
  });
  it("paginates filtered accounts in deterministic order without duplicates", async () => {
    await db.insert(users).values(
      Array.from({ length: 30 }, (_, i) => ({
        displayName: "Pagination",
        email: `page${i}@reads.invalid`,
      })),
    );
    const first = await getPersonnelDirectory(admin, { search: "Pagination" });
    const second = await getPersonnelDirectory(admin, {
      search: "Pagination",
      page: "2",
    });
    expect(first.users).toHaveLength(25);
    expect(first.hasNext).toBe(true);
    expect(second.users).toHaveLength(5);
    expect(second.hasNext).toBe(false);
    expect(
      new Set([...first.users, ...second.users].map((u) => u.id)).size,
    ).toBe(30);
    expect(
      (await getPersonnelDirectory(admin, { search: "Pagination", page: 3 }))
        .users,
    ).toEqual([]);
  });
});
