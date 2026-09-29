import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { isoDate } from "../../src/domain/shared/dates";
import { createDatabase } from "../../src/infrastructure/db/database";
import {
  DEMO_ER,
  DEMO_ICU,
  DEMO_SCHEDULE,
  DEMO_USERS,
} from "../../src/infrastructure/db/seed/demo-data";
import {
  createSchedule,
  findScheduleById,
  listSchedulesForDepartment,
  lockScheduleForUpdate,
  updateSchedule,
} from "../../src/infrastructure/repositories/schedules";
import { setupTestDatabase } from "./support/database";

const { db, url } = setupTestDatabase();
const mehr = { start: isoDate("2026-09-23"), end: isoDate("2026-10-22") };

describe("schedules repository", () => {
  it("creates a DRAFT schedule at revision 0 with ISO date strings", async () => {
    const s = await createSchedule(db, {
      departmentId: DEMO_ER.id,
      period: mehr,
      label: "مهر ۱۴۰۵",
      createdBy: DEMO_USERS.erHead.id,
    });
    expect(s).toMatchObject({
      status: "DRAFT",
      revision: 0,
      currentVersionId: null,
      period: mehr,
    });
    expect(typeof s.period.start).toBe("string");
    expect(await findScheduleById(db, s.id)).toEqual(s);
  });

  it("returns period dates as plain YYYY-MM-DD strings (no timezone shift)", async () => {
    const s = await findScheduleById(db, DEMO_SCHEDULE.id);
    expect(s?.period).toEqual({ start: "2026-10-23", end: "2026-11-21" });
  });

  it("lists a department's schedules by period", async () => {
    await createSchedule(db, {
      departmentId: DEMO_ICU.id,
      period: mehr,
      label: "مهر",
      createdBy: DEMO_USERS.icuHead.id,
    });
    const list = await listSchedulesForDepartment(db, DEMO_ICU.id);
    expect(list.map((s) => s.period.start)).toEqual([
      "2026-09-23",
      "2026-10-23",
    ]);
  });

  it("allows one schedule per department and period start", async () => {
    await expect(
      createSchedule(db, {
        departmentId: DEMO_ICU.id,
        period: { start: isoDate("2026-10-23"), end: isoDate("2026-11-20") },
        label: "dup",
        createdBy: DEMO_USERS.icuHead.id,
      }),
    ).rejects.toThrow();
  });

  it("rejects a period that ends before it starts", async () => {
    await expect(
      createSchedule(db, {
        departmentId: DEMO_ER.id,
        period: { start: isoDate("2026-10-10"), end: isoDate("2026-10-01") },
        label: "bad",
        createdBy: DEMO_USERS.erHead.id,
      }),
    ).rejects.toThrow();
  });

  describe("optimistic concurrency", () => {
    it("applies a change at the expected revision and bumps it", async () => {
      const updated = await updateSchedule(db, {
        id: DEMO_SCHEDULE.id,
        expectedRevision: 0,
        status: "PLANNING",
      });
      expect(updated).toMatchObject({ status: "PLANNING", revision: 1 });
    });

    it("rejects a stale revision without changing anything", async () => {
      await updateSchedule(db, {
        id: DEMO_SCHEDULE.id,
        expectedRevision: 0,
        status: "PLANNING",
      });
      expect(
        await updateSchedule(db, {
          id: DEMO_SCHEDULE.id,
          expectedRevision: 0,
          status: "FINALIZED",
        }),
      ).toBeNull();
      expect(await findScheduleById(db, DEMO_SCHEDULE.id)).toMatchObject({
        status: "PLANNING",
        revision: 1,
      });
    });
  });

  describe("row locking (SELECT … FOR UPDATE)", () => {
    it("returns null when locking an unknown schedule", async () => {
      await db.transaction(async (tx) => {
        expect(
          await lockScheduleForUpdate(
            tx,
            "99999999-0000-4000-8000-000000000000",
          ),
        ).toBeNull();
      });
    });

    it("blocks a second transaction until the first commits", async () => {
      const other = createDatabase(url, { max: 1 });
      const events: string[] = [];
      try {
        let releaseFirst!: () => void;
        const firstHoldsLock = new Promise<void>((resolve) => {
          void db.transaction(async (tx) => {
            await lockScheduleForUpdate(tx, DEMO_SCHEDULE.id);
            events.push("first locked");
            resolve();
            await new Promise<void>((r) => (releaseFirst = r));
            await updateSchedule(tx, {
              id: DEMO_SCHEDULE.id,
              expectedRevision: 0,
              status: "PLANNING",
            });
            events.push("first committing");
          });
        });
        await firstHoldsLock;

        const second = other.db.transaction(async (tx) => {
          const locked = await lockScheduleForUpdate(tx, DEMO_SCHEDULE.id);
          events.push("second locked");
          return locked;
        });

        await new Promise((r) => setTimeout(r, 300));
        expect(events).toEqual(["first locked"]); // still waiting on the lock

        releaseFirst();
        const seen = await second;
        expect(events).toEqual([
          "first locked",
          "first committing",
          "second locked",
        ]);
        // The waiter sees the committed state, not a stale copy.
        expect(seen).toMatchObject({ status: "PLANNING", revision: 1 });
      } finally {
        await other.pool.end();
      }
    });

    it("releases the lock on rollback", async () => {
      await expect(
        db.transaction(async (tx) => {
          await lockScheduleForUpdate(tx, DEMO_SCHEDULE.id);
          throw new Error("abort");
        }),
      ).rejects.toThrow("abort");
      const { rows } = await db.execute(
        sql`select id from schedules where id = ${DEMO_SCHEDULE.id} for update nowait`,
      );
      expect(rows).toHaveLength(1);
    });
  });
});
