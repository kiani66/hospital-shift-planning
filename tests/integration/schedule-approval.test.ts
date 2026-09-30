import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NotFoundError } from "../../src/application/errors";
import { markNotificationRead } from "../../src/application/notifications/commands";
import { createSchedule } from "../../src/application/schedules/create-schedule";
import { setAssignments } from "../../src/application/schedules/edit-assignments";
import {
  approveSchedule,
  assignmentsFingerprint,
  finalizeSchedule,
  returnSchedule,
  submitSchedule,
  withdrawSubmission,
  type LifecycleOutput,
} from "../../src/application/schedules/lifecycle";
import {
  closePreferenceWindow,
  openPreferenceWindow,
} from "../../src/application/schedules/preference-windows";
import { getScheduleReview } from "../../src/application/schedules/review";
import {
  getReviewQueue,
  getSupervisorScheduleReview,
} from "../../src/application/schedules/supervisor-review";
import type { ActionResult } from "../../src/application/result";
import type { AppContext } from "../../src/application/use-case";
import type { Actor } from "../../src/domain/authz/actor";
import { isoDate } from "../../src/domain/shared/dates";
import type { ShiftCode } from "../../src/domain/shifts/shift-type";
import {
  DEMO_ER,
  DEMO_ICU,
  DEMO_SCHEDULE,
  DEMO_USERS,
} from "../../src/infrastructure/db/seed/demo-data";
import {
  listAssignments,
  setAssignment,
} from "../../src/infrastructure/repositories/assignments";
import { listAuditEventsForSchedule } from "../../src/infrastructure/repositories/audit";
import {
  addMembership,
  assignSupervisor,
  endSupervisorAssignment,
  loadActor,
} from "../../src/infrastructure/repositories/memberships";
import { listNotificationsForRecipient } from "../../src/infrastructure/repositories/notifications";
import { listPreferenceWindows } from "../../src/infrastructure/repositories/preference-windows";
import { findScheduleById } from "../../src/infrastructure/repositories/schedules";
import { listSubmissions } from "../../src/infrastructure/repositories/submissions";
import { createUser } from "../../src/infrastructure/repositories/users";
import {
  listVersionAssignments,
  listVersions,
} from "../../src/infrastructure/repositories/versions";
import { setupTestDatabase } from "./support/database";

const { db, pool } = setupTestDatabase();
const U = DEMO_USERS;
const S = DEMO_SCHEDULE.id; // ICU, Aban 1405: 2026-10-23 .. 2026-11-21, DRAFT
const TODAY = isoDate("2026-10-01");
const NOW = new Date("2026-10-01T06:30:00Z");

type Who = "icuHead" | "erHead" | "icuNurse" | "supervisor";
const actors = {} as Record<Who, Actor>;
const as = (actor: Actor): AppContext => ({ db, actor, clock: () => NOW });

beforeEach(async () => {
  actors.icuHead = (await loadActor(db, U.icuHead.id, TODAY))!;
  actors.erHead = (await loadActor(db, U.erHead.id, TODAY))!;
  actors.icuNurse = (await loadActor(db, U.icuNurse1.id, TODAY))!;
  actors.supervisor = (await loadActor(db, U.supervisor.id, TODAY))!;
});

const schedule = async () => (await findScheduleById(db, S))!;
const revision = async () => (await schedule()).revision;

type Command = (
  ctx: AppContext,
  input: unknown,
) => Promise<ActionResult<LifecycleOutput>>;

/** Runs a lifecycle command at the schedule's current revision (or `expectedRevision`). */
async function run(
  command: Command,
  actor: Actor,
  extra: Record<string, unknown> = {},
) {
  return command(as(actor), {
    scheduleId: S,
    expectedRevision: await revision(),
    ...extra,
  });
}

function unwrapOk<T>(result: ActionResult<T>): T {
  if (!result.ok)
    throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.data;
}

const assign = (userId: string, date: string, shift: ShiftCode) =>
  setAssignment(db, {
    scheduleId: S,
    userId,
    date: isoDate(date),
    shift,
    updatedBy: U.icuHead.id,
  });

/** DRAFT → PLANNING through the real use cases, collection opened then closed. */
async function toPlanning({ keepWindowOpen = false } = {}) {
  unwrapOk(
    await openPreferenceWindow(as(actors.icuHead), {
      scheduleId: S,
      expectedRevision: await revision(),
    }),
  );
  if (!keepWindowOpen)
    unwrapOk(
      await closePreferenceWindow(as(actors.icuHead), {
        scheduleId: S,
        expectedRevision: await revision(),
      }),
    );
}

async function toFinalized(options: { keepWindowOpen?: boolean } = {}) {
  await toPlanning(options);
  unwrapOk(await run(finalizeSchedule, actors.icuHead));
}

async function toSubmitted(by: Actor = actors.icuHead) {
  await toFinalized();
  return unwrapOk(await run(submitSchedule, by));
}

const counts = async () => {
  const { rows } = await db.execute<{
    submissions: number;
    versions: number;
    audit: number;
    notifications: number;
  }>(sql`
    select (select count(*)::int from schedule_submissions) as submissions,
           (select count(*)::int from schedule_versions) as versions,
           (select count(*)::int from audit_events) as audit,
           (select count(*)::int from notifications) as notifications
  `);
  return rows[0]!;
};

