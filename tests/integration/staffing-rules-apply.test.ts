import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { createSchedule } from "../../src/application/schedules/create-schedule";
import { setAssignments } from "../../src/application/schedules/edit-assignments";
import {
  approveSchedule,
  finalizeSchedule,
  returnSchedule,
  submitSchedule,
} from "../../src/application/schedules/lifecycle";
import {
  closePreferenceWindow,
  openPreferenceWindow,
} from "../../src/application/schedules/preference-windows";
import { getScheduleReview } from "../../src/application/schedules/review";
import { discardRevision } from "../../src/application/schedules/schedule-changes";
import { startScheduleRevision } from "../../src/application/schedules/start-revision";
import { getDepartmentCoverageRules } from "../../src/application/staffing-rules/department";
import {
  applyRuleSetToSchedule,
  previewRuleSetApplication,
  RULE_SET_PIN_CHANGED,
} from "../../src/application/staffing-rules/apply";
import type { ActionResult } from "../../src/application/result";
import type { AppContext } from "../../src/application/use-case";
import { isoDate } from "../../src/domain/shared/dates";
import type { AssignmentCode } from "../../src/domain/shifts/shift-type";
import {
  LEGACY_BASELINE_VERSION_ID,
  scheduleRuleSetApplications,
  scheduleVersions,
  users,
} from "../../src/infrastructure/db/schema";
import {
  DEMO_ER,
  DEMO_ICU,
  DEMO_USERS as U,
} from "../../src/infrastructure/db/seed/demo-data";
import { listAssignments } from "../../src/infrastructure/repositories/assignments";
import { listAuditEventsForSchedule } from "../../src/infrastructure/repositories/audit";
import { loadActor } from "../../src/infrastructure/repositories/memberships";
import { findOpenRevision } from "../../src/infrastructure/repositories/revisions";
import { listRoster } from "../../src/infrastructure/repositories/roster";
import { findScheduleById } from "../../src/infrastructure/repositories/schedules";
import { assignmentsFingerprint } from "../../src/application/schedules/lifecycle";
import { setupTestDatabase } from "./support/database";
import { publishTestRuleSet, ruleContent } from "./support/rule-sets";

/**
 * Apply a rule-set version to an existing schedule (D107, D109): a
 * mutation-free preview, an explicit confirmed Apply that changes only the
 * pin, refusal in SUBMITTED / APPROVED, the explicit revision path, rollback
 * and audit.
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
const failure = (result: ActionResult<unknown>) => {
  if (result.ok) throw new Error("expected a failure");
  return result.error;
};
const ctx = async (userId: string): Promise<AppContext> => ({
  db,
  actor: (await loadActor(db, userId, today))!,
  clock: () => now,
});

let head: AppContext;
let supervisor: AppContext;
let admin: AppContext;
let id: string;
/** NICU-like override: M/E/N min 1, N max 1. */
let strict: string;

const schedule = async () => (await findScheduleById(db, id))!;
const step = async (command: typeof finalizeSchedule, context = head) =>
  ok(
    await command(context, {
      scheduleId: id,
      expectedRevision: (await schedule()).revision,
    }),
  );
const edit = async (
  changes: { nurseId: string; date: string; shift: AssignmentCode | null }[],
) =>
  ok(
    await setAssignments(head, {
      scheduleId: id,
      expectedRevision: (await schedule()).revision,
      changes,
    }),
  );
const preview = (context: AppContext, targetVersionId: string) =>
  previewRuleSetApplication(context, {
    departmentId: DEMO_ICU.id,
    scheduleId: id,
    targetVersionId,
  });
const apply = async (
  context: AppContext,
  toVersionId: string,
  overrides: Partial<{ expectedRevision: number; fromVersionId: string }> = {},
) => {
  const s = await schedule();
  return applyRuleSetToSchedule(context, {
    scheduleId: id,
    expectedRevision: s.revision,
    fromVersionId: s.staffingRuleSetVersionId,
    toVersionId,
    confirm: true,
    ...overrides,
  });
};

