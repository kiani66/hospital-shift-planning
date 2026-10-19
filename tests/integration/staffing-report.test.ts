import { randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConflictError, NotFoundError } from "../../src/application/errors";
import { setAssignments } from "../../src/application/schedules/edit-assignments";
import {
  getStaffingReport,
  type StaffingReportInput,
  type StaffingReportSource,
} from "../../src/application/staffing-report/queries";
import type { AppContext } from "../../src/application/use-case";
import { addDays, dayOfWeek, isoDate } from "../../src/domain/shared/dates";
import { ValidationError } from "../../src/domain/shared/errors";
import { unwrap } from "../../src/domain/shared/result";
import type { AssignmentCode } from "../../src/domain/shifts/shift-type";
import { summarizeStaffing } from "../../src/domain/staffing-report/summary";
import { createDatabase } from "../../src/infrastructure/db/database";
import {
  LEGACY_BASELINE_VERSION_ID,
  schedules,
  scheduleVersionAssignments,
  staffingRuleSetRequirements,
  staffingRuleSetVersions,
  users,
} from "../../src/infrastructure/db/schema";
import {
  DEMO_ER,
  DEMO_ICU,
  DEMO_USERS as U,
} from "../../src/infrastructure/db/seed/demo-data";
import {
  listAssignments,
  setAssignment,
} from "../../src/infrastructure/repositories/assignments";
import { listExportRoster } from "../../src/infrastructure/repositories/excel-templates";
import {
  addMembership,
  endMembership,
  loadActor,
} from "../../src/infrastructure/repositories/memberships";
import * as revisions from "../../src/infrastructure/repositories/revisions";
import {
  addToRoster,
  snapshotRosterFromMemberships,
} from "../../src/infrastructure/repositories/roster";
import * as scheduleRepository from "../../src/infrastructure/repositories/schedules";
import * as ruleSets from "../../src/infrastructure/repositories/staffing-rules";
import {
  createSubmission,
  decideSubmission,
} from "../../src/infrastructure/repositories/submissions";
import { createUser } from "../../src/infrastructure/repositories/users";
import * as versions from "../../src/infrastructure/repositories/versions";
import { setupTestDatabase } from "./support/database";
import {
  pinTestRuleSet,
  publishTestRuleSet,
  ruleContent,
} from "./support/rule-sets";

const { db, pool, url } = setupTestDatabase();
const today = isoDate("2027-05-01");
const now = new Date("2027-05-01T06:30:00Z");
const period = { start: isoDate("2027-05-07"), end: isoDate("2027-05-09") };
let scheduleId: string;
let secretaryId: string;
let head: AppContext;
const context = async (userId: string): Promise<AppContext> => ({
  db,
  actor: (await loadActor(db, userId, today))!,
  clock: () => now,
});
const input = (
  source: StaffingReportSource = "DEFAULT",
): StaffingReportInput => ({ departmentId: DEMO_ICU.id, scheduleId, source });
const report = (source: StaffingReportSource = "DEFAULT", ctx = head) =>
  getStaffingReport(ctx, input(source));
const schedule = async () =>
  (await scheduleRepository.findScheduleById(db, scheduleId))!;
const assign = (
  userId: string,
  shift: AssignmentCode,
  date = period.start,
  target = db,
) =>
  setAssignment(target, {
    scheduleId,
    userId,
    date,
    shift,
    updatedBy: U.icuHead.id,
  });
const nursingCount = async () =>
  (await listExportRoster(db, scheduleId)).filter((r) => r.role !== "SECRETARY")
    .length;
const override = (min = 3, max: number | null = 3) =>
  publishTestRuleSet(db, {
    departmentId: DEMO_ICU.id,
    createdBy: U.supervisor.id,
    content: ruleContent({ min, max }),
  });

