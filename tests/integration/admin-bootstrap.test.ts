import { readFileSync } from "node:fs";

import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { bootstrapHospitalAdmin } from "../../src/application/management/bootstrap";
import { DEMO_USERS as U } from "../../src/infrastructure/db/seed/demo-data";
import { auditEvents } from "../../src/infrastructure/db/schema";
import { countHospitalAdmins } from "../../src/infrastructure/repositories/management";
import {
  createUser,
  findUserById,
} from "../../src/infrastructure/repositories/users";
import { setupTestDatabase } from "./support/database";

const { db } = setupTestDatabase();
const input = {
  email: U.icuHead.email,
  confirm: "ESTABLISH_FIRST_HOSPITAL_ADMIN",
};

describe("explicit first-admin bootstrap", () => {
  it("grants nobody automatically and bootstraps only the named account", async () => {
    expect(await countHospitalAdmins(db, false)).toBe(0);
    expect(await bootstrapHospitalAdmin(db, input)).toEqual({
      userId: U.icuHead.id,
    });
    expect((await findUserById(db, U.icuHead.id))?.isHospitalAdmin).toBe(true);
    expect((await findUserById(db, U.erHead.id))?.isHospitalAdmin).toBe(false);
    expect(await db.select().from(auditEvents)).toMatchObject([
      {
        actorId: U.icuHead.id,
        action: "user.hospitalAdminBootstrapped",
        data: { source: "operatorBootstrap" },
      },
    ]);
  });
  it("requires explicit confirmation and an existing active password account", async () => {
    for (const candidate of [
      { email: U.icuHead.email },
      { ...input, confirm: "yes" },
      { ...input, email: "absent@phase10.invalid" },
      { ...input, email: U.inactiveNurse.email },
    ])
      await expect(bootstrapHospitalAdmin(db, candidate)).rejects.toThrow();
    const noPassword = await createUser(db, {
      email: "no-password@phase10.invalid",
      displayName: "No password",
    });
    await expect(
      bootstrapHospitalAdmin(db, { ...input, email: noPassword.email }),
    ).rejects.toThrow("password-provisioned");
    expect(await countHospitalAdmins(db, false)).toBe(0);
    expect(await db.select().from(auditEvents)).toHaveLength(0);
  });
  it("is not a reusable operator authority-grant bypass", async () => {
    await bootstrapHospitalAdmin(db, input);
    await expect(
      bootstrapHospitalAdmin(db, { ...input, email: U.erHead.email }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await db.execute(
      sql`update users set is_active = false where id = ${U.icuHead.id}`,
    );
    await expect(
      bootstrapHospitalAdmin(db, { ...input, email: U.erHead.email }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await countHospitalAdmins(db, false)).toBe(1);
  });
  it("serializes concurrent bootstrap attempts", async () => {
    const results = await Promise.allSettled([
      bootstrapHospitalAdmin(db, input),
      bootstrapHospitalAdmin(db, { ...input, email: U.erHead.email }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await countHospitalAdmins(db)).toBe(1);
    expect(await db.select().from(auditEvents)).toHaveLength(1);
  });
});

describe("backward-compatible Hospital Admin migration", () => {
  it("preserves existing user data and grants none on upgrade", async () => {
    const migration = readFileSync(
      "src/infrastructure/db/migrations/0008_hospital_admin.sql",
      "utf8",
    );
    await db.transaction(async (tx) => {
      await tx.execute(sql`create schema phase10_upgrade_test`);
      await tx.execute(sql`set local search_path to phase10_upgrade_test`);
      await tx.execute(
        sql`create table users (id uuid primary key, email text not null, display_name text not null, password_hash text, is_active boolean not null)`,
      );
      await tx.execute(
        sql`insert into users values (${U.icuHead.id}, 'preserved@phase10.invalid', 'Preserved', 'existing-hash', true), (${U.erHead.id}, 'inactive@phase10.invalid', 'Inactive', null, false)`,
      );
      const before = await tx.execute(sql`select * from users order by id`);
      await tx.execute(sql.raw(migration));
      const after = await tx.execute<{ is_hospital_admin: boolean }>(
        sql`select * from users order by id`,
      );
      expect(
        after.rows.map(({ is_hospital_admin, ...row }) => {
          expect(is_hospital_admin).toBe(false);
          return row;
        }),
      ).toEqual(before.rows);
      await tx.execute(sql`set local search_path to public`);
      await tx.execute(sql`drop schema phase10_upgrade_test cascade`);
    });
  });
});