/** Every rostered nurse decided: day d: roster[d] N, roster[d+2] ME, others OFF; plus a second Night on day 1. */
async function staffWithTwoNightsOnFirstDay() {
  const roster = (await listRoster(db, id)).map((r) => r.userId);
  await edit(
    [first, second].flatMap((date, d) =>
      roster.map((nurseId, i) => ({
        nurseId,
        date,
        shift: (i === d
          ? "N"
          : i === d + 2
            ? "ME"
            : d === 0 && i === roster.length - 1
              ? "N"
              : "OFF") as AssignmentCode,
      })),
    ),
  );
}

beforeEach(async () => {
  await db
    .update(users)
    .set({ isHospitalAdmin: true })
    .where(eq(users.id, U.erHead.id));
  head = await ctx(U.icuHead.id);
  supervisor = await ctx(U.supervisor.id);
  admin = await ctx(U.erHead.id);
  id = ok(
    await createSchedule(head, {
      departmentId: DEMO_ICU.id,
      periodStart: first,
      periodEnd: second,
      label: "Apply",
    }),
  ).scheduleId;
  await step(openPreferenceWindow as typeof finalizeSchedule);
  await step(closePreferenceWindow as typeof finalizeSchedule);
  await staffWithTwoNightsOnFirstDay();
  strict = await publishTestRuleSet(db, {
    departmentId: DEMO_ICU.id,
    createdBy: U.erHead.id,
    effectiveFrom: "2027-01-01",
    content: {
      normal: {
        M: { min: 1, max: null },
        E: { min: 1, max: null },
        N: { min: 1, max: 1 },
      },
      holiday: {},
      exceptions: [],
    },
  });
});

const tableCounts = async () =>
  (
    await db.execute<Record<string, number>>(sql`
      select (select count(*)::int from schedule_rule_set_applications) as applications,
             (select count(*)::int from audit_events) as audit,
             (select sum(revision)::int from schedules) as revisions,
             (select count(*)::int from shift_assignments) as cells
    `)
  ).rows[0];

describe("preview (mutation-free)", () => {
  it("shows the impact of the target without writing anything", async () => {
    const before = await tableCounts();
    const pinBefore = (await schedule()).staffingRuleSetVersionId;
    const result = await preview(supervisor, strict);
    expect(await tableCounts()).toEqual(before);
    expect((await schedule()).staffingRuleSetVersionId).toBe(pinBefore);
    expect(result).toMatchObject({
      allowed: { allowed: true },
      assignmentsChanged: 0,
      current: { versionId: LEGACY_BASELINE_VERSION_ID, legacyBaseline: true },
      target: { versionId: strict, departmentId: DEMO_ICU.id },
      impact: {
        before: { coverageProblems: 0, readyDays: 2 },
        after: { coverageProblems: 1, overstaffing: 1, readyDays: 1 },
        becameNotReady: [first],
        introduced: [
          { date: first, period: "N", kind: "OVERSTAFFING", amount: 1 },
        ],
      },
    });
  });

  it("is a 404 for a Head Nurse, another department's supervisor or version", async () => {
    await expect(preview(head, strict)).rejects.toMatchObject({
      name: "NotFoundError",
    });
    const er = await publishTestRuleSet(db, {
      departmentId: DEMO_ER.id,
      createdBy: U.erHead.id,
      content: ruleContent({ min: 1, max: null }),
    });
    await expect(preview(supervisor, er)).rejects.toMatchObject({
      name: "NotFoundError",
    });
    await expect(
      previewRuleSetApplication(supervisor, {
        departmentId: DEMO_ER.id,
        scheduleId: id,
        targetVersionId: strict,
      }),
    ).rejects.toMatchObject({ name: "NotFoundError" });
  });
});

