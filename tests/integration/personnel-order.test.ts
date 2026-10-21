import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { sortByPersonnelOrder } from "../../src/domain/identity/personnel-order";
import { isoDate } from "../../src/domain/shared/dates";
import { users } from "../../src/infrastructure/db/schema";
import {
  DEMO_ICU,
  DEMO_SCHEDULE,
  DEMO_USERS as U,
} from "../../src/infrastructure/db/seed/demo-data";
import {
  listExportRoster,
  listTemplatePersonnel,
} from "../../src/infrastructure/repositories/excel-templates";
import { listRosterAssignments } from "../../src/infrastructure/repositories/assignments";
import {
  readCurrentDepartmentPeople,
  readPersonnelPage,
} from "../../src/infrastructure/repositories/management-reads";
import {
  listDepartmentPersonnel,
  searchHospitalUsers,
} from "../../src/infrastructure/repositories/management";
import { addMembership } from "../../src/infrastructure/repositories/memberships";
import {
  addToRoster,
  listRoster,
  listRosterCandidateMemberships,
  listRosterMembersOn,
  listSchedulingRoster,
} from "../../src/infrastructure/repositories/roster";
import { createUser } from "../../src/infrastructure/repositories/users";
import { setupTestDatabase } from "./support/database";

const { db } = setupTestDatabase();
const S = DEMO_SCHEDULE.id;
const DAY = isoDate("2026-10-25");

/** Numeric, leading-zero and unnumbered people around the demo seed (1001–1040, 01011). */
async function addPeople() {
  const spec = [
    ["2", "ب"],
    ["9", "الف"],
    ["10", "پ"],
    ["100", "ت"],
    ["0012", "ث"],
    [null, "ج"],
    [null, "آ"],
  ] as const;
  const created = [];
  for (const [personnelNumber, name] of spec) {
    const user = await createUser(db, {
      // A login identifier is required when there is no number.
      email: personnelNumber ? null : `no-number-${name}@order.invalid`,
      personnelNumber,
      displayName: `${name} ترتیب`,
    });
    await addMembership(db, {
      userId: user.id,
      departmentId: DEMO_ICU.id,
      role: "NURSE",
      startedOn: isoDate("2026-10-01"),
      endedOn: null,
    });
    await addToRoster(db, {
      scheduleId: S,
      userId: user.id,
      role: "NURSE",
      addedBy: U.icuHead.id,
    });
    created.push(user);
  }
  return created;
}

const key = (r: {
  userId: string;
  displayName: string;
  personnelNumber: string | null;
}) => ({ ...r, id: r.userId });
const expectOrdered = <
  T extends {
    userId: string;
    displayName: string;
    personnelNumber: string | null;
  },
>(
  rows: readonly T[],
) => {
  expect(rows.length).toBeGreaterThan(10);
  expect(rows.map((r) => r.userId)).toEqual(
    sortByPersonnelOrder(rows, key).map((r) => r.userId),
  );
};

describe("personnel-number ordering of database reads", () => {
  it("orders every roster read by the shared policy (2 < 9 < 10 < 100, missing last)", async () => {
    await addPeople();
    const roster = await listRoster(db, S);
    expectOrdered(roster);
    const numbers = roster.map((r) => r.personnelNumber);
    expect(numbers.slice(0, 5)).toEqual(["2", "9", "10", "0012", "100"]);
    // Leading zeros survive in the stored value.
    expect(numbers).toContain("0012");
    expect(numbers).toContain("01011");
    expect(numbers.slice(-2)).toEqual([null, null]);

    expectOrdered(await listSchedulingRoster(db, S));
    expectOrdered((await listRosterAssignments(db, S)).roster);
    expectOrdered(await listExportRoster(db, S));
    expectOrdered(
      await listRosterMembersOn(db, { scheduleId: S, onDate: DAY }),
    );
    expectOrdered(
      await listRosterMembersOn(db, {
        scheduleId: S,
        onDate: DAY,
        nursingOnly: true,
      }),
    );
  });

  it("keeps the order for filtered reads", async () => {
    const people = await addPeople();
    const subset = people.slice(0, 4).map((p) => p.id);
    const filtered = await listRosterMembersOn(db, {
      scheduleId: S,
      onDate: DAY,
      userIds: subset,
    });
    expect(filtered.map((r) => r.personnelNumber)).toEqual([
      "2",
      "9",
      "10",
      "100",
    ]);
  });

  it("orders template personnel, department people and roster candidates", async () => {
    await addPeople();
    expectOrdered(await listTemplatePersonnel(db, DEMO_ICU.id, DAY));
    const people = await listDepartmentPersonnel(db, DEMO_ICU.id);
    expect(people.map((p) => p.userId)).toEqual(
      sortByPersonnelOrder(
        await Promise.all(
          people.map(async (p) => {
            const [row] = await db
              .select({ n: users.personnelNumber })
              .from(users)
              .where(eq(users.id, p.userId));
            return { ...p, personnelNumber: row!.n, id: p.userId };
          }),
        ),
        (p) => p,
      ).map((p) => p.userId),
    );
    // The number only orders this projection; it is not part of its shape.
    expect(people[0]).not.toHaveProperty("personnelNumber");
    const current = await readCurrentDepartmentPeople(db, DEMO_ICU.id, DAY);
    expect(current.memberships[0]).not.toHaveProperty("personnelNumber");

    // A newcomer outside the roster appears among candidates in order too.
    const newcomer = async (number: string, name: string) => {
      const user = await createUser(db, {
        personnelNumber: number,
        displayName: name,
      });
      await addMembership(db, {
        userId: user.id,
        departmentId: DEMO_ICU.id,
        role: "NURSE",
        startedOn: isoDate("2026-10-05"),
        endedOn: null,
      });
    };
    await newcomer("30", "ي");
    await newcomer("4", "ك");
    await newcomer("300", "ل");
    const candidates = await listRosterCandidateMemberships(db, {
      scheduleId: S,
    });
    expect(candidates.map((c) => c.personnelNumber)).toEqual([
      "4",
      "30",
      "300",
    ]);
  });

  it("pages the personnel directory and user search in SQL with the same policy", async () => {
    await addPeople();
    const everyone = await db
      .select({
        userId: users.id,
        displayName: users.displayName,
        personnelNumber: users.personnelNumber,
      })
      .from(users);
    const expected = sortByPersonnelOrder(everyone, key).map((u) => u.userId);

    const page = await readPersonnelPage(
      db,
      { search: "", active: "all", admin: "all", page: 1 },
      DAY,
    );
    // One page is 25 rows (+1 look-ahead): the SQL order is the domain order.
    expect(page.map((u) => u.id)).toEqual(expected.slice(0, page.length));
    expect(page.length).toBeGreaterThan(10);

    const found = await searchHospitalUsers(db, "ترتیب", 50);
    expect(found.map((u) => u.id)).toEqual(
      expected.filter((id) => found.some((u) => u.id === id)),
    );
    expect(found.map((u) => u.personnelNumber)).toEqual([
      "2",
      "9",
      "10",
      "0012",
      "100",
      null,
      null,
    ]);
  });
});
