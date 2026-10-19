import { loadEnvConfig } from "@next/env";
import { eq } from "drizzle-orm";

import { addDays } from "../../../src/domain/shared/dates";
import {
  jalaliMonthPeriod,
  parseJalaliMonthParam,
} from "../../../src/features/calendar/jalali";
import { createDatabase } from "../../../src/infrastructure/db/database";
import {
  schedules,
  scheduleVersions,
} from "../../../src/infrastructure/db/schema";
import {
  publishTestRuleSet,
  pinTestRuleSet,
  ruleContent,
} from "../../integration/support/rule-sets";
import { provisionWorkforceReport } from "./workforce-report";

/** Fictional fixtures only. Refuse any destination outside disposable local E2E. */
export async function provisionStaffingReport(
  options: {
    approved?: boolean;
    multiple?: boolean;
    crossMonth?: boolean;
  } = {},
) {
  loadEnvConfig(process.cwd());
  const url = new URL(process.env.DATABASE_URL!);
  if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname))
    throw new Error("Staffing E2E requires a local test database");
  const f = await provisionWorkforceReport(options);
  const { db, pool } = createDatabase(url.href, { max: 1 });
  try {
    const officialPin = await publishTestRuleSet(db, {
      departmentId: f.department.id,
      createdBy: f.head.id,
      content: {
        normal: {
          M: { min: 1, max: 1 },
          E: { min: 1, max: null },
          N: { min: 1, max: 1 },
        },
        holiday: {},
        exceptions: [
          {
            date: f.schedule.period.start,
            period: "M",
            bounds: { min: 1, max: 1 },
            note: null,
          },
        ],
      },
    });
    let currentPin = officialPin;
    if (options.approved) {
      await db
        .update(scheduleVersions)
        .set({ staffingRuleSetVersionId: officialPin })
        .where(eq(scheduleVersions.scheduleId, f.schedule.id));
      currentPin = await publishTestRuleSet(db, {
        departmentId: f.department.id,
        createdBy: f.head.id,
        effectiveFrom: "2000-01-02",
        content: ruleContent({ min: 3, max: 3 }),
      });
    }
    await pinTestRuleSet(db, f.schedule.id, currentPin);
    if (options.crossMonth) {
      // Extend the same partial schedule by two days across the Jalali month boundary.
      const month = jalaliMonthPeriod(parseJalaliMonthParam(f.month)!);
      await db
        .update(schedules)
        .set({
          periodStart: addDays(month.end, 5),
          periodEnd: addDays(month.end, 7),
        })
        .where(eq(schedules.id, f.emptySchedule.id));
      await db
        .update(schedules)
        .set({ periodEnd: addDays(month.end, 2) })
        .where(eq(schedules.id, f.schedule.id));
    }
    return { ...f, officialPin, currentPin };
  } finally {
    await pool.end();
  }
}
