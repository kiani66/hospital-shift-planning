import { eq } from "drizzle-orm";
import { isoDate } from "../../../src/domain/shared/dates";
import type { PreferenceValue } from "../../../src/domain/shifts/shift-type";
import { createDatabase } from "../../../src/infrastructure/db/database";
import { users } from "../../../src/infrastructure/db/schema";
import {
  setAssignment,
  listAssignments,
} from "../../../src/infrastructure/repositories/assignments";
import { setPreference } from "../../../src/infrastructure/repositories/preferences";
import {
  createUser,
  findUserByEmail,
} from "../../../src/infrastructure/repositories/users";
import { findScheduleById } from "../../../src/infrastructure/repositories/schedules";
import { snapshotRosterFromMemberships } from "../../../src/infrastructure/repositories/roster";
import {
  addMembership,
  loadActor,
} from "../../../src/infrastructure/repositories/memberships";
import {
  pinTestRuleSet,
  publishTestRuleSet,
  ruleContent,
} from "../../integration/support/rule-sets";
import { LONG_NAME, provisionReviewDepartment } from "./review";

export const DAILY_DATE = "2026-10-27";
export async function provisionDailyPreferences(contention = false) {
  const d = await provisionReviewDepartment();
  const { db, pool } = createDatabase(process.env.DATABASE_URL!, { max: 1 });
  try {
    const people = await Promise.all(
      [
        d.nurseEmail,
        d.nurseEmail.replace("nurse1.", "nurse2."),
        d.nurseEmail.replace("nurse1.", "nurse3."),
        d.headEmail,
      ].map((email) => findUserByEmail(db, email)),
    );
    const [n1, n2, n3, head] = people.map((p) => p!);
    await db
      .update(users)
      .set({ displayName: LONG_NAME })
      .where(eq(users.id, n2!.id));
    const ids = [n1!.id, n2!.id, n3!.id, head!.id];
    const actor = (await loadActor(db, head!.id, isoDate("2026-10-21")))!;
    const secretary = await createUser(db, {
      displayName: "منشی آزمایشی",
      email: `secretary.${d.code}@e2e.invalid`,
    });
    await addMembership(db, {
      userId: secretary.id,
      departmentId: actor.memberships[0]!.departmentId,
      role: "SECRETARY",
      startedOn: isoDate("2026-01-01"),
    });
    await snapshotRosterFromMemberships(db, {
      scheduleId: d.abanId,
      addedBy: head!.id,
    });
    await setPreference(db, {
      scheduleId: d.abanId,
      userId: secretary.id,
      date: isoDate(DAILY_DATE),
      value: "E",
    });
    for (const [i, value] of (["M", "ME", "N", "OFF"] as const).entries())
      await setPreference(db, {
        scheduleId: d.abanId,
        userId: ids[i]!,
        date: isoDate(DAILY_DATE),
        value,
      });
    // A second day demonstrates preservation and neighboring-night rest findings.
    for (const [i, value] of (["M", "ME", "M", "E"] as const).entries())
      await setPreference(db, {
        scheduleId: d.abanId,
        userId: ids[i]!,
        date: isoDate("2026-10-28"),
        value,
      });
    for (const [userId, shift] of [
      [n1!.id, "OFF"],
      [n2!.id, "H"],
      [head!.id, "E"],
    ] as const)
      await setAssignment(db, {
        scheduleId: d.abanId,
        userId,
        date: isoDate("2026-10-28"),
        shift,
        updatedBy: head!.id,
      });
    if (contention) {
      const actor = (await loadActor(db, head!.id, isoDate("2026-10-21")))!;
      const versionId = await publishTestRuleSet(db, {
        departmentId: actor.memberships[0]!.departmentId,
        createdBy: head!.id,
        content: ruleContent({ min: 1, max: 1 }),
      });
      await pinTestRuleSet(db, d.abanId, versionId);
    }
    return {
      ...d,
      ids,
      names: [n1!.displayName, LONG_NAME, n3!.displayName, head!.displayName],
    };
  } finally {
    await pool.end();
  }
}
export type DailyFixture = Awaited<
  ReturnType<typeof provisionDailyPreferences>
>;
export async function dailyState(d: DailyFixture) {
  const { db, pool } = createDatabase(process.env.DATABASE_URL!, { max: 1 });
  try {
    return {
      schedule: await findScheduleById(db, d.abanId),
      assignments: await listAssignments(db, d.abanId),
    };
  } finally {
    await pool.end();
  }
}
export async function changeDailyPreference(
  d: DailyFixture,
  value: PreferenceValue,
) {
  const { db, pool } = createDatabase(process.env.DATABASE_URL!, { max: 1 });
  try {
    await setPreference(db, {
      scheduleId: d.abanId,
      userId: d.ids[0]!,
      date: isoDate(DAILY_DATE),
      value,
    });
  } finally {
    await pool.end();
  }
}