beforeEach(async () => {
  head = await context(U.icuHead.id);
  const secretary = await createUser(db, {
    email: "staffing-secretary@test.invalid",
    displayName: "Secretary",
  });
  secretaryId = secretary.id;
  await addMembership(db, {
    userId: secretaryId,
    departmentId: DEMO_ICU.id,
    role: "SECRETARY",
    startedOn: period.start,
  });
  const created = await scheduleRepository.createSchedule(db, {
    departmentId: DEMO_ICU.id,
    period,
    label: "staffing partial period",
    createdBy: U.icuHead.id,
  });
  scheduleId = created.id;
  await snapshotRosterFromMemberships(db, {
    scheduleId,
    addedBy: U.icuHead.id,
  });
  await assign(U.icuNurse1.id, "ME");
  await assign(U.icuHead.id, "N");
  await assign(U.icuNurse2.id, "OFF");
  await assign(U.icuNurse3.id, "H");
  await assign(secretaryId, "ME");
});

/** Legacy/incomplete approval fixtures: exercise reads without changing workflow validators. */
async function approveFixture() {
  return db.transaction(async (tx) => {
    const submission = await createSubmission(tx, {
      scheduleId,
      submittedBy: U.icuHead.id,
    });
    const version = await versions.createVersionFromWorkingCopy(tx, {
      scheduleId,
      submissionId: submission.id,
      approvedBy: U.supervisor.id,
    });
    await decideSubmission(tx, {
      id: submission.id,
      decision: "APPROVED",
      decidedBy: U.supervisor.id,
      now,
    });
    const revision = await revisions.findOpenRevision(tx, scheduleId);
    if (revision)
      await revisions.closeRevision(tx, {
        id: revision.id,
        status: "APPROVED",
        now,
      });
    await tx
      .update(schedules)
      .set({
        currentVersionId: version.id,
        status: "APPROVED",
        revision: sql`${schedules.revision} + 1`,
      })
      .where(eq(schedules.id, scheduleId));
    return version;
  });
}
async function openDraft(dates = [period.start]) {
  const id = await revisions.startRevision(db, {
    scheduleId,
    reason: "report revision",
    startedBy: U.icuHead.id,
    dates,
  });
  await db
    .update(schedules)
    .set({ status: "REVISING" })
    .where(eq(schedules.id, scheduleId));
  return id;
}