const lastAudit = async () => (await listAuditEventsForSchedule(db, S)).at(-1);

/** A second, independent Supervisor of ICU (for self-approval tests). */
async function otherSupervisor(): Promise<Actor> {
  const user = await createUser(db, {
    email: "supervisor2@demo.invalid",
    displayName: "سوپروایزر دوم نمونه",
  });
  await assignSupervisor(db, {
    userId: user.id,
    departmentId: DEMO_ICU.id,
    startedOn: isoDate("2026-01-01"),
  });
  return (await loadActor(db, user.id, TODAY))!;
}

/** The demo Supervisor also becomes ICU Head Nurse: they can submit, but never decide their own submission. */
async function supervisorWhoIsHeadNurse(): Promise<Actor> {
  await addMembership(db, {
    userId: U.supervisor.id,
    departmentId: DEMO_ICU.id,
    role: "HEAD_NURSE",
    startedOn: isoDate("2026-01-01"),
  });
  return (await loadActor(db, U.supervisor.id, TODAY))!;
}

describe("finalizeSchedule", () => {
  it("moves PLANNING to FINALIZED, bumps the revision, audits and keeps the assignments", async () => {
    await toPlanning();
    await assign(U.icuNurse1.id, "2026-10-24", "M");
    await assign(U.icuNurse2.id, "2026-10-24", "N");
    const before = await schedule();
    const assignments = await listAssignments(db, S);

    const result = await run(finalizeSchedule, actors.icuHead);
    expect(result).toEqual({
      ok: true,
      data: { status: "FINALIZED", revision: before.revision + 1 },
    });
    expect(await schedule()).toMatchObject({
      status: "FINALIZED",
      revision: before.revision + 1,
    });
    expect(await listAssignments(db, S)).toEqual(assignments);
    expect(await lastAudit()).toMatchObject({
      actorId: U.icuHead.id,
      action: "schedule.finalized",
      entityType: "schedule",
      entityId: S,
      departmentId: DEMO_ICU.id,
      scheduleId: S,
      data: { from: "PLANNING", to: "FINALIZED", assignmentCount: 2 },
    });
  });

  it("sends no notification (D63)", async () => {
    await toPlanning();
    const before = (await counts()).notifications;
    unwrapOk(await run(finalizeSchedule, actors.icuHead));
    expect((await counts()).notifications).toBe(before);
  });

  it.each([
    [
      "another department's Head Nurse",
      "erHead",
      "NOT_HEAD_NURSE_OF_DEPARTMENT",
    ],
    ["a nurse of the department", "icuNurse", "NOT_HEAD_NURSE_OF_DEPARTMENT"],
    [
      "the department's Supervisor",
      "supervisor",
      "NOT_HEAD_NURSE_OF_DEPARTMENT",
    ],
  ] as const)(
    "forbids %s, even with a stale revision",
    async (_, who, reason) => {
      await toPlanning();
      const before = await counts();
      for (const expectedRevision of [await revision(), 99])
        expect(
          await run(finalizeSchedule, actors[who], { expectedRevision }),
        ).toMatchObject({ ok: false, error: { code: "FORBIDDEN", reason } });
      expect((await schedule()).status).toBe("PLANNING");
      expect(await counts()).toEqual(before);
    },
  );

  it("forbids a Head Nurse whose membership has ended (effective-dated, D19)", async () => {
    await toPlanning();
    const later = (await loadActor(db, U.icuHead.id, isoDate("2025-12-31")))!;
    expect(await run(finalizeSchedule, later)).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
  });

  it("is blocked by a blocking finding (night rest) and changes nothing", async () => {
    await toPlanning();
    await assign(U.icuNurse1.id, "2026-10-25", "N");
    await assign(U.icuNurse1.id, "2026-10-26", "M");
    const before = { schedule: await schedule(), counts: await counts() };

    const result = await run(finalizeSchedule, actors.icuHead);
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "RULE_VIOLATION",
        violations: [
          {
            rule: "NIGHT_REST",
            nurseId: U.icuNurse1.id,
            nightDate: "2026-10-25",
            date: "2026-10-26",
          },
        ],
      },
    });
    expect(await schedule()).toEqual(before.schedule);
    expect(await counts()).toEqual(before.counts);
  });

  it("uses the same validation as the review: a night-rest pair across the next schedule blocks it", async () => {
    await toPlanning();
    const azar = unwrapOk(
      await createSchedule(as(actors.icuHead), {
        departmentId: DEMO_ICU.id,
        periodStart: "2026-11-22",
        periodEnd: "2026-12-21",
        label: "آذر ۱۴۰۵",
      }),
    );
    await assign(U.icuNurse2.id, "2026-11-21", "N");
    await setAssignment(db, {
      scheduleId: azar.scheduleId,
      userId: U.icuNurse2.id,
      date: isoDate("2026-11-22"),
      shift: "M",
      updatedBy: U.icuHead.id,
    });
    const review = await getScheduleReview(as(actors.icuHead), {
      departmentId: DEMO_ICU.id,
      scheduleId: S,
    });
    expect(review.workflow.blockingFindings).toEqual({
      count: 1,
      dates: ["2026-11-21"],
    });
    expect(review.workflow.actions.finalize).toEqual({
      blockers: ["BLOCKING_FINDINGS"],
    });
    expect(await run(finalizeSchedule, actors.icuHead)).toMatchObject({
      ok: false,
      error: { code: "RULE_VIOLATION" },
    });
  });

  it("is refused from DRAFT (INVALID_STATE) and when already FINALIZED", async () => {
    expect(await run(finalizeSchedule, actors.icuHead)).toMatchObject({
      ok: false,
      error: { code: "INVALID_STATE", reason: "FINALIZE" },
    });
    await toFinalized();
    expect(await run(finalizeSchedule, actors.icuHead)).toMatchObject({
      ok: false,
      error: { code: "INVALID_STATE", reason: "FINALIZE" },
    });
  });

  it("returns CONFLICT for a stale revision and writes nothing", async () => {
    await toPlanning();
    const before = await counts();
    const stale = (await revision()) - 1;
    expect(
      await run(finalizeSchedule, actors.icuHead, { expectedRevision: stale }),
    ).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    expect((await schedule()).status).toBe("PLANNING");
    expect(await counts()).toEqual(before);
  });

  it("lets exactly one of two concurrent finalizes win; the other gets CONFLICT", async () => {
    await toPlanning();
    const expectedRevision = await revision();
    const results = await Promise.all([
      run(finalizeSchedule, actors.icuHead, { expectedRevision }),
      run(finalizeSchedule, actors.icuHead, { expectedRevision }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({
      error: { code: "CONFLICT" },
    });
    expect(await schedule()).toMatchObject({
      status: "FINALIZED",
      revision: expectedRevision + 1,
    });
    const finalized = (await listAuditEventsForSchedule(db, S)).filter(
      (e) => e.action === "schedule.finalized",
    );
    expect(finalized).toHaveLength(1);
  });

  it("is allowed while preferences are open and leaves the window open (D58)", async () => {
    await toPlanning({ keepWindowOpen: true });
    expect(unwrapOk(await run(finalizeSchedule, actors.icuHead)).status).toBe(
      "FINALIZED",
    );
    const [window] = await listPreferenceWindows(db, S);
    expect(window!.closedAt).toBeNull();
  });
});

describe("submitSchedule", () => {
  it("moves FINALIZED to SUBMITTED with a submission, an audit event and a Supervisor notification", async () => {
    await toFinalized();
    await assign(U.icuNurse1.id, "2026-10-24", "ME");
    const before = await schedule();

    const data = unwrapOk(await run(submitSchedule, actors.icuHead));
    expect(data).toEqual({
      status: "SUBMITTED",
      revision: before.revision + 1,
      submissionId: expect.any(String),
    });

    const [submission] = await listSubmissions(db, S);
    expect(submission).toMatchObject({
      id: data.submissionId,
      submittedBy: U.icuHead.id,
      submittedAt: NOW,
      decision: null,
      revisionId: null,
    });
    const assignments = await listAssignments(db, S);
    expect(await lastAudit()).toMatchObject({
      actorId: U.icuHead.id,
      action: "schedule.submitted",
      entityType: "submission",
      entityId: data.submissionId,
      departmentId: DEMO_ICU.id,
      data: {
        from: "FINALIZED",
        to: "SUBMITTED",
        submissionId: data.submissionId,
        assignmentCount: 1,
        assignmentsFingerprint: assignmentsFingerprint(assignments),
      },
    });
    const [notification] = await listNotificationsForRecipient(
      db,
      U.supervisor.id,
    );
    expect(notification).toMatchObject({
      type: "SCHEDULE_SUBMITTED",
      scheduleId: S,
      data: { label: DEMO_SCHEDULE.label, submissionId: data.submissionId },
    });
    // Only the department's Supervisors hear about it.
    expect(
      (await listNotificationsForRecipient(db, U.icuNurse1.id)).filter(
        (n) => n.type === "SCHEDULE_SUBMITTED",
      ),
    ).toEqual([]);
  });

  it("does not notify a Supervisor whose assignment has ended", async () => {
    await endSupervisorAssignment(db, {
      userId: U.supervisor.id,
      departmentId: DEMO_ICU.id,
      endedOn: isoDate("2026-09-30"),
    });
    const second = await otherSupervisor();
    await toSubmitted();
    expect(await listNotificationsForRecipient(db, U.supervisor.id)).toEqual(
      [],
    );
    expect(await listNotificationsForRecipient(db, second.userId)).toHaveLength(
      1,
    );
  });

  it.each(["PLANNING", "DRAFT"] as const)(
    "is refused from %s (INVALID_STATE)",
    async (status) => {
      if (status === "PLANNING") await toPlanning();
      expect(await run(submitSchedule, actors.icuHead)).toMatchObject({
        ok: false,
        error: { code: "INVALID_STATE", reason: "SUBMIT" },
      });
      expect(await listSubmissions(db, S)).toEqual([]);
    },
  );

  it("is blocked while a preference window is open, and never closes it", async () => {
    await toFinalized({ keepWindowOpen: true });
    const before = { schedule: await schedule(), counts: await counts() };
    expect(await run(submitSchedule, actors.icuHead)).toMatchObject({
      ok: false,
      error: { code: "INVALID_STATE", reason: "PREFERENCE_WINDOW_OPEN" },
    });
    expect(await schedule()).toEqual(before.schedule);
    expect(await counts()).toEqual(before.counts);
    const [window] = await listPreferenceWindows(db, S);
    expect(window!.closedAt).toBeNull();

    // The workflow shows why; closing it explicitly unblocks the submission.
    const review = await getScheduleReview(as(actors.icuHead), {
      departmentId: DEMO_ICU.id,
      scheduleId: S,
    });
    expect(review.workflow.actions.submit).toEqual({
      blockers: ["PREFERENCE_WINDOW_OPEN"],
    });
    unwrapOk(
      await closePreferenceWindow(as(actors.icuHead), {
        scheduleId: S,
        expectedRevision: await revision(),
      }),
    );
    expect(unwrapOk(await run(submitSchedule, actors.icuHead)).status).toBe(
      "SUBMITTED",
    );
  });

  it("is blocked by a finding introduced by an edit after finalizing", async () => {
    await toFinalized();
    unwrapOk(
      await setAssignments(as(actors.icuHead), {
        scheduleId: S,
        expectedRevision: await revision(),
        changes: [
          { nurseId: U.icuNurse3.id, date: "2026-11-01", shift: "N" },
          { nurseId: U.icuNurse3.id, date: "2026-11-02", shift: "E" },
        ],
      }),
    );
    expect(await run(submitSchedule, actors.icuHead)).toMatchObject({
      ok: false,
      error: {
        code: "RULE_VIOLATION",
        violations: [{ rule: "NIGHT_REST", date: "2026-11-02" }],
      },
    });
    expect((await schedule()).status).toBe("FINALIZED");
    expect(await listSubmissions(db, S)).toEqual([]);
  });

  it("reports both blockers in the workflow when both apply", async () => {
    await toFinalized({ keepWindowOpen: true });
    await assign(U.icuNurse1.id, "2026-10-25", "N");
    await assign(U.icuNurse1.id, "2026-10-26", "N");
    const { workflow } = await getScheduleReview(as(actors.icuHead), {
      departmentId: DEMO_ICU.id,
      scheduleId: S,
    });
    expect(workflow.actions.submit?.blockers).toEqual([
      "BLOCKING_FINDINGS",
      "PREFERENCE_WINDOW_OPEN",
    ]);
  });

  it.each(["erHead", "icuNurse", "supervisor"] as const)(
    "forbids %s",
    async (who) => {
      await toFinalized();
      expect(await run(submitSchedule, actors[who])).toMatchObject({
        ok: false,
        error: { code: "FORBIDDEN" },
      });
      expect((await schedule()).status).toBe("FINALIZED");
    },
  );

  it("locks the assignments once submitted (Phase 7b's rule)", async () => {
    await toSubmitted();
    expect(
      await setAssignments(as(actors.icuHead), {
        scheduleId: S,
        expectedRevision: await revision(),
        changes: [{ nurseId: U.icuNurse1.id, date: "2026-10-24", shift: "M" }],
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "INVALID_STATE", reason: "EDIT_ASSIGNMENT" },
    });
  });
});

describe("withdrawSubmission", () => {
  it("moves SUBMITTED back to FINALIZED and keeps the submission as WITHDRAWN", async () => {
    const { submissionId } = await toSubmitted();
    const data = unwrapOk(await run(withdrawSubmission, actors.icuHead));
    expect(data).toMatchObject({ status: "FINALIZED", submissionId });

    expect(await listSubmissions(db, S)).toEqual([
      expect.objectContaining({
        id: submissionId,
        decision: "WITHDRAWN",
        decidedBy: U.icuHead.id,
        decidedAt: NOW,
        decisionComment: null,
      }),
    ]);
    expect(await lastAudit()).toMatchObject({
      action: "schedule.withdrawn",
      entityType: "submission",
      entityId: submissionId,
      data: { from: "SUBMITTED", to: "FINALIZED", submissionId },
    });

    // The normal workflow continues: a new submission, the old one kept.
    const again = unwrapOk(await run(submitSchedule, actors.icuHead));
    expect(
      (await listSubmissions(db, S)).map((s) => [s.id, s.decision]),
    ).toEqual([
      [submissionId, "WITHDRAWN"],
      [again.submissionId, null],
    ]);
  });

  it.each(["PLANNING", "FINALIZED"] as const)(
    "is refused from %s",
    async (status) => {
      if (status === "PLANNING") await toPlanning();
      else await toFinalized();
      expect(await run(withdrawSubmission, actors.icuHead)).toMatchObject({
        ok: false,
        error: { code: "INVALID_STATE", reason: "WITHDRAW" },
      });
    },
  );

  it("is no longer possible once the Supervisor has approved or returned", async () => {
    await toSubmitted();
    unwrapOk(await run(approveSchedule, actors.supervisor));
    expect(await run(withdrawSubmission, actors.icuHead)).toMatchObject({
      ok: false,
      error: { code: "INVALID_STATE" },
    });
    expect((await schedule()).status).toBe("APPROVED");
  });

  it.each(["erHead", "icuNurse", "supervisor"] as const)(
    "forbids %s",
    async (who) => {
      await toSubmitted();
      expect(await run(withdrawSubmission, actors[who])).toMatchObject({
        ok: false,
        error: { code: "FORBIDDEN" },
      });
      expect((await schedule()).status).toBe("SUBMITTED");
    },
  );
});

describe("approveSchedule", () => {
  it("approves: records the decision, snapshots the submitted working copy as version 1, audits and notifies the Head Nurse", async () => {
    await toPlanning();
    await assign(U.icuNurse1.id, "2026-10-24", "M");
    await assign(U.icuNurse2.id, "2026-10-25", "ME");
    unwrapOk(await run(finalizeSchedule, actors.icuHead));
    const { submissionId } = unwrapOk(
      await run(submitSchedule, actors.icuHead),
    );
    const submitted = await lastAudit();

    const data = unwrapOk(await run(approveSchedule, actors.supervisor));
    expect(data).toMatchObject({
      status: "APPROVED",
      submissionId,
      versionId: expect.any(String),
    });

    const [version] = await listVersions(db, S);
    expect(version).toMatchObject({
      id: data.versionId,
      versionNo: 1,
      submissionId,
      approvedBy: U.supervisor.id,
    });
    expect(await listVersionAssignments(db, version!.id)).toEqual(
      await listAssignments(db, S),
    );
    expect(await schedule()).toMatchObject({
      status: "APPROVED",
      currentVersionId: version!.id,
    });
    expect((await listSubmissions(db, S))[0]).toMatchObject({
      decision: "APPROVED",
      decidedBy: U.supervisor.id,
      decidedAt: NOW,
    });

    const approved = await lastAudit();
    expect(approved).toMatchObject({
      actorId: U.supervisor.id,
      action: "schedule.approved",
      entityType: "submission",
      entityId: submissionId,
      departmentId: DEMO_ICU.id,
      data: {
        from: "SUBMITTED",
        to: "APPROVED",
        submissionId,
        submittedBy: U.icuHead.id,
        versionId: version!.id,
        versionNo: 1,
        assignmentCount: 2,
      },
    });
    // What was approved is exactly what was submitted.
    expect(approved!.data.assignmentsFingerprint).toBe(
      submitted!.data.assignmentsFingerprint,
    );

    const [notification] = await listNotificationsForRecipient(
      db,
      U.icuHead.id,
    );
    expect(notification).toMatchObject({
      type: "SCHEDULE_APPROVED",
      scheduleId: S,
      data: { label: DEMO_SCHEDULE.label, versionNo: 1 },
    });
    // Approval does not start a revision (Phase 11).
    expect((await schedule()).status).toBe("APPROVED");
  });

  it.each(["FINALIZED", "RETURNED"] as const)(
    "cannot approve a %s schedule",
    async (status) => {
      if (status === "FINALIZED") await toFinalized();
      else {
        await toSubmitted();
        unwrapOk(
          await run(returnSchedule, actors.supervisor, {
            comment: "اصلاح شود",
          }),
        );
      }
      expect(await run(approveSchedule, actors.supervisor)).toMatchObject({
        ok: false,
        error: { code: "INVALID_STATE", reason: "APPROVE" },
      });
      expect(await listVersions(db, S)).toEqual([]);
    },
  );

  it.each([
    ["the Head Nurse", "icuHead"],
    ["a nurse", "icuNurse"],
    ["another department's Head Nurse", "erHead"],
  ] as const)("forbids %s", async (_, who) => {
    await toSubmitted();
    for (const expectedRevision of [await revision(), 99])
      expect(
        await run(approveSchedule, actors[who], { expectedRevision }),
      ).toMatchObject({
        ok: false,
        error: { code: "FORBIDDEN", reason: "NOT_SUPERVISOR_OF_DEPARTMENT" },
      });
    expect((await schedule()).status).toBe("SUBMITTED");
  });

  it("forbids a Supervisor of another department only", async () => {
    await toSubmitted();
    const user = await createUser(db, {
      email: "er-supervisor@demo.invalid",
      displayName: "سوپروایزر اورژانس",
    });
    await assignSupervisor(db, {
      userId: user.id,
      departmentId: DEMO_ER.id,
      startedOn: isoDate("2026-01-01"),
    });
    const erSupervisor = (await loadActor(db, user.id, TODAY))!;
    expect(await run(approveSchedule, erSupervisor)).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN", reason: "NOT_SUPERVISOR_OF_DEPARTMENT" },
    });
  });

  it("forbids a Supervisor whose assignment has ended (D19)", async () => {
    await toSubmitted();
    await endSupervisorAssignment(db, {
      userId: U.supervisor.id,
      departmentId: DEMO_ICU.id,
      endedOn: isoDate("2026-09-30"),
    });
    const former = (await loadActor(db, U.supervisor.id, TODAY))!;
    expect(await run(approveSchedule, former)).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
  });

  describe("self-approval", () => {
    it("a Supervisor can never approve or return their own submission", async () => {
      const both = await supervisorWhoIsHeadNurse();
      await toSubmitted(both);
      const before = await counts();

      expect(await run(approveSchedule, both)).toMatchObject({
        ok: false,
        error: { code: "FORBIDDEN", reason: "SELF_APPROVAL" },
      });
      expect(
        await run(returnSchedule, both, { comment: "خودم برمی‌گردانم" }),
      ).toMatchObject({
        ok: false,
        error: { code: "FORBIDDEN", reason: "SELF_APPROVAL" },
      });
      expect(await counts()).toEqual(before);

      // The workflow does not offer it, and says why.
      const { workflow } = await getScheduleReview(as(both), {
        departmentId: DEMO_ICU.id,
        scheduleId: S,
      });
      expect(workflow.actions.approve).toBeNull();
      expect(workflow.actions.return).toBeNull();
      expect(workflow.ownSubmission).toBe(true);

      // Another Supervisor of the department can.
      const other = await otherSupervisor();
      expect(unwrapOk(await run(approveSchedule, other)).status).toBe(
        "APPROVED",
      );
    });

    it("uses the persisted submitter, not whoever holds the Head Nurse role now", async () => {
      // Submitted by the ICU Head Nurse; the Supervisor gains the Head Nurse
      // role afterwards and may still decide it.
      await toSubmitted(actors.icuHead);
      const both = await supervisorWhoIsHeadNurse();
      expect(unwrapOk(await run(approveSchedule, both)).status).toBe(
        "APPROVED",
      );
    });
  });

  it("rolls back the decision, version and audit when the notification fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await toSubmitted();
    const before = { schedule: await schedule(), counts: await counts() };
    await db.execute(
      sql`alter table notifications add constraint test_reject_all check (recipient_id is null) not valid`,
    );
    try {
      expect(await run(approveSchedule, actors.supervisor)).toMatchObject({
        ok: false,
        error: { code: "VALIDATION" },
      });
    } finally {
      await db.execute(
        sql`alter table notifications drop constraint test_reject_all`,
      );
    }
    expect(await schedule()).toEqual(before.schedule);
    expect(await counts()).toEqual(before.counts);
    expect((await listSubmissions(db, S))[0]!.decision).toBeNull();
    log.mockRestore();
  });
});

