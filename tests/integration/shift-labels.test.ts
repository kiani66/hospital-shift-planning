import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  ShiftReferenceDataError,
  getShiftLabels,
} from "../../src/application/shifts/labels";
import { isoDate } from "../../src/domain/shared/dates";
import type { DbExecutor } from "../../src/infrastructure/db/database";
import {
  DEMO_SCHEDULE,
  DEMO_USERS,
} from "../../src/infrastructure/db/seed/demo-data";
import {
  listAssignments,
  setAssignment,
} from "../../src/infrastructure/repositories/assignments";
import { SHIFT_LABELS } from "../support/shift-labels";
import { setupTestDatabase } from "./support/database";

const { db } = setupTestDatabase();

class Rollback extends Error {}

/** Runs `body` in a transaction that is always rolled back (reference data stays as migrated). */
async function inRolledBackTransaction(
  body: (tx: DbExecutor) => Promise<void>,
) {
  await expect(
    db.transaction(async (tx) => {
      await body(tx);
      throw new Rollback();
    }),
  ).rejects.toBeInstanceOf(Rollback);
}

describe("shift labels from shift_types", () => {
  it("loads the migrated labels: ME reads «طولانی» (0012), OFF keeps «استراحت»", async () => {
    expect(await getShiftLabels(db)).toEqual(SHIFT_LABELS);
    const { rows } = await db.execute<{ code: string; label: string }>(
      sql`select code, label from shift_types order by sort_order`,
    );
    expect(rows).toEqual([
      { code: "M", label: "صبح" },
      { code: "E", label: "عصر" },
      { code: "N", label: "شب" },
      { code: "ME", label: "طولانی" },
      { code: "OFF", label: "استراحت" },
    ]);
  });

  it("a changed label changes the name only; assignments keep the stable code", async () => {
    await inRolledBackTransaction(async (tx) => {
      await tx.execute(
        sql`update shift_types set label = 'مرخصی‌روز' where code = 'OFF'`,
      );
      const date = isoDate("2026-10-25");
      await setAssignment(tx, {
        scheduleId: DEMO_SCHEDULE.id,
        userId: DEMO_USERS.icuNurse1.id,
        date,
        shift: "OFF",
        updatedBy: DEMO_USERS.icuHead.id,
      });
      expect((await getShiftLabels(tx)).OFF).toBe("مرخصی‌روز");
      expect(await listAssignments(tx, DEMO_SCHEDULE.id)).toEqual([
        { nurseId: DEMO_USERS.icuNurse1.id, date, shift: "OFF" },
      ]);
    });
  });

  it("ignores a row the domain does not know: it never becomes a shift code", async () => {
    await inRolledBackTransaction(async (tx) => {
      await tx.execute(
        sql`insert into shift_types (code, label, covers, is_night, sort_order)
            values ('H', 'تعطیل', ARRAY[]::text[], false, 6)`,
      );
      expect(Object.keys(await getShiftLabels(tx))).toEqual([
        "M",
        "E",
        "N",
        "ME",
        "OFF",
      ]);
    });
  });

  it("fails explicitly when a required row is missing", async () => {
    await inRolledBackTransaction(async (tx) => {
      await tx.execute(sql`delete from shift_types where code = 'OFF'`);
      await expect(getShiftLabels(tx)).rejects.toBeInstanceOf(
        ShiftReferenceDataError,
      );
    });
  });
});
