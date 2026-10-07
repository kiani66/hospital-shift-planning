import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { adjustSchedule } from "../../src/application/schedules/schedule-changes";
import { createSchedule } from "../../src/application/schedules/create-schedule";
import { setAssignments } from "../../src/application/schedules/edit-assignments";
import {
  approveSchedule,
  finalizeSchedule,
  submitSchedule,
} from "../../src/application/schedules/lifecycle";
import {
  closePreferenceWindow,
  openPreferenceWindow,
} from "../../src/application/schedules/preference-windows";
import { getScheduleReview } from "../../src/application/schedules/review";
import { discardRevision } from "../../src/application/schedules/schedule-changes";
import type { ActionResult } from "../../src/application/result";
import type { AppContext } from "../../src/application/use-case";
import { isoDate, type IsoDate } from "../../src/domain/shared/dates";
import type { AssignmentCode } from "../../src/domain/shifts/shift-type";
import {
  LEGACY_BASELINE_VERSION_ID,
  scheduleVersions,
} from "../../src/infrastructure/db/schema";
import {
  DEMO_ER,
  DEMO_ICU,
  DEMO_USERS as U,
} from "../../src/infrastructure/db/seed/demo-data";
import { listAuditEventsForSchedule } from "../../src/infrastructure/repositories/audit";
import { loadActor } from "../../src/infrastructure/repositories/memberships";
import { listRoster } from "../../src/infrastructure/repositories/roster";
import { findScheduleById } from "../../src/infrastructure/repositories/schedules";
import { setupTestDatabase } from "./support/database";
import {
  pinTestRuleSet,
  publishTestRuleSet,
  ruleContent,
} from "./support/rule-sets";

/**
 * Schedule pinning (D106): a schedule pins exactly one rule-set version at
 * creation (by period_start), keeps it while new versions are published, is
 * validated against it everywhere, records it on approval and gets it back
 * when a revision is discarded.
 */

const { db } = setupTestDatabase();
const now = new Date("2026-10-01T08:00:00Z");
const today = isoDate("2026-10-01");
const first = isoDate("2026-12-22");
const second = isoDate("2026-12-23");

const ok = <T>(result: ActionResult<T>): T => {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.data;
};
const ctx = async (userId: string): Promise<AppContext> => ({
  db,
  actor: (await loadActor(db, userId, today))!,
  clock: () => now,
});
let head: AppContext;
let erHead: AppContext;
let supervisor: AppContext;

beforeEach(async () => {
  head = await ctx(U.icuHead.id);
  erHead = await ctx(U.erHead.id);
  supervisor = await ctx(U.supervisor.id);
});

const create = async (
  context: AppContext,
  departmentId: string,
  start: IsoDate = first,
  end: IsoDate = second,
) =>
  ok(
    await createSchedule(context, {
      departmentId,
      periodStart: start,
      periodEnd: end,
      label: "pinning",
    }),
  );
const pinOf = async (scheduleId: string) =>
  (await findScheduleById(db, scheduleId))!.staffingRuleSetVersionId;
const icuOverride = (effectiveFrom: string, min = 1, max: number | null = 1) =>
  publishTestRuleSet(db, {
    departmentId: DEMO_ICU.id,
    createdBy: U.supervisor.id,
    effectiveFrom,
    content: ruleContent({ min, max }),
  });

describe("pinning at creation (period_start)", () => {
  it("pins the Hospital Default legacy baseline when no override exists", async () => {
    const created = await create(head, DEMO_ICU.id);
    expect(created.staffingRuleSetVersionId).toBe(LEGACY_BASELINE_VERSION_ID);
    expect(await pinOf(created.scheduleId)).toBe(LEGACY_BASELINE_VERSION_ID);
    const [event] = (
      await listAuditEventsForSchedule(db, created.scheduleId)
    ).filter((e) => e.action === "schedule.created");
    expect(event!.data).toMatchObject({
      staffingRuleSetVersionId: LEGACY_BASELINE_VERSION_ID,
      staffingRuleSetVersionNo: 1,
      staffingRuleSetDepartmentId: null,
    });
  });

  it("selects an override effective exactly on period_start, not one day later", async () => {
    const onStart = await icuOverride(first);
    expect((await create(head, DEMO_ICU.id)).staffingRuleSetVersionId).toBe(
      onStart,
    );
  });

  it("ignores an override that becomes effective after period_start (mid-period)", async () => {
    await icuOverride(second);
    expect((await create(head, DEMO_ICU.id)).staffingRuleSetVersionId).toBe(
      LEGACY_BASELINE_VERSION_ID,
    );
  });

  it("never lets another department inherit a department override", async () => {
    await icuOverride("2000-01-01");
    expect((await create(erHead, DEMO_ER.id)).staffingRuleSetVersionId).toBe(
      LEGACY_BASELINE_VERSION_ID,
    );
  });

  it("does not move existing pins when a new version is published", async () => {
    const { scheduleId } = await create(head, DEMO_ICU.id);
    const revisionBefore = (await findScheduleById(db, scheduleId))!.revision;
    await icuOverride("2000-01-01");
    await publishTestRuleSet(db, {
      departmentId: null,
      createdBy: U.supervisor.id,
      effectiveFrom: "2001-01-01",
      content: ruleContent({ min: 3, max: 6 }),
    });
    expect(await pinOf(scheduleId)).toBe(LEGACY_BASELINE_VERSION_ID);
    expect((await findScheduleById(db, scheduleId))!.revision).toBe(
      revisionBefore,
    );
  });
});