describe("returnSchedule", () => {
  it("returns with the comment: persisted, audited, notified and shown to the Head Nurse", async () => {
    const { submissionId } = await toSubmitted();
    const comment = "  پوشش شب ۱۲ آبان کافی نیست.\nلطفاً اصلاح کنید.  ";

    const data = unwrapOk(
      await run(returnSchedule, actors.supervisor, { comment }),
    );
    expect(data).toMatchObject({ status: "RETURNED", submissionId });

    const trimmed = comment.trim();
    expect((await listSubmissions(db, S))[0]).toMatchObject({
      decision: "RETURNED",
      decidedBy: U.supervisor.id,
      decisionComment: trimmed,
    });
    expect(await lastAudit()).toMatchObject({
      actorId: U.supervisor.id,
      action: "schedule.returned",
      entityType: "submission",
      entityId: submissionId,
      reason: trimmed,
      data: { from: "SUBMITTED", to: "RETURNED", submissionId },
    });
    expect(
      (await listNotificationsForRecipient(db, U.icuHead.id))[0],
    ).toMatchObject({ type: "SCHEDULE_RETURNED", scheduleId: S });
    expect(await listVersions(db, S)).toEqual([]);

    const { workflow } = await getScheduleReview(as(actors.icuHead), {
      departmentId: DEMO_ICU.id,
      scheduleId: S,
    });
    expect(workflow).toMatchObject({
      status: "RETURNED",
      pending: null,
      lastDecision: {
        decision: "RETURNED",
        comment: trimmed,
        decidedBy: {
          userId: U.supervisor.id,
          displayName: U.supervisor.displayName,
        },
      },
      actions: { submit: { blockers: [] }, finalize: null, withdraw: null },
    });
  });

  it("lets the Head Nurse fix and resubmit a returned schedule (RETURNED → SUBMITTED)", async () => {
    await toSubmitted();
    unwrapOk(
      await run(returnSchedule, actors.supervisor, { comment: "اصلاح کنید" }),
    );
    // First-cycle RETURNED: the whole period is editable (Phase 7b).
    unwrapOk(
      await setAssignments(as(actors.icuHead), {
        scheduleId: S,
        expectedRevision: await revision(),
        changes: [{ nurseId: U.icuNurse1.id, date: "2026-10-30", shift: "E" }],
      }),
    );
    const again = unwrapOk(await run(submitSchedule, actors.icuHead));
    expect(again.status).toBe("SUBMITTED");
    expect((await listSubmissions(db, S)).map((s) => s.decision)).toEqual([
      "RETURNED",
      null,
    ]);
    expect(unwrapOk(await run(approveSchedule, actors.supervisor)).status).toBe(
      "APPROVED",
    );
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["blank", "   "],
    ["whitespace and newlines", " \n\t "],
    ["too long", "x".repeat(1001)],
  ])("requires a comment (%s)", async (_, comment) => {
    await toSubmitted();
    const before = { schedule: await schedule(), counts: await counts() };
    const result = await run(
      returnSchedule,
      actors.supervisor,
      comment === undefined ? {} : { comment },
    );
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "VALIDATION",
        fieldErrors: { comment: expect.any(Array) },
      },
    });
    expect(await schedule()).toEqual(before.schedule);
    expect(await counts()).toEqual(before.counts);
  });

  it("accepts a comment of exactly 1000 characters", async () => {
    await toSubmitted();
    expect(
      unwrapOk(
        await run(returnSchedule, actors.supervisor, {
          comment: "ا".repeat(1000),
        }),
      ).status,
    ).toBe("RETURNED");
  });

  it.each(["icuHead", "icuNurse", "erHead"] as const)(
    "forbids %s",
    async (who) => {
      await toSubmitted();
      expect(
        await run(returnSchedule, actors[who], { comment: "اصلاح شود" }),
      ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
      expect((await schedule()).status).toBe("SUBMITTED");
    },
  );

  it("cannot return a FINALIZED schedule", async () => {
    await toFinalized();
    expect(
      await run(returnSchedule, actors.supervisor, { comment: "اصلاح شود" }),
    ).toMatchObject({
      ok: false,
      error: { code: "INVALID_STATE", reason: "RETURN" },
    });
  });
});

