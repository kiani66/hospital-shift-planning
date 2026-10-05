import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { verifyPassword } from "../../src/infrastructure/auth/password";
import {
  DEMO_ICU,
  DEMO_PASSWORD,
  DEMO_SCHEDULE,
  DEMO_USERS,
} from "../../src/infrastructure/db/seed/demo-data";
import {
  assertSeedAllowed,
  SeedNotAllowedError,
  seedDemoData,
} from "../../src/infrastructure/db/seed/seed";
import { setupTestDatabase } from "./support/database";

const { db } = setupTestDatabase({ seed: false });

const counts = async () => {
  const { rows } = await db.execute<Record<string, number>>(sql`
    select
      (select count(*)::int from departments) as departments,
      (select count(*)::int from users) as users,
      (select count(*)::int from department_memberships) as memberships,
      (select count(*)::int from supervisor_assignments) as supervisors,
      (select count(*)::int from schedules) as schedules,
      (select count(*)::int from schedule_roster) as roster,
      (select count(*)::int from shift_types) as shift_types
  `);
  return rows[0];
};

describe("demo seed", () => {
  it("loads the demo data set", async () => {
    const summary = await seedDemoData(db);
    expect(summary).toEqual({
      departments: 2,
      users: 12,
      memberships: 12,
      supervisorAssignments: 2,
      schedules: 1,
      rosterEntries: 6,
    });
    expect(await counts()).toEqual({
      departments: 2,
      users: 12,
      memberships: 12,
      supervisors: 2,
      schedules: 1,
      roster: 6,
      shift_types: 5,
    });
  });

  it("is repeatable: a second run yields identical rows", async () => {
    await seedDemoData(db);
    const snapshot = async () =>
      (
        await db.execute(
          sql`select id, email, display_name from users order by id`,
        )
      ).rows;
    const first = await snapshot();
    await seedDemoData(db);
    expect(await snapshot()).toEqual(first);
    expect(await counts()).toMatchObject({ users: 12, roster: 6 });
  });

  it("gives every department a head nurse and several nurses, and one supervisor for both", async () => {
    await seedDemoData(db);
    const { rows } = await db.execute<{
      code: string;
      heads: number;
      nurses: number;
      supervisors: number;
    }>(sql`
      select d.code,
        count(*) filter (where m.role = 'HEAD_NURSE' and m.ended_on is null)::int as heads,
        count(*) filter (where m.role = 'NURSE' and m.ended_on is null)::int as nurses,
        (select count(*)::int from supervisor_assignments s where s.department_id = d.id) as supervisors
      from departments d join department_memberships m on m.department_id = d.id
      group by d.id, d.code order by d.code
    `);
    expect(rows).toEqual([
      { code: "er", heads: 1, nurses: 3, supervisors: 1 },
      { code: "icu", heads: 1, nurses: 5, supervisors: 1 },
    ]);
  });

  it("gives every demo account an Argon2id hash of the demo password, and deactivates one", async () => {
    await seedDemoData(db);
    const { rows } = await db.execute<{
      password_hash: string;
      is_active: boolean;
      email: string;
    }>(sql`select password_hash, is_active, email from users`);
    for (const row of rows) {
      expect(row.password_hash).toMatch(/^\$argon2id\$/);
      expect(await verifyPassword(row.password_hash, DEMO_PASSWORD)).toBe(true);
    }
    expect(rows.filter((r) => !r.is_active).map((r) => r.email)).toEqual([
      DEMO_USERS.inactiveNurse.email,
    ]);
  });

  it("uses only fictional people on reserved e-mail domains", async () => {
    await seedDemoData(db);
    const { rows } = await db.execute<{ email: string }>(
      sql`select email from users`,
    );
    expect(rows.every((r) => r.email.endsWith("@demo.invalid"))).toBe(true);
  });

  it("snapshots the ICU roster (head nurse included, former ER member now in ICU)", async () => {
    await seedDemoData(db);
    const { rows } = await db.execute<{ user_id: string; role: string }>(
      sql`select user_id, role from schedule_roster where schedule_id = ${DEMO_SCHEDULE.id} order by user_id`,
    );
    expect(rows).toContainEqual({
      user_id: DEMO_USERS.icuHead.id,
      role: "HEAD_NURSE",
    });
    expect(rows).toContainEqual({
      user_id: DEMO_USERS.transferNurse.id,
      role: "NURSE",
    });
    expect(rows.map((r) => r.user_id)).not.toContain(DEMO_USERS.erNurse1.id);
    // Left before the period (and deactivated): not on the roster.
    expect(rows.map((r) => r.user_id)).not.toContain(
      DEMO_USERS.inactiveNurse.id,
    );
    expect(DEMO_SCHEDULE.departmentId).toBe(DEMO_ICU.id);
  });

  it.each([[{ NODE_ENV: "production" }], [{ VERCEL_ENV: "production" }]])(
    "refuses to run in production (%j)",
    (env) => {
      expect(() => assertSeedAllowed(env)).toThrow(SeedNotAllowedError);
    },
  );

  it.each([[{ NODE_ENV: "development" }], [{ VERCEL_ENV: "preview" }], [{}]])(
    "runs outside production (%j)",
    (env) => {
      expect(() => assertSeedAllowed(env)).not.toThrow();
    },
  );
});