describe("staffing report source and matching rule pin", () => {
  it.each(["DRAFT", "PLANNING", "FINALIZED", "SUBMITTED", "RETURNED"] as const)(
    "uses provisional working data before approval in %s",
    async (status) => {
      await db
        .update(schedules)
        .set({ status })
        .where(eq(schedules.id, scheduleId));
      const result = await report();
      expect(result.schedule).toMatchObject({
        id: scheduleId,
        departmentId: DEMO_ICU.id,
        status,
      });
      expect(result.period).toEqual(period);
      expect(result.reportingDayCount).toBe(3);
      expect(result.rows).toHaveLength(9);
      expect(result.rows.slice(0, 3).map((r) => [r.period, r.covered])).toEqual(
        [
          ["M", 1],
          ["E", 1],
          ["N", 1],
        ],
      );
      expect(result.provenance).toEqual({
        source: "WORKING_COPY",
        isProvisional: true,
        approvedVersion: null,
        revisionId: null,
      });
      expect(result.requestedSource).toBe("DEFAULT");
      expect(result.ruleSet).toMatchObject({
        versionId: LEGACY_BASELINE_VERSION_ID,
        scope: "HOSPITAL_DEFAULT",
        departmentId: null,
        versionNo: 1,
      });
      expect(result.undecidedNurseDays).toBe((await nursingCount()) * 3 - 4);
      expect(result).not.toHaveProperty("ready");
    },
  );

  it("isolates official and draft decisions AND pins and reads the whole draft period", async () => {
    const approved = await approveFixture();
    const revisionId = await openDraft();
    const currentPin = await override();
    await pinTestRuleSet(db, scheduleId, currentPin);
    await assign(U.icuNurse1.id, "E");
    await assign(U.icuNurse4.id, "M", period.end); // Outside the opened revision scope.
    for (const status of ["REVISING", "SUBMITTED", "RETURNED"] as const) {
      await db
        .update(schedules)
        .set({ status })
        .where(eq(schedules.id, scheduleId));
      const official = await report();
      const draft = await report("REVISION_DRAFT");
      expect(official.provenance).toMatchObject({
        source: "APPROVED_VERSION",
        isProvisional: false,
        approvedVersion: {
          id: approved.id,
          versionNo: 1,
          approvedAt: approved.approvedAt,
        },
      });
      expect(official.ruleSet.versionId).toBe(LEGACY_BASELINE_VERSION_ID);
      expect(official.rows[0]).toMatchObject({
        covered: 1,
        min: 1,
        max: null,
        status: "WITHIN_BOUNDS",
      });
      expect(official.rows[6]!.covered).toBe(0);
      expect(draft.provenance).toEqual({
        source: "REVISION_DRAFT",
        isProvisional: true,
        approvedVersion: official.provenance.approvedVersion,
        revisionId,
      });
      expect(draft.ruleSet).toMatchObject({
        versionId: currentPin,
        scope: "DEPARTMENT_OVERRIDE",
        departmentId: DEMO_ICU.id,
      });
      expect(draft.rows[0]).toMatchObject({
        covered: 0,
        min: 3,
        max: 3,
        status: "SHORTAGE",
        gap: 3,
      });
      expect(draft.rows[6]).toMatchObject({
        date: period.end,
        covered: 1,
        min: 3,
      });
      expect(draft.rows).toHaveLength(9);
    }
  });

  it("keeps approved gaps UNDECIDED instead of filling from the working copy", async () => {
    const approved = await approveFixture();
    await db
      .delete(scheduleVersionAssignments)
      .where(eq(scheduleVersionAssignments.versionId, approved.id));
    const official = await report();
    expect(official.rows.every((r) => r.covered === 0)).toBe(true);
    expect(official.undecidedNurseDays).toBe((await nursingCount()) * 3);
    expect(official.totals.shortagePersonPeriods).toBe(9);
    await openDraft();
    expect((await report("REVISION_DRAFT")).rows[0]!.covered).toBe(1);
  });

  it("uses the approved pointer independently of schedule status and ignores the unselected current pin", async () => {
    const approved = await approveFixture();
    const foreign = await publishTestRuleSet(db, {
      departmentId: DEMO_ER.id,
      createdBy: U.supervisor.id,
      content: ruleContent({ min: 9, max: 9 }),
    });
    await pinTestRuleSet(db, scheduleId, foreign);
    await assign(U.icuNurse1.id, "OFF");
    for (const status of [
      "DRAFT",
      "PLANNING",
      "FINALIZED",
      "SUBMITTED",
      "RETURNED",
      "REVISING",
      "APPROVED",
    ] as const) {
      await db
        .update(schedules)
        .set({ status })
        .where(eq(schedules.id, scheduleId));
      const official = await report();
      expect(official.provenance.approvedVersion!.id).toBe(approved.id);
      expect(official.ruleSet.versionId).toBe(LEGACY_BASELINE_VERSION_ID);
      expect(official.rows[0]!.covered).toBe(1);
    }
  });

  it("permits an empty initial revision scope", async () => {
    await approveFixture();
    const revisionId = await openDraft([]);
    expect((await report("REVISION_DRAFT")).provenance.revisionId).toBe(
      revisionId,
    );
  });

  it("rejects an explicit revision without an approved baseline, never falling back", async () => {
    await expect(report("REVISION_DRAFT")).rejects.toMatchObject({
      reason: "STAFFING_REVISION_DRAFT_UNAVAILABLE",
    });
    await openDraft();
    await expect(report("REVISION_DRAFT")).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it.each(["APPROVED", "DISCARDED"] as const)(
    "rejects a closed %s revision",
    async (status) => {
      await approveFixture();
      const id = await openDraft();
      await revisions.closeRevision(db, { id, status, now });
      await expect(report("REVISION_DRAFT")).rejects.toMatchObject({
        reason: "STAFFING_REVISION_DRAFT_UNAVAILABLE",
      });
    },
  );

  it.each(["DRAFT", "PLANNING", "FINALIZED", "APPROVED"] as const)(
    "rejects stray OPEN revision data in %s",
    async (status) => {
      await approveFixture();
      await openDraft();
      await db
        .update(schedules)
        .set({ status })
        .where(eq(schedules.id, scheduleId));
      await expect(report("REVISION_DRAFT")).rejects.toMatchObject({
        reason: "STAFFING_REVISION_DRAFT_UNAVAILABLE",
      });
      expect((await report()).provenance.source).toBe("APPROVED_VERSION");
    },
  );

  it.each(["foreign", "closed", "outside", "malformed date", "malformed id"])(
    "rejects %s revision metadata",
    async (kind) => {
      await approveFixture();
      await openDraft();
      const revision = (await revisions.findOpenRevision(db, scheduleId))!;
      vi.spyOn(revisions, "findOpenRevision").mockResolvedValue({
        ...revision,
        ...(kind === "foreign" ? { scheduleId: randomUUID() } : {}),
        ...(kind === "closed" ? { status: "DISCARDED" as const } : {}),
        ...(kind === "outside" ? { dates: [addDays(period.end, 1)] } : {}),
        ...(kind === "malformed date"
          ? { dates: ["2027-05-08x" as never] }
          : {}),
        ...(kind === "malformed id" ? { id: "invalid" } : {}),
      });
      await expect(report("REVISION_DRAFT")).rejects.toMatchObject({
        reason: "STAFFING_REVISION_DRAFT_UNAVAILABLE",
      });
    },
  );
});

describe("broken approval and staffing pin metadata fail closed", () => {
  it.each([
    "missing",
    "foreign",
    "identity",
    "number",
    "timestamp",
    "missing timestamp",
  ])("rejects %s approved version metadata for both sources", async (kind) => {
    const version = await approveFixture();
    await openDraft();
    vi.spyOn(versions, "findVersionById").mockResolvedValue(
      kind === "missing"
        ? null
        : {
            ...version,
            ...(kind === "foreign" ? { scheduleId: randomUUID() } : {}),
            ...(kind === "identity" ? { id: randomUUID() } : {}),
            ...(kind === "number" ? { versionNo: 0 } : {}),
            ...(kind === "timestamp"
              ? { approvedAt: new Date("invalid") }
              : {}),
            ...(kind === "missing timestamp"
              ? { approvedAt: null as never }
              : {}),
          },
    );
    for (const source of ["DEFAULT", "REVISION_DRAFT"] as const)
      await expect(report(source)).rejects.toMatchObject({
        code: "CONFLICT",
        reason: "STAFFING_APPROVED_VERSION_INCONSISTENT",
      });
  });

  it.each([randomUUID(), "invalid", ""])(
    "rejects inconsistent approved pointer %s",
    async (currentVersionId) => {
      vi.spyOn(scheduleRepository, "findScheduleById").mockResolvedValue({
        ...(await schedule()),
        currentVersionId,
      });
      await expect(report()).rejects.toMatchObject({
        reason: "STAFFING_APPROVED_VERSION_INCONSISTENT",
      });
    },
  );

  it.each(["DEFAULT", "REVISION_DRAFT"] as const)(
    "rejects malformed selected pin for %s",
    async (source) => {
      if (source === "DEFAULT") {
        const version = await approveFixture();
        vi.spyOn(versions, "findVersionById").mockResolvedValue({
          ...version,
          staffingRuleSetVersionId: "invalid",
        });
      } else {
        await approveFixture();
        await openDraft();
        vi.spyOn(scheduleRepository, "findScheduleById").mockResolvedValue({
          ...(await schedule()),
          staffingRuleSetVersionId: "invalid",
        });
      }
      await expect(report(source)).rejects.toMatchObject({
        reason: "STAFFING_REPORT_RULE_SET_INCONSISTENT",
      });
    },
  );

  it.each([
    "missing",
    "identity",
    "foreign",
    "draft",
    "number",
    "date",
    "publication",
  ])("rejects %s pinned rule-set metadata", async (kind) => {
    const version = (await ruleSets.findRuleSetVersion(
      db,
      LEGACY_BASELINE_VERSION_ID,
    ))!;
    vi.spyOn(ruleSets, "findRuleSetVersion").mockResolvedValue(
      kind === "missing"
        ? null
        : {
            ...version,
            ...(kind === "identity" ? { id: randomUUID() } : {}),
            ...(kind === "foreign" ? { departmentId: DEMO_ER.id } : {}),
            ...(kind === "draft" ? { status: "DRAFT" as const } : {}),
            ...(kind === "number" ? { versionNo: 0 } : {}),
            ...(kind === "date" ? { effectiveFrom: null } : {}),
            ...(kind === "publication"
              ? { publishedAt: new Date("invalid") }
              : {}),
          },
    );
    await expect(report()).rejects.toMatchObject({
      code: "CONFLICT",
      reason: "STAFFING_REPORT_RULE_SET_INCONSISTENT",
    });
  });

  it("rejects missing NORMAL requirement rows instead of inventing bounds", async () => {
    await db
      .delete(staffingRuleSetRequirements)
      .where(
        and(
          eq(staffingRuleSetRequirements.versionId, LEGACY_BASELINE_VERSION_ID),
          eq(staffingRuleSetRequirements.coveragePeriod, "E"),
        ),
      );
    await expect(report()).rejects.toMatchObject({
      reason: "STAFFING_REPORT_RULE_SET_INCONSISTENT",
    });
  });

  it("requires a valid approved baseline pin even when the draft selects a different pin", async () => {
    const approved = await approveFixture();
    await openDraft();
    await pinTestRuleSet(db, scheduleId, await override());
    vi.spyOn(versions, "findVersionById").mockResolvedValue({
      ...approved,
      staffingRuleSetVersionId: "invalid",
    });
    await expect(report("REVISION_DRAFT")).rejects.toMatchObject({
      reason: "STAFFING_REPORT_RULE_SET_INCONSISTENT",
    });
  });

  it("accepts retired pins and never reselects newly published rules", async () => {
    const pin = await override(2, 5);
    await pinTestRuleSet(db, scheduleId, pin);
    await db
      .update(staffingRuleSetVersions)
      .set({
        status: "RETIRED",
        retiredAt: now,
        retiredBy: U.supervisor.id,
        retiredReason: "WITHDRAWN",
      })
      .where(eq(staffingRuleSetVersions.id, pin));
    await override(9, 9);
    const result = await report();
    expect(result.ruleSet).toMatchObject({ versionId: pin, status: "RETIRED" });
    expect(result.rows[0]!.min).toBe(2);
  });
});

describe("historical roster, holidays and domain calculation", () => {
  it("preserves historical inactive decisions and uses snapshot roles", async () => {
    await endMembership(db, {
      userId: U.icuNurse1.id,
      departmentId: DEMO_ICU.id,
      endedOn: addDays(today, -1),
    });
    await addMembership(db, {
      userId: U.icuNurse1.id,
      departmentId: DEMO_ICU.id,
      role: "SECRETARY",
      startedOn: today,
    });
    await db
      .update(users)
      .set({ isActive: false })
      .where(eq(users.id, U.icuNurse1.id));
    const fresh = await createUser(db, {
      email: "new-current@test.invalid",
      displayName: "Not rostered",
    });
    await addMembership(db, {
      userId: fresh.id,
      departmentId: DEMO_ICU.id,
      role: "NURSE",
      startedOn: today,
    });
    const result = await report();
    expect(result.rows[0]!.covered).toBe(1); // Inactive historical ME nurse still covers M/E.
    expect(result.rows[2]!.covered).toBe(1); // Head Nurse.
    const pin = await ruleSets.loadRuleSetContent(
      db,
      LEGACY_BASELINE_VERSION_ID,
    );
    const expected = unwrap(
      summarizeStaffing({
        period,
        roster: await listExportRoster(db, scheduleId),
        assignments: await listAssignments(db, scheduleId),
        ruleSet: pin,
        officialHolidays: new Set(),
      }),
    );
    expect(result).toMatchObject(expected);
    expect(result.undecidedNurseDays).toBe((await nursingCount()) * 3 - 4);
  });

  it("uses the supported holiday port once, retaining exception > holiday > normal", async () => {
    const pin = await publishTestRuleSet(db, {
      departmentId: DEMO_ICU.id,
      createdBy: U.supervisor.id,
      content: ruleContent(
        { min: 3, max: 6 },
        {
          holiday: { M: { min: 0, max: 0 }, E: { min: 0, max: 0 } },
          exceptions: [
            {
              date: period.start,
              period: "M",
              bounds: { min: 4, max: null },
              note: null,
            },
          ],
        },
      ),
    });
    await pinTestRuleSet(db, scheduleId, pin);
    const calendar = vi.fn(async () => [
      { date: period.start, name: "Official test holiday" },
    ]);
    const result = await report("DEFAULT", {
      ...head,
      holidays: { listOfficialHolidays: calendar },
    });
    expect(calendar).toHaveBeenCalledExactlyOnceWith(period);
    expect(
      result.rows.slice(0, 3).map((r) => [r.source, r.min, r.status, r.gap]),
    ).toEqual([
      ["EXCEPTION", 4, "SHORTAGE", 3],
      ["HOLIDAY", 0, "EXCESS", 1],
      ["NORMAL", 3, "SHORTAGE", 2],
    ]);
    expect(dayOfWeek(period.start)).toBe(5);
    expect((await report()).rows[1]).toMatchObject({
      source: "NORMAL",
      min: 3,
    });
  });

  it("does not combine another schedule in the same calendar month", async () => {
    const other = await scheduleRepository.createSchedule(db, {
      departmentId: DEMO_ICU.id,
      period: { start: addDays(period.end, 1), end: addDays(period.end, 2) },
      label: "other",
      createdBy: U.icuHead.id,
    });
    await snapshotRosterFromMemberships(db, {
      scheduleId: other.id,
      addedBy: U.icuHead.id,
    });
    await setAssignment(db, {
      scheduleId: other.id,
      userId: U.icuNurse1.id,
      date: other.period.start,
      shift: "ME",
      updatedBy: U.icuHead.id,
    });
    const result = await report();
    expect(result.period).toEqual(period);
    expect(result.rows).toHaveLength(9);
    expect(result.rows.every((r) => r.date <= period.end)).toBe(true);
  });

  it("propagates typed domain validation for malformed stored assignment dates", async () => {
    await assign(U.icuNurse1.id, "M", addDays(period.end, 1));
    await expect(report()).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("Head Nurse authorization and indistinguishable not-found", () => {
  it("denies Nurse, Secretary, Supervisor, Admin-only and a foreign Head Nurse for both sources", async () => {
    const admin = await createUser(db, {
      email: "staffing-admin@test.invalid",
      displayName: "Admin",
    });
    await db
      .update(users)
      .set({ isHospitalAdmin: true })
      .where(eq(users.id, admin.id));
    for (const userId of [
      U.icuNurse1.id,
      secretaryId,
      U.supervisor.id,
      admin.id,
      U.erHead.id,
    ]) {
      const ctx = {
        ...head,
        actor: (await loadActor(db, userId, period.start))!,
      };
      for (const source of ["DEFAULT", "REVISION_DRAFT"] as const)
        await expect(report(source, ctx)).rejects.toEqual(
          new NotFoundError("Schedule"),
        );
    }
  });

  it("denies inactive or former Head Nurses, and allows combined roles only through Head Nurse membership", async () => {
    await db
      .update(users)
      .set({ isHospitalAdmin: true })
      .where(eq(users.id, U.icuHead.id));
    expect(
      (await report("DEFAULT", await context(U.icuHead.id))).rows,
    ).toHaveLength(9);
    await db
      .update(users)
      .set({ isActive: false })
      .where(eq(users.id, U.icuHead.id));
    await expect(
      report("DEFAULT", await context(U.icuHead.id)),
    ).rejects.toBeInstanceOf(NotFoundError);
    await db
      .update(users)
      .set({ isActive: true })
      .where(eq(users.id, U.icuHead.id));
    await endMembership(db, {
      userId: U.icuHead.id,
      departmentId: DEMO_ICU.id,
      endedOn: addDays(today, -1),
    });
    await expect(
      report("DEFAULT", await context(U.icuHead.id)),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("makes malformed, unknown, foreign and denied identities indistinguishable", async () => {
    const foreign = await scheduleRepository.createSchedule(db, {
      departmentId: DEMO_ER.id,
      period,
      label: "foreign",
      createdBy: U.erHead.id,
    });
    for (const value of [
      null,
      {},
      { ...input(), scheduleId: "invalid" },
      { ...input(), scheduleId: randomUUID() },
      { ...input(), scheduleId: foreign.id },
      { ...input(), departmentId: "invalid" },
      { ...input(), departmentId: DEMO_ER.id },
      { ...input(), departmentId: randomUUID() },
    ])
      await expect(
        getStaffingReport(head, value as StaffingReportInput),
      ).rejects.toEqual(new NotFoundError("Schedule"));
  });

  it("validates a source only after schedule authorization", async () => {
    for (const source of ["unknown", undefined, null, 1]) {
      const value = { ...input(), source } as unknown as StaffingReportInput;
      await expect(getStaffingReport(head, value)).rejects.toBeInstanceOf(
        ValidationError,
      );
      await expect(
        getStaffingReport(await context(U.icuNurse1.id), value),
      ).rejects.toEqual(new NotFoundError("Schedule"));
      await expect(
        getStaffingReport(head, { ...value, scheduleId: randomUUID() }),
      ).rejects.toEqual(new NotFoundError("Schedule"));
    }
  });
});

// Real connections and bounded barriers, matching the workforce snapshot tests.
const readers: ReturnType<typeof createDatabase>[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(readers.splice(0).map((reader) => reader.pool.end()));
});
function recordedReader(pauseAfterSchedule = false) {
  const reader = createDatabase(url, { max: 1 });
  readers.push(reader);
  const statements: string[] = [];
  let reached!: () => void;
  let release!: () => void;
  const paused = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  let stopped = false;
  reader.pool.on("connect", (client) => {
    const original = client.query.bind(client) as (
      ...args: never[]
    ) => Promise<unknown>;
    client.query = (async (...args: never[]) => {
      const first: unknown = args[0];
      const statement =
        typeof first === "string" ? first : (first as { text: string }).text;
      statements.push(statement);
      const result = await original(...args);
      if (
        pauseAfterSchedule &&
        !stopped &&
        statement.includes('from "schedules"')
      ) {
        stopped = true;
        reached();
        await hold;
      }
      return result;
    }) as typeof client.query;
  });
  return {
    ...reader,
    statements,
    release,
    async waitUntilPaused() {
      let timer!: ReturnType<typeof setTimeout>;
      try {
        await Promise.race([
          paused,
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("Report snapshot barrier not reached")),
              5000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
async function snapshotTables() {
  const tables = await pool.query<{ tablename: string }>(
    "select tablename from pg_tables where schemaname = 'public' order by tablename",
  );
  const result: Record<string, unknown> = {};
  for (const { tablename } of tables.rows) {
    const name = `"${tablename.replaceAll('"', '""')}"`;
    const rows = await pool.query(
      `select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) as data from ${name} t`,
    );
    result[tablename] = rows.rows[0].data;
  }
  return result;
}

describe("coherent snapshot, bounded queries and no writes", () => {
  it("uses one read-only repeatable-read transaction and only the selected assignment table", async () => {
    await approveFixture();
    await openDraft();
    await pinTestRuleSet(db, scheduleId, await override());
    const before = await snapshotTables();
    const reader = recordedReader();
    for (const source of ["DEFAULT", "REVISION_DRAFT"] as const) {
      reader.statements.length = 0;
      await report(source, { ...head, db: reader.db });
      expect(reader.statements[0]).toMatch(
        /begin isolation level repeatable read read only/i,
      );
      expect(reader.statements.filter((s) => /^begin/i.test(s))).toHaveLength(
        1,
      );
      expect(
        reader.statements.every(
          (s) =>
            /^(begin|select|commit)/i.test(s) &&
            !/for (update|share|no key)/i.test(s),
        ),
      ).toBe(true);
      expect(
        reader.statements.filter((s) => s.includes('from "shift_assignments"')),
      ).toHaveLength(source === "DEFAULT" ? 0 : 1);
      expect(
        reader.statements.filter((s) =>
          s.includes('from "schedule_version_assignments"'),
        ),
      ).toHaveLength(source === "DEFAULT" ? 1 : 0);
      expect(
        reader.statements.filter((s) => s.includes('from "schedules"')),
      ).toHaveLength(1); // No neighbours.
    }
    expect(await snapshotTables()).toEqual(before);
  });

  it("keeps query counts constant with a 60-person roster for official and revision sources", async () => {
    await approveFixture();
    await openDraft();
    await pinTestRuleSet(db, scheduleId, await override());
    const reader = recordedReader();
    const measure = async (source: StaffingReportSource) => {
      reader.statements.length = 0;
      await report(source, { ...head, db: reader.db });
      return reader.statements.length;
    };
    const before = [await measure("DEFAULT"), await measure("REVISION_DRAFT")];
    const roster = await listExportRoster(db, scheduleId);
    for (let i = roster.length; i < 60; i++) {
      const user = await createUser(db, {
        email: `staffing-${i}@test.invalid`,
        displayName: `Nurse ${i}`,
      });
      await addToRoster(db, {
        scheduleId,
        userId: user.id,
        role: "NURSE",
        addedBy: U.icuHead.id,
      });
    }
    expect([await measure("DEFAULT"), await measure("REVISION_DRAFT")]).toEqual(
      before,
    );
    expect(Math.max(...before)).toBeLessThanOrEqual(14);
  });

  it("does not mix decisions or schedule revision when an edit commits between reads", async () => {
    const reader = recordedReader(true);
    const old = await schedule();
    const pending = report("DEFAULT", { ...head, db: reader.db });
    try {
      await reader.waitUntilPaused();
      const change = await setAssignments(head, {
        scheduleId,
        expectedRevision: old.revision,
        changes: [{ nurseId: U.icuNurse1.id, date: period.start, shift: "E" }],
      });
      expect(change.ok).toBe(true);
    } finally {
      reader.release();
    }
    const result = await pending;
    expect(result.schedule.revision).toBe(old.revision);
    expect(result.rows[0]!.covered).toBe(1);
    expect((await report()).rows[0]!.covered).toBe(0);
  });

  it("does not mix the pin and its requirements during a concurrent pin change", async () => {
    const next = await override();
    const reader = recordedReader(true);
    const pending = report("DEFAULT", { ...head, db: reader.db });
    try {
      await reader.waitUntilPaused();
      await pinTestRuleSet(db, scheduleId, next);
    } finally {
      reader.release();
    }
    const result = await pending;
    expect(result.ruleSet.versionId).toBe(LEGACY_BASELINE_VERSION_ID);
    expect(result.rows[0]!.min).toBe(1);
    expect((await report()).rows[0]!.min).toBe(3);
  });

  it("keeps the old official pointer, decisions and approved pin during concurrent approval", async () => {
    const v1 = await approveFixture();
    await openDraft();
    await assign(U.icuNurse1.id, "E");
    const nextPin = await override();
    await pinTestRuleSet(db, scheduleId, nextPin);
    const reader = recordedReader(true);
    const pending = report("DEFAULT", { ...head, db: reader.db });
    try {
      await reader.waitUntilPaused();
      await approveFixture();
    } finally {
      reader.release();
    }
    const old = await pending;
    expect(old.provenance.approvedVersion!.id).toBe(v1.id);
    expect(old.ruleSet.versionId).toBe(LEGACY_BASELINE_VERSION_ID);
    expect(old.rows[0]).toMatchObject({ covered: 1, min: 1 });
    const current = await report();
    expect(current.provenance.approvedVersion!.versionNo).toBe(2);
    expect(current.ruleSet.versionId).toBe(nextPin);
    expect(current.rows[0]).toMatchObject({ covered: 0, min: 3 });
  });

  it("retains an eligible draft snapshot while concurrent approval closes it, then refuses a fresh draft", async () => {
    await approveFixture();
    const revisionId = await openDraft();
    await assign(U.icuNurse1.id, "E");
    const nextPin = await override();
    await pinTestRuleSet(db, scheduleId, nextPin);
    const reader = recordedReader(true);
    const pending = report("REVISION_DRAFT", { ...head, db: reader.db });
    try {
      await reader.waitUntilPaused();
      await approveFixture();
    } finally {
      reader.release();
    }
    const old = await pending;
    expect(old.provenance).toMatchObject({
      source: "REVISION_DRAFT",
      revisionId,
      approvedVersion: { versionNo: 1 },
    });
    expect(old.ruleSet.versionId).toBe(nextPin);
    expect(old.rows[0]).toMatchObject({ covered: 0, min: 3 });
    await expect(report("REVISION_DRAFT")).rejects.toMatchObject({
      reason: "STAFFING_REVISION_DRAFT_UNAVAILABLE",
    });
  });
});