describe("concurrent transitions", () => {
  const race = async (
    ...attempts: Promise<ActionResult<LifecycleOutput>>[]
  ) => {
    const results = await Promise.all(attempts);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    for (const lost of results.filter((r) => !r.ok))
      expect(lost).toMatchObject({ error: { code: "CONFLICT" } });
    return results;
  };

  it("approve vs return: exactly one decision is recorded", async () => {
    await toSubmitted();
    const expectedRevision = await revision();
    await race(
      run(approveSchedule, actors.supervisor, { expectedRevision }),
      run(returnSchedule, actors.supervisor, {
        expectedRevision,
        comment: "اصلاح شود",
      }),
    );
    const [submission] = await listSubmissions(db, S);
    const { status } = await schedule();
    expect(status).toBe(submission!.decision);
    expect((await listVersions(db, S)).length).toBe(
      status === "APPROVED" ? 1 : 0,
    );
  });

  it("approve vs withdraw: exactly one wins", async () => {
    await toSubmitted();
    const expectedRevision = await revision();
    await race(
      run(approveSchedule, actors.supervisor, { expectedRevision }),
      run(withdrawSubmission, actors.icuHead, { expectedRevision }),
    );
    const [submission] = await listSubmissions(db, S);
    const { status } = await schedule();
    expect([
      ["APPROVED", "APPROVED"],
      ["FINALIZED", "WITHDRAWN"],
    ]).toContainEqual([status, submission!.decision]);
  });

  it("return vs withdraw: exactly one wins", async () => {
    await toSubmitted();
    const expectedRevision = await revision();
    await race(
      run(returnSchedule, actors.supervisor, {
        expectedRevision,
        comment: "اصلاح شود",
      }),
      run(withdrawSubmission, actors.icuHead, { expectedRevision }),
    );
    expect(
      (await listSubmissions(db, S)).filter((s) => s.decision),
    ).toHaveLength(1);
  });

  it("a duplicated approval creates one version and one audit event", async () => {
    await toSubmitted();
    const expectedRevision = await revision();
    await race(
      run(approveSchedule, actors.supervisor, { expectedRevision }),
      run(approveSchedule, actors.supervisor, { expectedRevision }),
      run(approveSchedule, actors.supervisor, { expectedRevision }),
    );
    expect(await listVersions(db, S)).toHaveLength(1);
    expect(
      (await listAuditEventsForSchedule(db, S)).filter(
        (e) => e.action === "schedule.approved",
      ),
    ).toHaveLength(1);
  });

  it("a duplicated submit creates one submission", async () => {
    await toFinalized();
    const expectedRevision = await revision();
    await race(
      run(submitSchedule, actors.icuHead, { expectedRevision }),
      run(submitSchedule, actors.icuHead, { expectedRevision }),
    );
    expect(await listSubmissions(db, S)).toHaveLength(1);
  });

  it("an approval against the revision the Supervisor reviewed fails after a withdraw and resubmit", async () => {
    await toSubmitted();
    const reviewed = await revision();
    unwrapOk(await run(withdrawSubmission, actors.icuHead));
    unwrapOk(await run(submitSchedule, actors.icuHead));
    expect(
      await run(approveSchedule, actors.supervisor, {
        expectedRevision: reviewed,
      }),
    ).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    expect((await schedule()).status).toBe("SUBMITTED");
  });
});

