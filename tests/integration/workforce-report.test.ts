import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConflictError, NotFoundError } from "../../src/application/errors";
import type { ActionResult } from "../../src/application/result";
import { setAssignments } from "../../src/application/schedules/edit-assignments";
import {
  approveSchedule,
  finalizeSchedule,
  returnSchedule,
  submitSchedule,
  withdrawSubmission,
} from "../../src/application/schedules/lifecycle";
import { discardRevision } from "../../src/application/schedules/schedule-changes";
import { startScheduleRevision } from "../../src/application/schedules/start-revision";
import type { AppContext } from "../../src/application/use-case";
import {
  getWorkforceReport,
  type WorkforceReportInput,
  type WorkforceReportSource,
} from "../../src/application/workforce-report/queries";
import { sortByPersonnelOrder } from "../../src/domain/identity/personnel-order";
import { addDays, isoDate } from "../../src/domain/shared/dates";
import { ValidationError } from "../../src/domain/shared/errors";
import { unwrap } from "../../src/domain/shared/result";
import type { AssignmentCode } from "../../src/domain/shifts/shift-type";
import { summarizeWorkforce } from "../../src/domain/workforce-report/summary";
import { createDatabase } from "../../src/infrastructure/db/database";
import {
  schedules,
  scheduleVersionAssignments,
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
import * as revisionRepository from "../../src/infrastructure/repositories/revisions";
import {
  addToRoster,
  snapshotRosterFromMemberships,
} from "../../src/infrastructure/repositories/roster";
import {
  createSchedule,
  findScheduleById,
} from "../../src/infrastructure/repositories/schedules";
import { createSubmission } from "../../src/infrastructure/repositories/submissions";
import { createUser } from "../../src/infrastructure/repositories/users";
import * as versionRepository from "../../src/infrastructure/repositories/versions";
import { completeScheduleFixture } from "../support/complete-schedule";
import { setupTestDatabase } from "./support/database";

const { db, pool, url } = setupTestDatabase();
const today = isoDate("2027-05-01");
const now = new Date("2027-05-01T06:30:00Z");
const period = { start: isoDate("2027-05-10"), end: isoDate("2027-05-12") };
let scheduleId: string;
let secretaryId: string;
let head: AppContext;
let supervisor: AppContext;

const context = async (userId: string): Promise<AppContext> => ({
  db,
  actor: (await loadActor(db, userId, today))!,
  clock: () => now,
});
const input = (
  source: WorkforceReportSource = "DEFAULT",
): WorkforceReportInput => ({ departmentId: DEMO_ICU.id, scheduleId, source });
const report = (source: WorkforceReportSource = "DEFAULT", ctx = head) =>
  getWorkforceReport(ctx, input(source));
function success<T>(result: ActionResult<T>): T {
  if (!result.ok)
    throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.data;
}
const expectedRevision = async () =>
  (await findScheduleById(db, scheduleId))!.revision;
const step = async (command: typeof finalizeSchedule, ctx = head) =>
  success(
    await command(ctx, {
      scheduleId,
      expectedRevision: await expectedRevision(),
    }),
  );
const assign = (
  userId: string,
  shift: AssignmentCode,
  date = period.start,
  id = scheduleId,
) =>
  setAssignment(db, {
    scheduleId: id,
    userId,
    date,
    shift,
    updatedBy: U.icuHead.id,
  });
const person = async (source: WorkforceReportSource = "DEFAULT") =>
  (await report(source)).rows.find((r) => r.userId === U.icuNurse1.id)!;

beforeEach(async () => {
  head = await context(U.icuHead.id);
  supervisor = await context(U.supervisor.id);
  const secretary = await createUser(db, {
    email: "workforce-secretary@test.invalid",
    personnelNumber: "007700",
    displayName: "منشی گزارش",
  });
  secretaryId = secretary.id;
  // A known joiner on the last day still receives the whole roster denominator.
  await addMembership(db, {
    userId: secretaryId,
    departmentId: DEMO_ICU.id,
    role: "SECRETARY",
    startedOn: period.end,
  });
  const schedule = await createSchedule(db, {
    departmentId: DEMO_ICU.id,
    period,
    label: "actual partial period",
    createdBy: U.icuHead.id,
  });
  scheduleId = schedule.id;
  await snapshotRosterFromMemberships(db, {
    scheduleId,
    addedBy: U.icuHead.id,
  });
  await assign(U.icuNurse1.id, "M");
  await assign(U.icuNurse2.id, "OFF");
  await assign(U.icuNurse3.id, "H");
});

async function approveFirstVersion() {
  await completeScheduleFixture(db, scheduleId, [
    U.icuHead.id,
    U.icuNurse4.id,
    U.transferNurse.id,
  ]);
  await step(finalizeSchedule);
  await step(submitSchedule);
  await step(approveSchedule, supervisor);
  return (await report()).provenance.approvedVersion!;
}
async function openAndEditRevision() {
  const revision = success(
    await startScheduleRevision(head, {
      scheduleId,
      expectedRevision: await expectedRevision(),
      reason: "Workforce test revision",
      dates: [period.start],
    }),
  );
  success(
    await setAssignments(head, {
      scheduleId,
      expectedRevision: await expectedRevision(),
      changes: [{ nurseId: U.icuNurse1.id, date: period.start, shift: "E" }],
    }),
  );
  return revision.revisionId;
}

describe("workforce report source selection", () => {
  it.each(["DRAFT", "PLANNING", "FINALIZED", "SUBMITTED", "RETURNED"] as const)(
    "DEFAULT is provisional working data before first approval in %s",
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
      expect(result.provenance).toEqual({
        source: "WORKING_COPY",
        isProvisional: true,
        approvedVersion: null,
        revisionId: null,
      });
      expect(result.requestedSource).toBe("DEFAULT");
      expect(result.period).toEqual(period);
      expect(result.reportingDayCount).toBe(3);
      expect(
        result.rows.find((r) => r.userId === U.icuNurse1.id),
      ).toMatchObject({
        scheduledMinutes: 420,
        counts: { M: 1, UNDECIDED: 2 },
      });
    },
  );

  it("rejects an explicit draft before approval instead of falling back", async () => {
    await expect(report("REVISION_DRAFT")).rejects.toMatchObject({
      code: "CONFLICT",
      reason: "WORKFORCE_REVISION_DRAFT_UNAVAILABLE",
    });
    // Even a stray open revision row is insufficient without an approved version.
    await revisionRepository.startRevision(db, {
      scheduleId,
      reason: "invalid fixture context",
      startedBy: U.icuHead.id,
      dates: [],
    });
    await expect(report("REVISION_DRAFT")).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it("returns the referenced approved version and its approval provenance", async () => {
    const version = await approveFirstVersion();
    expect(version.versionNo).toBe(1);
    expect(version.approvedAt).toBeInstanceOf(Date);
    expect(Number.isFinite(version.approvedAt.getTime())).toBe(true);
    expect((await report()).provenance).toEqual({
      source: "APPROVED_VERSION",
      isProvisional: false,
      approvedVersion: version,
      revisionId: null,
    });
    await expect(report("REVISION_DRAFT")).rejects.toMatchObject({
      reason: "WORKFORCE_REVISION_DRAFT_UNAVAILABLE",
    });
  });

  it("isolates official and revision data through open, submitted, returned, withdrawn, discarded and reapproved revisions", async () => {
    const v1 = await approveFirstVersion();
    const revisionId = await openAndEditRevision();
    const check = async (status: string) => {
      const official = await report();
      const draft = await report("REVISION_DRAFT");
      expect(official.schedule.status).toBe(status);
      expect(official.provenance).toMatchObject({
        source: "APPROVED_VERSION",
        approvedVersion: v1,
        revisionId: null,
      });
      expect(draft.provenance).toEqual({
        source: "REVISION_DRAFT",
        isProvisional: true,
        approvedVersion: v1,
        revisionId,
      });
      expect((await person()).days[0]!.decision).toBe("M");
      expect((await person("REVISION_DRAFT")).days[0]!.decision).toBe("E");
    };
    await check("REVISING");
    await step(submitSchedule);
    await check("SUBMITTED");
    success(
      await returnSchedule(supervisor, {
        scheduleId,
        expectedRevision: await expectedRevision(),
        comment: "Review again",
      }),
    );
    await check("RETURNED");
    await step(submitSchedule);
    await step(withdrawSubmission);
    await check("REVISING");
    success(
      await discardRevision(head, {
        scheduleId,
        expectedRevision: await expectedRevision(),
      }),
    );
    expect((await report()).provenance.approvedVersion).toEqual(v1);
    expect((await person()).days[0]!.decision).toBe("M");
    await expect(report("REVISION_DRAFT")).rejects.toMatchObject({
      reason: "WORKFORCE_REVISION_DRAFT_UNAVAILABLE",
    });
    const nextRevision = await openAndEditRevision();
    expect(nextRevision).not.toBe(revisionId);
    await step(submitSchedule);
    await step(approveSchedule, supervisor);
    const latest = await report();
    expect(latest.provenance.approvedVersion).toMatchObject({ versionNo: 2 });
    expect(latest.provenance.approvedVersion!.id).not.toBe(v1.id);
    expect((await person()).days[0]!.decision).toBe("E");
    const v1Assignments = await versionRepository.listVersionAssignments(
      db,
      v1.id,
    );
    expect(
      v1Assignments.find(
        (a) => a.nurseId === U.icuNurse1.id && a.date === period.start,
      )!.shift,
    ).toBe("M");
    await expect(report("REVISION_DRAFT")).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it("permits a valid empty initial revision scope (D109)", async () => {
    await approveFirstVersion();
    const revision = success(
      await startScheduleRevision(head, {
        scheduleId,
        expectedRevision: await expectedRevision(),
        reason: "Review rules",
        dates: [],
      }),
    );
    expect((await report("REVISION_DRAFT")).provenance.revisionId).toBe(
      revision.revisionId,
    );
  });

  it("uses the approved pointer even if status and revision context differ", async () => {
    const version = await approveFirstVersion();
    await assign(U.icuNurse1.id, "E"); // Synthetic inconsistent working copy; never an official fallback.
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
      expect((await report()).provenance.approvedVersion).toEqual(version);
      expect((await person()).days[0]!.decision).toBe("M");
    }
  });

  it("keeps a legacy approved gap undecided despite a working assignment", async () => {
    const version = await approveFirstVersion();
    // Test-only legacy-gap fixture. Runtime approved repositories remain append-only.
    await db
      .delete(scheduleVersionAssignments)
      .where(eq(scheduleVersionAssignments.versionId, version.id));
    const result = await report();
    expect(
      result.rows.every(
        (r) => r.counts.UNDECIDED === 3 && r.workingShiftCount === 0,
      ),
    ).toBe(true);
    expect(result.isComplete).toBe(false);
  });
});

describe("workforce report validation and authorization", () => {
  it.each(["DEFAULT", "REVISION_DRAFT"] as const)(
    "fails closed on a foreign approved version for %s",
    async (source) => {
      const foreign = await createSchedule(db, {
        departmentId: DEMO_ER.id,
        period,
        label: "foreign",
        createdBy: U.erHead.id,
      });
      const submission = await createSubmission(db, {
        scheduleId: foreign.id,
        submittedBy: U.erHead.id,
      });
      const version = await versionRepository.createVersionFromWorkingCopy(db, {
        scheduleId: foreign.id,
        submissionId: submission.id,
        approvedBy: U.supervisor.id,
      });
      await db
        .update(schedules)
        .set({ currentVersionId: version.id })
        .where(eq(schedules.id, scheduleId));
      await expect(report(source)).rejects.toMatchObject({
        code: "CONFLICT",
        reason: "WORKFORCE_APPROVED_VERSION_INCONSISTENT",
      });
    },
  );

  it.each([
    "missing",
    "wrong identity",
    "invalid number",
    "invalid timestamp",
    "missing timestamp",
  ])("fails closed on %s version metadata", async (kind) => {
    const approved = await approveFirstVersion();
    const version = (await versionRepository.findVersionById(db, approved.id))!;
    // FK/NOT NULL constraints prevent these fixtures in a healthy DB. Simulate a
    // failed repository contract without changing constraints or production data.
    vi.spyOn(versionRepository, "findVersionById").mockResolvedValue(
      kind === "missing"
        ? null
        : {
            ...version,
            ...(kind === "wrong identity" ? { id: randomUUID() } : {}),
            ...(kind === "invalid number" ? { versionNo: 0 } : {}),
            ...(kind === "invalid timestamp"
              ? { approvedAt: new Date("invalid") }
              : {}),
            ...(kind === "missing timestamp"
              ? { approvedAt: null as unknown as Date }
              : {}),
          },
    );
    await expect(report()).rejects.toMatchObject({
      reason: "WORKFORCE_APPROVED_VERSION_INCONSISTENT",
    });
    await expect(report("REVISION_DRAFT")).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it.each(["foreign schedule", "closed", "outside period"])(
    "rejects %s revision metadata",
    async (kind) => {
      await approveFirstVersion();
      await openAndEditRevision();
      const revision = (await revisionRepository.findOpenRevision(
        db,
        scheduleId,
      ))!;
      vi.spyOn(revisionRepository, "findOpenRevision").mockResolvedValue({
        ...revision,
        ...(kind === "foreign schedule" ? { scheduleId: randomUUID() } : {}),
        ...(kind === "closed" ? { status: "DISCARDED" as const } : {}),
        ...(kind === "outside period"
          ? { dates: [addDays(period.end, 1)] }
          : {}),
      });
      await expect(report("REVISION_DRAFT")).rejects.toMatchObject({
        reason: "WORKFORCE_REVISION_DRAFT_UNAVAILABLE",
      });
      expect((await person()).days[0]!.decision).toBe("M");
    },
  );

  it("makes missing, foreign, malformed and denied identities indistinguishable", async () => {
    const foreign = await createSchedule(db, {
      departmentId: DEMO_ER.id,
      period,
      label: "foreign",
      createdBy: U.erHead.id,
    });
    const cases: unknown[] = [
      { ...input(), scheduleId: randomUUID() },
      { ...input(), scheduleId: foreign.id },
      { ...input(), scheduleId: "not-a-uuid" },
      { ...input(), scheduleId: "" },
      { ...input(), departmentId: "invalid" },
      { ...input(), departmentId: DEMO_ER.id },
      { ...input(), departmentId: randomUUID() },
      null,
      {},
      { ...input(), scheduleId: 1 },
    ];
    for (const value of cases) {
      await expect(
        getWorkforceReport(head, value as WorkforceReportInput),
      ).rejects.toEqual(new NotFoundError("Schedule"));
    }
  });

  it("validates explicit source only after authorizing the schedule", async () => {
    for (const source of ["unknown", undefined, null, 1]) {
      const value = { ...input(), source } as unknown as WorkforceReportInput;
      await expect(getWorkforceReport(head, value)).rejects.toBeInstanceOf(
        ValidationError,
      );
      await expect(
        getWorkforceReport(await context(U.icuNurse1.id), value),
      ).rejects.toEqual(new NotFoundError("Schedule"));
      await expect(
        getWorkforceReport(head, { ...value, scheduleId: randomUUID() }),
      ).rejects.toEqual(new NotFoundError("Schedule"));
    }
  });

  it("denies Nurse, Secretary, Supervisor, Admin-only and another department's Head Nurse", async () => {
    const admin = await createUser(db, {
      email: "report-admin@test.invalid",
      displayName: "Admin",
    });
    await db
      .update(users)
      .set({ isHospitalAdmin: true })
      .where(eq(users.id, admin.id));
    for (const id of [
      U.icuNurse1.id,
      secretaryId,
      U.supervisor.id,
      admin.id,
      U.erHead.id,
    ]) {
      const actorDate = id === secretaryId ? period.end : today;
      const ctx = { ...head, actor: (await loadActor(db, id, actorDate))! };
      for (const source of ["DEFAULT", "REVISION_DRAFT"] as const)
        await expect(report(source, ctx)).rejects.toEqual(
          new NotFoundError("Schedule"),
        );
    }
  });

  it("denies a former or deactivated Head Nurse, but allows combined roles through current Head Nurse membership", async () => {
    await db
      .update(users)
      .set({ isHospitalAdmin: true })
      .where(eq(users.id, U.icuHead.id));
    expect(
      (await report("DEFAULT", await context(U.icuHead.id))).rows.length,
    ).toBe(7);
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
});

describe("workforce report roster, history and calculation contract", () => {
  it("includes complete roster identities, inactive and zero-decision members, and matches Stage 1 exactly", async () => {
    await db
      .update(users)
      .set({ isActive: false })
      .where(eq(users.id, U.icuNurse3.id));
    await db
      .update(users)
      .set({ isActive: false })
      .where(eq(users.id, U.icuNurse4.id));
    const result = await report();
    const roster = await listExportRoster(db, scheduleId);
    const calculated = unwrap(
      summarizeWorkforce({
        period,
        roster,
        assignments: await listAssignments(db, scheduleId),
      }),
    );
    // Same figures as Stage 1; only the row order differs (personnel number).
    const byId = <T extends { userId: string }>(rows: readonly T[]) =>
      rows.toSorted((a, b) => a.userId.localeCompare(b.userId));
    expect(byId(result.rows)).toMatchObject(byId(calculated.rows));
    expect(result.rows.map((r) => r.userId)).toEqual(
      sortByPersonnelOrder(result.rows, (r) => ({ ...r, id: r.userId })).map(
        (r) => r.userId,
      ),
    );
    expect(result.rows).toHaveLength(7);
    expect(result.rows.find((r) => r.userId === U.icuHead.id)).toMatchObject({
      role: "HEAD_NURSE",
      counts: { UNDECIDED: 3 },
    });
    expect(result.rows.find((r) => r.userId === secretaryId)).toMatchObject({
      role: "SECRETARY",
      personnelNumber: "007700",
      counts: { UNDECIDED: 3 },
    });
    expect(result.rows.find((r) => r.userId === U.icuNurse3.id)).toMatchObject({
      isActive: false,
      counts: { H: 1, OFF: 0, UNDECIDED: 2 },
    });
    expect(result.rows.find((r) => r.userId === U.icuNurse4.id)).toMatchObject({
      isActive: false,
      counts: { UNDECIDED: 3 },
    });
    expect(result.rows.find((r) => r.userId === U.icuNurse2.id)).toMatchObject({
      counts: { OFF: 1, H: 0, UNDECIDED: 2 },
    });
    for (const row of result.rows)
      expect(Object.values(row.counts).reduce((n, count) => n + count, 0)).toBe(
        3,
      );
  });

  it("retains transfers and late joiner decisions without adding new current personnel", async () => {
    await endMembership(db, {
      userId: U.icuNurse1.id,
      departmentId: DEMO_ICU.id,
      endedOn: addDays(period.start, -1),
    });
    await addMembership(db, {
      userId: U.icuNurse1.id,
      departmentId: DEMO_ER.id,
      role: "NURSE",
      startedOn: period.start,
    });
    await assign(secretaryId, "ME"); // Stored decision before membership start is retained (D126).
    await endMembership(db, {
      userId: secretaryId,
      departmentId: DEMO_ICU.id,
      endedOn: period.end,
    });
    await addMembership(db, {
      userId: secretaryId,
      departmentId: DEMO_ICU.id,
      role: "NURSE",
      startedOn: addDays(period.end, 1),
    });
    const newcomer = await createUser(db, {
      email: "new-current@test.invalid",
      displayName: "New current member",
    });
    await addMembership(db, {
      userId: newcomer.id,
      departmentId: DEMO_ICU.id,
      role: "NURSE",
      startedOn: today,
    });
    const result = await report();
    expect(result.rows.some((r) => r.userId === newcomer.id)).toBe(false);
    expect(result.rows.find((r) => r.userId === U.icuNurse1.id)).toMatchObject({
      reportingDayCount: 3,
      scheduledMinutes: 420,
    });
    expect(result.rows.find((r) => r.userId === secretaryId)).toMatchObject({
      role: "SECRETARY",
      reportingDayCount: 3,
      scheduledMinutes: 720,
      counts: { ME: 1, UNDECIDED: 2 },
    });
  });

  it("reports only the selected partial schedule, never another schedule in the same month", async () => {
    const other = await createSchedule(db, {
      departmentId: DEMO_ICU.id,
      period: { start: addDays(period.end, 1), end: addDays(period.end, 2) },
      label: "another partial",
      createdBy: U.icuHead.id,
    });
    await snapshotRosterFromMemberships(db, {
      scheduleId: other.id,
      addedBy: U.icuHead.id,
    });
    await assign(U.icuNurse1.id, "N", other.period.start, other.id);
    const result = await report();
    expect(result.period).toEqual(period);
    expect(result.rows.every((r) => r.days.length === 3)).toBe(true);
    expect((await person()).counts.N).toBe(0);
  });

  it("fails rather than silently dropping an out-of-period stored decision", async () => {
    await assign(U.icuNurse1.id, "N", addDays(period.end, 1));
    await expect(report()).rejects.toBeInstanceOf(ValidationError);
  });
});

// Real pg connections with a bounded post-read barrier; no sleeps or production hooks.
const readers: ReturnType<typeof createDatabase>[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    readers.splice(0).map(({ pool: readerPool }) => readerPool.end()),
  );
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
      let timeout!: ReturnType<typeof setTimeout>;
      try {
        await Promise.race([
          paused,
          new Promise<never>((_, reject) => {
            timeout = setTimeout(
              () => reject(new Error("Report snapshot barrier not reached")),
              5000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timeout);
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

describe("workforce report snapshot consistency and read-only behavior", () => {
  it("uses repeatable-read/read-only and never queries the other assignment source or writes any public table", async () => {
    await approveFirstVersion();
    await openAndEditRevision();
    const before = await snapshotTables();
    const reader = recordedReader();
    for (const source of ["DEFAULT", "REVISION_DRAFT"] as const) {
      reader.statements.length = 0;
      await report(source, { ...head, db: reader.db });
      expect(reader.statements[0]).toMatch(
        /begin isolation level repeatable read read only/i,
      );
      expect(
        reader.statements.every((s) => /^(begin|select|commit)/i.test(s)),
      ).toBe(true);
      const working = reader.statements.filter((s) =>
        s.includes('from "shift_assignments"'),
      );
      const approved = reader.statements.filter((s) =>
        s.includes('from "schedule_version_assignments"'),
      );
      expect([working.length, approved.length]).toEqual(
        source === "DEFAULT" ? [0, 1] : [1, 0],
      );
    }
    expect(await snapshotTables()).toEqual(before);
  });

  it("has a bounded constant query count for small and 60-person rosters", async () => {
    const reader = recordedReader();
    const measure = async () => {
      reader.statements.length = 0;
      const result = await report("DEFAULT", { ...head, db: reader.db });
      return { count: reader.statements.length, size: result.rows.length };
    };
    const small = await measure();
    for (let i = 7; i < 60; i++) {
      const user = await createUser(db, {
        email: `workforce-${i}@test.invalid`,
        displayName: `Roster ${i}`,
      });
      await addToRoster(db, {
        scheduleId,
        userId: user.id,
        role: "NURSE",
        addedBy: U.icuHead.id,
      });
    }
    const large = await measure();
    expect([small.size, large.size]).toEqual([7, 60]);
    expect(large.count).toBe(small.count);
    expect(large.count).toBeLessThanOrEqual(8);
  });

  it("does not mix schedule metadata and assignments when an edit commits between reads", async () => {
    const reader = recordedReader(true);
    const oldRevision = await expectedRevision();
    const pending = report("DEFAULT", { ...head, db: reader.db });
    try {
      await reader.waitUntilPaused();
      success(
        await setAssignments(head, {
          scheduleId,
          expectedRevision: oldRevision,
          changes: [
            { nurseId: U.icuNurse1.id, date: period.start, shift: "N" },
          ],
        }),
      );
    } finally {
      reader.release();
    }
    const snapshot = await pending;
    expect(snapshot.schedule.revision).toBe(oldRevision);
    expect(
      snapshot.rows.find((r) => r.userId === U.icuNurse1.id)!.scheduledMinutes,
    ).toBe(420);
    expect((await person()).scheduledMinutes).toBe(720);
    expect((await report()).schedule.revision).toBe(oldRevision + 1);
  });

  it("keeps the old official pointer, metadata and decisions while concurrent approval publishes v2", async () => {
    const v1 = await approveFirstVersion();
    await openAndEditRevision();
    await step(submitSchedule);
    const reader = recordedReader(true);
    const pending = report("DEFAULT", { ...head, db: reader.db });
    try {
      await reader.waitUntilPaused();
      await step(approveSchedule, supervisor);
    } finally {
      reader.release();
    }
    const snapshot = await pending;
    expect(snapshot.schedule.status).toBe("SUBMITTED");
    expect(snapshot.provenance.approvedVersion).toEqual(v1);
    expect(
      snapshot.rows.find((r) => r.userId === U.icuNurse1.id)!.days[0]!.decision,
    ).toBe("M");
    const latest = await report();
    expect(latest.provenance.approvedVersion!.versionNo).toBe(2);
    expect(
      latest.rows.find((r) => r.userId === U.icuNurse1.id)!.days[0]!.decision,
    ).toBe("E");
  });
});