describe("apply (D107)", () => {
  it("changes only the pin, bumps the revision, records and audits the impact", async () => {
    const cellsBefore = assignmentsFingerprint(await listAssignments(db, id));
    const revisionBefore = (await schedule()).revision;
    const result = ok(await apply(supervisor, strict));
    const after = await schedule();
    expect(after.staffingRuleSetVersionId).toBe(strict);
    expect(after.revision).toBe(revisionBefore + 1);
    expect(result.revision).toBe(after.revision);
    expect(assignmentsFingerprint(await listAssignments(db, id))).toBe(
      cellsBefore,
    );

    const [row] = await db
      .select()
      .from(scheduleRuleSetApplications)
      .where(eq(scheduleRuleSetApplications.scheduleId, id));
    expect(row).toMatchObject({
      fromVersionId: LEGACY_BASELINE_VERSION_ID,
      toVersionId: strict,
      appliedBy: U.supervisor.id,
      rollback: false,
      revisionId: null,
    });
    expect(row!.impact).toMatchObject({
      before: { coverageProblems: 0 },
      after: { coverageProblems: 1, overstaffing: 1 },
      assignmentsChanged: 0,
    });
    const audit = (await listAuditEventsForSchedule(db, id)).find(
      (e) => e.action === "schedule.ruleSetApplied",
    );
    expect(audit).toMatchObject({
      actorId: U.supervisor.id,
      data: expect.objectContaining({
        fromVersionId: LEGACY_BASELINE_VERSION_ID,
        toVersionId: strict,
        assignmentsChanged: 0,
      }),
    });

    // Validation now uses the applied version: overstaffing blocks Finalize.
    const review = await getScheduleReview(head, {
      departmentId: DEMO_ICU.id,
      scheduleId: id,
    });
    expect(review.month.ruleSet.versionId).toBe(strict);
    expect(review.workflow.validation).toMatchObject({
      coverageProblems: 1,
      overstaffing: 1,
    });
    expect(
      failure(
        await finalizeSchedule(head, {
          scheduleId: id,
          expectedRevision: (await schedule()).revision,
        }),
      ).code,
    ).toBe("RULE_VIOLATION");
  });

  it("lets a Hospital Admin apply and allows a controlled rollback", async () => {
    ok(await apply(admin, strict));
    ok(await apply(admin, LEGACY_BASELINE_VERSION_ID));
    expect((await schedule()).staffingRuleSetVersionId).toBe(
      LEGACY_BASELINE_VERSION_ID,
    );
    // Same-lineage earlier version is a rollback; across lineages it is not.
    const nicu2 = await publishTestRuleSet(db, {
      departmentId: DEMO_ICU.id,
      createdBy: U.erHead.id,
      effectiveFrom: "2027-02-01",
      content: ruleContent({ min: 1, max: null }),
    });
    ok(await apply(admin, nicu2));
    ok(await apply(admin, strict));
    const rows = await db
      .select({ rollback: scheduleRuleSetApplications.rollback })
      .from(scheduleRuleSetApplications)
      .where(eq(scheduleRuleSetApplications.scheduleId, id))
      .orderBy(scheduleRuleSetApplications.appliedAt);
    expect(rows.map((r) => r.rollback)).toEqual([false, false, false, true]);
  });

  it("refuses a Head Nurse, a missing confirmation, a stale revision or pin", async () => {
    expect(failure(await apply(head, strict)).code).toBe("FORBIDDEN");
    const s = await schedule();
    expect(
      failure(
        await applyRuleSetToSchedule(supervisor, {
          scheduleId: id,
          expectedRevision: s.revision,
          fromVersionId: s.staffingRuleSetVersionId,
          toVersionId: strict,
          confirm: false,
        } as never),
      ).code,
    ).toBe("VALIDATION");
    expect(
      failure(
        await apply(supervisor, strict, { expectedRevision: s.revision - 1 }),
      ).code,
    ).toBe("CONFLICT");
    expect(
      failure(await apply(supervisor, strict, { fromVersionId: strict })),
    ).toMatchObject({ code: "CONFLICT", reason: RULE_SET_PIN_CHANGED });
    expect(
      failure(await apply(supervisor, LEGACY_BASELINE_VERSION_ID)),
    ).toMatchObject({
      code: "VALIDATION",
      reason: "RULE_SET_ALREADY_PINNED",
    });
    expect((await schedule()).staffingRuleSetVersionId).toBe(
      LEGACY_BASELINE_VERSION_ID,
    );
  });

  it("is refused while SUBMITTED and directly on an APPROVED schedule", async () => {
    await step(finalizeSchedule);
    await step(submitSchedule);
    expect(failure(await apply(supervisor, strict))).toMatchObject({
      code: "INVALID_STATE",
      reason: "APPLY_RULE_SET_WHILE_SUBMITTED",
    });
    await step(approveSchedule, supervisor);
    expect(failure(await apply(supervisor, strict))).toMatchObject({
      code: "INVALID_STATE",
      reason: "APPLY_RULE_SET_REQUIRES_REVISION",
    });
    const previewed = await preview(supervisor, strict);
    expect(previewed.allowed).toEqual({
      allowed: false,
      reason: "APPLY_RULE_SET_REQUIRES_REVISION",
    });
  });
});

