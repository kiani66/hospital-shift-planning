import { loadEnvConfig } from "@next/env";
import { eq } from "drizzle-orm";

import { createSchedule } from "../../../src/application/schedules/create-schedule";
import { addDays } from "../../../src/domain/shared/dates";
import {
  createDatabase,
  type Database,
} from "../../../src/infrastructure/db/database";
import { auditEvents } from "../../../src/infrastructure/db/schema";
import { listUserAccessHistory } from "../../../src/infrastructure/repositories/management";
import { loadActor } from "../../../src/infrastructure/repositories/memberships";
import { listRoster } from "../../../src/infrastructure/repositories/roster";
import {
  findUserByEmail,
  findUserById,
} from "../../../src/infrastructure/repositories/users";

import type { provisionPersonnel } from "./personnel";

type Fixture = Awaited<ReturnType<typeof provisionPersonnel>>;

function safeAccount(user: Awaited<ReturnType<typeof findUserById>>) {
  return user
    ? {
        id: user.id,
        displayName: user.displayName,
        email: user.email,
        isActive: user.isActive,
        isHospitalAdmin: user.isHospitalAdmin,
      }
    : null;
}

async function withDatabase<T>(read: (db: Database) => Promise<T>): Promise<T> {
  loadEnvConfig(process.cwd());
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required for personnel E2E tests");
  const { db, pool } = createDatabase(url, { max: 1 });
  try {
    return await read(db);
  } finally {
    await pool.end();
  }
}

/** Safe test inspection; no credentials or tokens are returned/logged. */
export async function readPersonMutationState(
  fixture: Fixture,
  userId: string,
) {
  return withDatabase(async (db) => ({
    user: safeAccount(await findUserById(db, userId)),
    history: await listUserAccessHistory(db, userId),
    events: await db
      .select({
        action: auditEvents.action,
        entityId: auditEvents.entityId,
        data: auditEvents.data,
      })
      .from(auditEvents)
      .where(eq(auditEvents.actorId, fixture.people.admin.id))
      .orderBy(auditEvents.id),
  }));
}

export function personByEmail(email: string) {
  return withDatabase(async (db) =>
    safeAccount(await findUserByEmail(db, email)),
  );
}
export function readPersonnelRoster(scheduleId: string) {
  return withDatabase((db) => listRoster(db, scheduleId));
}

/** Uses the scheduling use case with the fixture's actual Head Nurse, independent of admin powers. */
export function createPersonnelRoster(fixture: Fixture, offset: number) {
  return withDatabase(async (db) => {
    const actor = (await loadActor(db, fixture.people.head.id, fixture.today))!;
    const result = await createSchedule(
      { db, actor },
      {
        departmentId: fixture.own.id,
        periodStart: addDays(fixture.today, offset),
        periodEnd: addDays(fixture.today, offset + 6),
        label: `Personnel regression ${offset}`,
      },
    );
    if (!result.ok) throw new Error(result.error.code);
    return result.data.scheduleId;
  });
}