describe("Supervisor review queries", () => {
  it("lists submitted schedules to review with the submitter, and hides schedules before FINALIZED", async () => {
    // A PLANNING schedule in ER is not visible yet (D12).
    const erHead = actors.erHead;
    const er = unwrapOk(
      await createSchedule(as(erHead), {
        departmentId: DEMO_ER.id,
        periodStart: "2026-10-23",
        periodEnd: "2026-11-21",
        label: "آبان ۱۴۰۵",
      }),
    );
    await toSubmitted();

    const queue = await getReviewQueue(as(actors.supervisor));
    expect(queue.awaiting).toEqual([
      expect.objectContaining({
        scheduleId: S,
        status: "SUBMITTED",
        label: DEMO_SCHEDULE.label,
        department: { id: DEMO_ICU.id, code: "icu", name: DEMO_ICU.name },
        submission: expect.objectContaining({
          submittedByName: U.icuHead.displayName,
          submittedAt: NOW,
          decision: null,
        }),
        ownSubmission: false,
      }),
    ]);
    expect(queue.others.map((o) => o.scheduleId)).not.toContain(er.scheduleId);

    unwrapOk(await run(approveSchedule, actors.supervisor));
    const after = await getReviewQueue(as(actors.supervisor));
    expect(after.awaiting).toEqual([]);
    expect(after.others).toEqual([
      expect.objectContaining({
        scheduleId: S,
        status: "APPROVED",
        submission: expect.objectContaining({
          decision: "APPROVED",
          decidedByName: U.supervisor.displayName,
        }),
      }),
    ]);
  });

  it("is only for current Supervisors", async () => {
    for (const who of ["icuHead", "icuNurse"] as const)
      await expect(getReviewQueue(as(actors[who]))).rejects.toBeInstanceOf(
        NotFoundError,
      );
  });

  it("builds the list with a constant number of queries (no query per row)", async () => {
    const queriesFor = async () => {
      const spy = vi.spyOn(pool, "query");
      await getReviewQueue(as(actors.supervisor));
      const count = spy.mock.calls.length;
      spy.mockRestore();
      return count;
    };
    await toSubmitted();
    const one = await queriesFor();
    for (const [start, end, label] of [
      ["2026-11-22", "2026-12-21", "آذر ۱۴۰۵"],
      ["2026-12-22", "2027-01-20", "دی ۱۴۰۵"],
    ] as const) {
      const created = unwrapOk(
        await createSchedule(as(actors.icuHead), {
          departmentId: DEMO_ICU.id,
          periodStart: start,
          periodEnd: end,
          label,
        }),
      );
      await db.execute(
        sql`update schedules set status = 'FINALIZED' where id = ${created.scheduleId}`,
      );
    }
    expect((await getReviewQueue(as(actors.supervisor))).others).toHaveLength(
      2,
    );
    expect(await queriesFor()).toBe(one);
  });

  it("opens a schedule read-only for its Supervisor from FINALIZED on, and 404s otherwise", async () => {
    await toPlanning();
    await expect(
      getSupervisorScheduleReview(as(actors.supervisor), { scheduleId: S }),
    ).rejects.toBeInstanceOf(NotFoundError);
    unwrapOk(await run(finalizeSchedule, actors.icuHead));

    const review = await getSupervisorScheduleReview(as(actors.supervisor), {
      scheduleId: S,
      day: "2026-10-24",
    });
    expect(review.department.code).toBe("icu");
    expect(review.month.editable).toBe(false);
    expect(review.day?.edit).toEqual({
      allowed: false,
      reason: "NOT_AUTHORIZED",
    });
    // Nothing to decide before it is submitted.
    expect(review.workflow.actions).toEqual({
      finalize: null,
      submit: null,
      withdraw: null,
      approve: null,
      return: null,
    });

    unwrapOk(await run(submitSchedule, actors.icuHead));
    const submitted = await getSupervisorScheduleReview(as(actors.supervisor), {
      scheduleId: S,
    });
    expect(submitted.workflow.actions).toMatchObject({
      approve: { blockers: [] },
      return: { blockers: [] },
      withdraw: null,
    });
    expect(submitted.workflow.pending).toMatchObject({
      submittedBy: { userId: U.icuHead.id, displayName: U.icuHead.displayName },
    });

    for (const who of ["icuHead", "icuNurse", "erHead"] as const)
      await expect(
        getSupervisorScheduleReview(as(actors[who]), { scheduleId: S }),
      ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      getSupervisorScheduleReview(as(actors.supervisor), {
        scheduleId: "not-a-uuid",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("offers the Head Nurse withdraw (not approve) while submitted", async () => {
    await toSubmitted();
    const { workflow } = await getScheduleReview(as(actors.icuHead), {
      departmentId: DEMO_ICU.id,
      scheduleId: S,
    });
    expect(workflow.actions).toEqual({
      finalize: null,
      submit: null,
      withdraw: { blockers: [] },
      approve: null,
      return: null,
    });
  });
});

describe("workflow notifications", () => {
  it("lead to the Supervisor's review and the Head Nurse's schedule page", async () => {
    await toSubmitted();
    const [submitted] = await listNotificationsForRecipient(
      db,
      U.supervisor.id,
    );
    expect(
      unwrapOk(
        await markNotificationRead(as(actors.supervisor), {
          notificationId: submitted!.id,
        }),
      ),
    ).toMatchObject({
      type: "SCHEDULE_SUBMITTED",
      scheduleId: S,
      departmentCode: "icu",
    });

    unwrapOk(
      await run(returnSchedule, actors.supervisor, { comment: "اصلاح شود" }),
    );
    const [returned] = await listNotificationsForRecipient(db, U.icuHead.id);
    expect(
      unwrapOk(
        await markNotificationRead(as(actors.icuHead), {
          notificationId: returned!.id,
        }),
      ),
    ).toMatchObject({ type: "SCHEDULE_RETURNED", departmentCode: "icu" });
  });
});