describe("approved schedules: explicit revision path (D109)", () => {
  beforeEach(async () => {
    await step(finalizeSchedule);
    await step(submitSchedule);
    await step(approveSchedule, supervisor);
  });

  it("start revision → apply (adds repair days to the scope) → repair → approve; history preserved", async () => {
    // Only the Head Nurse starts it, with a reason.
    expect(
      failure(
        await startScheduleRevision(supervisor, {
          scheduleId: id,
          expectedRevision: (await schedule()).revision,
          reason: "x",
        }),
      ).code,
    ).toBe("FORBIDDEN");
    expect(
      failure(
        await startScheduleRevision(head, {
          scheduleId: id,
          expectedRevision: (await schedule()).revision,
          reason: "  ",
        }),
      ).code,
    ).toBe("VALIDATION");
    ok(
      await startScheduleRevision(head, {
        scheduleId: id,
        expectedRevision: (await schedule()).revision,
        reason: "قوانین پوشش جدید بخش",
      }),
    );
    expect((await schedule()).status).toBe("REVISING");
    const revision = (await findOpenRevision(db, id))!;
    expect(revision.dates).toEqual([]);

    const result = ok(await apply(supervisor, strict));
    expect(result.addedRevisionDates).toEqual([first]);
    expect((await findOpenRevision(db, id))!.dates).toEqual([first]);
    const [row] = await db
      .select()
      .from(scheduleRuleSetApplications)
      .where(eq(scheduleRuleSetApplications.scheduleId, id));
    expect(row!.revisionId).toBe(revision.id);

    // The approved version keeps the rules it was approved under.
    const versions = await db
      .select()
      .from(scheduleVersions)
      .where(eq(scheduleVersions.scheduleId, id));
    expect(versions.map((v) => v.staffingRuleSetVersionId)).toEqual([
      LEGACY_BASELINE_VERSION_ID,
    ]);

    // Repair the day in scope, then the revision goes through approval again.
    const roster = (await listRoster(db, id)).map((r) => r.userId);
    await edit([{ nurseId: roster.at(-1)!, date: first, shift: "OFF" }]);
    await step(submitSchedule);
    const approved = ok(
      await approveSchedule(supervisor, {
        scheduleId: id,
        expectedRevision: (await schedule()).revision,
      }),
    );
    const [v2] = await db
      .select()
      .from(scheduleVersions)
      .where(eq(scheduleVersions.id, approved.versionId!));
    expect(v2!.staffingRuleSetVersionId).toBe(strict);
    expect(
      (
        await db
          .select()
          .from(scheduleVersions)
          .where(eq(scheduleVersions.scheduleId, id))
      ).map((v) => [v.versionNo, v.staffingRuleSetVersionId]),
    ).toEqual(
      expect.arrayContaining([
        [1, LEGACY_BASELINE_VERSION_ID],
        [2, strict],
      ]),
    );
  });

  it("discarding the revision restores the approved version's rules", async () => {
    ok(
      await startScheduleRevision(head, {
        scheduleId: id,
        expectedRevision: (await schedule()).revision,
        reason: "آزمایش",
        dates: [second],
      }),
    );
    expect((await findOpenRevision(db, id))!.dates).toEqual([second]);
    ok(await apply(supervisor, strict));
    await step(discardRevision as typeof finalizeSchedule);
    expect(await schedule()).toMatchObject({
      status: "APPROVED",
      staffingRuleSetVersionId: LEGACY_BASELINE_VERSION_ID,
    });
  });

  it("refuses revision days in the past or outside the period", async () => {
    for (const day of ["2026-09-30", "2027-01-05"])
      expect(
        failure(
          await startScheduleRevision(head, {
            scheduleId: id,
            expectedRevision: (await schedule()).revision,
            reason: "x",
            dates: [day],
          }),
        ).code,
      ).toBe("VALIDATION");
  });
});