describe("validation uses the pinned version only", () => {
  let id: string;
  const revision = async () => (await findScheduleById(db, id))!.revision;
  const edit = async (
    changes: { nurseId: string; date: string; shift: AssignmentCode | null }[],
  ) =>
    ok(
      await setAssignments(head, {
        scheduleId: id,
        expectedRevision: await revision(),
        changes,
      }),
    );
  const step = async (command: typeof finalizeSchedule, context = head) =>
    command(context, { scheduleId: id, expectedRevision: await revision() });

  /** Every rostered nurse decided: one N and one ME per day, the rest OFF. */
  async function staffOnePerBucket() {
    const roster = (await listRoster(db, id)).map((r) => r.userId);
    await edit(
      [first, second].flatMap((date, d) =>
        roster.map((nurseId, i) => ({
          nurseId,
          date,
          shift: (i === d ? "N" : i === d + 2 ? "ME" : "OFF") as AssignmentCode,
        })),
      ),
    );
    return roster;
  }

  beforeEach(async () => {
    id = (await create(head, DEMO_ICU.id)).scheduleId;
    ok(await step(openPreferenceWindow as typeof finalizeSchedule));
    ok(await step(closePreferenceWindow as typeof finalizeSchedule));
  });

  it("saves an incomplete, understaffed draft and blocks Finalize", async () => {
    await edit([{ nurseId: U.icuNurse1.id, date: first, shift: "N" }]);
    const result = await step(finalizeSchedule);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("RULE_VIOLATION");
  });

  it("blocks Finalize on overstaffing once the pinned version sets a maximum", async () => {
    const roster = await staffOnePerBucket();
    // Legacy baseline: valid.
    expect(
      (
        await getScheduleReview(head, {
          departmentId: DEMO_ICU.id,
          scheduleId: id,
        })
      ).workflow.actions.finalize?.blockers,
    ).toEqual([]);
    // Pin a version with N max 1, then put a second nurse on Night.
    await pinTestRuleSet(db, id, await icuOverride("2000-01-01", 1, 1));
    await edit([{ nurseId: roster.at(-1)!, date: first, shift: "N" }]);
    const result = await step(finalizeSchedule);
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "RULE_VIOLATION",
        violations: [
          expect.objectContaining({
            rule: "STAFFING",
            period: "N",
            status: "ABOVE_MAXIMUM",
            covered: 2,
          }),
        ],
      },
    });
  });

  it("blocks a post-finalization adjustment that introduces overstaffing (D102)", async () => {
    const roster = await staffOnePerBucket();
    await pinTestRuleSet(db, id, await icuOverride("2000-01-01", 1, 1));
    ok(await step(finalizeSchedule));
    const nurse = roster.find((_, i) => i > 3)!;
    const result = await adjustSchedule(head, {
      scheduleId: id,
      expectedRevision: await revision(),
      changes: [{ nurseId: nurse, date: second, shift: "N" }],
      reasonCode: "STAFFING_NEED",
    });
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "RULE_VIOLATION",
        violations: [
          expect.objectContaining({
            rule: "STAFFING",
            status: "ABOVE_MAXIMUM",
          }),
        ],
      },
    });
  });

  it("records the pin on the approved version and restores it when a revision is discarded", async () => {
    const roster = await staffOnePerBucket();
    ok(await step(finalizeSchedule));
    ok(await step(submitSchedule));
    const approved = ok(await step(approveSchedule, supervisor));
    const [version] = await db
      .select()
      .from(scheduleVersions)
      .where(eq(scheduleVersions.id, approved.versionId!));
    expect(version!.staffingRuleSetVersionId).toBe(LEGACY_BASELINE_VERSION_ID);

    // Open a revision with an adjustment, then change the pin inside it.
    // roster[2] worked ME on the first day and is OFF on the second.
    ok(
      await adjustSchedule(head, {
        scheduleId: id,
        expectedRevision: await revision(),
        changes: [{ nurseId: roster[2]!, date: second, shift: "E" }],
        reasonCode: "STAFFING_NEED",
      }),
    );
    expect((await findScheduleById(db, id))!.status).toBe("REVISING");
    const other = await icuOverride("2000-01-01", 0, null);
    await pinTestRuleSet(db, id, other);

    ok(await step(discardRevision as typeof finalizeSchedule));
    expect(await pinOf(id)).toBe(LEGACY_BASELINE_VERSION_ID);
    const discarded = (await listAuditEventsForSchedule(db, id)).find(
      (e) => e.action === "revision.discarded",
    );
    expect(discarded!.data).toMatchObject({
      ruleSetRestoredFrom: other,
      ruleSetRestoredTo: LEGACY_BASELINE_VERSION_ID,
    });
  });
});