describe("department coverage rules page data (D108)", () => {
  it("lets the Head Nurse read without Apply; Supervisor and Admin may apply", async () => {
    const forHead = await getDepartmentCoverageRules(head, {
      departmentId: DEMO_ICU.id,
    });
    expect(forHead.canApply).toBe(false);
    expect(
      (
        await getDepartmentCoverageRules(supervisor, {
          departmentId: DEMO_ICU.id,
        })
      ).canApply,
    ).toBe(true);
    expect(
      (await getDepartmentCoverageRules(admin, { departmentId: DEMO_ICU.id }))
        .canApply,
    ).toBe(true);
    // The override and the Hospital Default, never another department's or a draft.
    expect(forHead.versions.map((v) => v.departmentId)).toEqual([
      DEMO_ICU.id,
      null,
    ]);
    const mine = forHead.schedules.find((s) => s.scheduleId === id)!;
    expect(mine).toMatchObject({
      pinnedVersionId: LEGACY_BASELINE_VERSION_ID,
      suggestedVersionId: null,
    });
  });

  it("counts pins of this department only", async () => {
    // An ER schedule on the baseline must not be counted for ICU.
    ok(
      await createSchedule(admin, {
        departmentId: DEMO_ER.id,
        periodStart: first,
        periodEnd: second,
        label: "ER",
      }),
    );
    const data = await getDepartmentCoverageRules(head, {
      departmentId: DEMO_ICU.id,
    });
    const icuBaselinePins = data.schedules.filter(
      (s) => s.pinnedVersionId === LEGACY_BASELINE_VERSION_ID,
    ).length;
    expect(
      data.versions.find((v) => v.id === LEGACY_BASELINE_VERSION_ID)!.pins
        .schedules,
    ).toBe(icuBaselinePins);
  });

  it("is a 404 for another department's Head Nurse", async () => {
    await expect(
      getDepartmentCoverageRules(await ctx(U.icuNurse1.id), {
        departmentId: DEMO_ICU.id,
      }),
    ).rejects.toMatchObject({ name: "NotFoundError" });
    await expect(
      getDepartmentCoverageRules(head, { departmentId: DEMO_ER.id }),
    ).rejects.toMatchObject({ name: "NotFoundError" });
  });
});

describe("past days the lifecycle can no longer repair (D109)", () => {
  // `first` (2026-12-22) has passed; `second` is today. Under `strict` the
  // two Nights on `first` are overstaffing (a new blocking finding).
  const later = new Date("2026-12-23T08:00:00Z");
  const at = (c: AppContext, clock = later): AppContext => ({
    ...c,
    clock: () => clock,
  });
  const refusal = {
    allowed: false,
    reason: "APPLY_RULE_SET_UNREPAIRABLE_PAST_DATES",
  };
  const pastOverstaffing = {
    date: first,
    period: "N",
    kind: "OVERSTAFFING",
    amount: 1,
  };

  /** Preview refuses, without writing; Apply refuses inside its transaction. */
  async function expectRefused() {
    const before = await tableCounts();
    const pin = (await schedule()).staffingRuleSetVersionId;
    const scope = (await findOpenRevision(db, id))?.dates ?? null;
    const previewed = await preview(at(supervisor), strict);
    expect(previewed.allowed).toEqual(refusal);
    expect(previewed.unrepairablePastDates).toEqual([first]);
    expect(previewed.unrepairableProblems).toEqual([
      expect.objectContaining(pastOverstaffing),
    ]);
    expect(previewed.revisionDatesToAdd).toEqual([]);
    expect(await tableCounts()).toEqual(before);

    expect(failure(await apply(at(supervisor), strict))).toMatchObject({
      code: "INVALID_STATE",
      reason: "APPLY_RULE_SET_UNREPAIRABLE_PAST_DATES",
    });
    expect(failure(await apply(at(admin), strict))).toMatchObject({
      reason: "APPLY_RULE_SET_UNREPAIRABLE_PAST_DATES",
    });
    expect(await tableCounts()).toEqual(before);
    expect((await schedule()).staffingRuleSetVersionId).toBe(pin);
    expect((await findOpenRevision(db, id))?.dates ?? null).toEqual(scope);
  }

  it("FINALIZED: a new blocking finding on a past day refuses Preview and Apply", async () => {
    await step(finalizeSchedule);
    await expectRefused();
  });

  it("REVISING: a past day outside the revision scope refuses Preview and Apply", async () => {
    await step(finalizeSchedule);
    await step(submitSchedule);
    await step(approveSchedule, supervisor);
    ok(
      await startScheduleRevision(at(head), {
        scheduleId: id,
        expectedRevision: (await schedule()).revision,
        reason: "قوانین پوشش جدید بخش",
        dates: [second],
      }),
    );
    expect((await schedule()).status).toBe("REVISING");
    await expectRefused();
  });

  it("a returned revision (still revision-scoped) refuses Preview and Apply", async () => {
    await step(finalizeSchedule);
    await step(submitSchedule);
    await step(approveSchedule, supervisor);
    ok(
      await startScheduleRevision(at(head), {
        scheduleId: id,
        expectedRevision: (await schedule()).revision,
        reason: "قوانین پوشش جدید بخش",
      }),
    );
    await step(submitSchedule, at(head));
    ok(
      await returnSchedule(at(supervisor), {
        scheduleId: id,
        expectedRevision: (await schedule()).revision,
        comment: "دوباره بررسی شود",
      }),
    );
    expect((await schedule()).status).toBe("RETURNED");
    expect(await findOpenRevision(db, id)).not.toBeNull();
    await expectRefused();
  });

  it("allows Apply when the new findings fall on today or later only", async () => {
    await step(finalizeSchedule);
    const onFirst = new Date("2026-12-22T08:00:00Z");
    const previewed = await preview(at(supervisor, onFirst), strict);
    expect(previewed.allowed).toEqual({ allowed: true });
    expect(previewed.unrepairablePastDates).toEqual([]);
    expect(previewed.unrepairableProblems).toEqual([]);
    ok(await apply(at(supervisor, onFirst), strict));
    expect((await schedule()).staffingRuleSetVersionId).toBe(strict);
  });

  it("keeps DRAFT/PLANNING and a first-cycle RETURNED applicable (the planner edits the whole period)", async () => {
    expect((await schedule()).status).toBe("PLANNING");
    expect((await preview(at(supervisor), strict)).allowed).toEqual({
      allowed: true,
    });

    await step(finalizeSchedule);
    await step(submitSchedule);
    ok(
      await returnSchedule(supervisor, {
        scheduleId: id,
        expectedRevision: (await schedule()).revision,
        comment: "دوباره بررسی شود",
      }),
    );
    expect((await schedule()).status).toBe("RETURNED");
    expect(await findOpenRevision(db, id)).toBeNull();
    ok(await apply(at(supervisor), strict));
    expect((await schedule()).staffingRuleSetVersionId).toBe(strict);
  });

  it("still allows a valid rollback to an earlier version after the day has passed", async () => {
    // v2 of the same lineage is stricter still (Evenings need 5).
    const stricter = await publishTestRuleSet(db, {
      departmentId: DEMO_ICU.id,
      createdBy: U.erHead.id,
      effectiveFrom: "2027-02-01",
      content: {
        normal: {
          M: { min: 1, max: null },
          E: { min: 5, max: null },
          N: { min: 1, max: 1 },
        },
        holiday: {},
        exceptions: [],
      },
    });
    await step(finalizeSchedule);
    ok(await apply(supervisor, stricter));

    // Back to v1 introduces nothing new or worse, on any day.
    const previewed = await preview(at(supervisor), strict);
    expect(previewed).toMatchObject({
      allowed: { allowed: true },
      rollback: true,
      unrepairablePastDates: [],
    });
    ok(await apply(at(supervisor), strict));
    const [, rollback] = await db
      .select()
      .from(scheduleRuleSetApplications)
      .where(eq(scheduleRuleSetApplications.scheduleId, id))
      .orderBy(scheduleRuleSetApplications.appliedAt);
    expect(rollback).toMatchObject({
      fromVersionId: stricter,
      toVersionId: strict,
      rollback: true,
    });
  });
});
