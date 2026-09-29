import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { canEditAssignment } from "../../src/domain/schedule/assignment-editing";
import { nurseScheduleView } from "../../src/domain/schedule/visibility";
import { isoDate } from "../../src/domain/shared/dates";
import {
  DEMO_SCHEDULE,
  DEMO_USERS,
} from "../../src/infrastructure/db/seed/demo-data";
import {
  listAssignments,
  setAssignment,
} from "../../src/infrastructure/repositories/assignments";
import {
  closeRevision,
  extendRevisionScope,
  findOpenRevision,
  startRevision,
} from "../../src/infrastructure/repositories/revisions";
import {
  findScheduleById,
  updateSchedule,
} from "../../src/infrastructure/repositories/schedules";
import {
  createSubmission,
  decideSubmission,
  findPendingSubmission,
  listSubmissions,
} from "../../src/infrastructure/repositories/submissions";
import * as versions from "../../src/infrastructure/repositories/versions";
import { setupTestDatabase } from "./support/database";

const { db } = setupTestDatabase();
const U = DEMO_USERS;
const S = DEMO_SCHEDULE.id;
const head = U.icuHead.id;
const now = new Date("2026-10-20T09:00:00Z");

async function approveCurrentWorkingCopy() {
  const submission = await createSubmission(db, {
    scheduleId: S,
    submittedBy: head,
  });
  await decideSubmission(db, {
    id: submission.id,
    decision: "APPROVED",
    decidedBy: U.supervisor.id,
    now,
  });
  const version = await versions.createVersionFromWorkingCopy(db, {
    scheduleId: S,
    submissionId: submission.id,
    approvedBy: U.supervisor.id,
  });
  const schedule = (await findScheduleById(db, S))!;
  await updateSchedule(db, {
    id: S,
    expectedRevision: schedule.revision,
    status: "APPROVED",
    currentVersionId: version.id,
  });
  return version;
}

describe("submissions", () => {
  it("allows only one pending submission per schedule", async () => {
    await createSubmission(db, {
      scheduleId: S,
      submittedBy: head,
      note: "Ready",
    });
    await expect(
      createSubmission(db, { scheduleId: S, submittedBy: head }),
    ).rejects.toThrow();
  });

  it("records the decision on the submission; a decided one frees the slot", async () => {
    const first = await createSubmission(db, {
      scheduleId: S,
      submittedBy: head,
    });
    expect(await findPendingSubmission(db, S)).toMatchObject({
      id: first.id,
      decision: null,
    });

    const returned = await decideSubmission(db, {
      id: first.id,
      decision: "RETURNED",
      decidedBy: U.supervisor.id,
      comment: "Cover the 12th",
      now,
    });
    expect(returned).toMatchObject({
      decision: "RETURNED",
      decisionComment: "Cover the 12th",
      decidedAt: now,
    });
    expect(
      await decideSubmission(db, {
        id: first.id,
        decision: "APPROVED",
        decidedBy: U.supervisor.id,
        now,
      }),
    ).toBeNull();
    expect(await findPendingSubmission(db, S)).toBeNull();

    await createSubmission(db, { scheduleId: S, submittedBy: head });
    expect((await listSubmissions(db, S)).map((s) => s.decision)).toEqual([
      "RETURNED",
      null,
    ]);
  });

  it("rejects a half-recorded decision (check constraint)", async () => {
    const s = await createSubmission(db, { scheduleId: S, submittedBy: head });
    await expect(
      db.execute(
        sql`update schedule_submissions set decision = 'APPROVED' where id = ${s.id}`,
      ),
    ).rejects.toThrow();
  });
});

describe("approved versions", () => {
  it("snapshots the working copy separately from it", async () => {
    await setAssignment(db, {
      scheduleId: S,
      userId: U.icuNurse1.id,
      date: isoDate("2026-10-24"),
      shift: "N",
      updatedBy: head,
    });
    await setAssignment(db, {
      scheduleId: S,
      userId: U.icuNurse2.id,
      date: isoDate("2026-10-24"),
      shift: "ME",
      updatedBy: head,
    });

    const v1 = await approveCurrentWorkingCopy();
    expect(v1.versionNo).toBe(1);
    expect(await versions.listVersionAssignments(db, v1.id)).toEqual([
      { nurseId: U.icuNurse1.id, date: "2026-10-24", shift: "N" },
      { nurseId: U.icuNurse2.id, date: "2026-10-24", shift: "ME" },
    ]);
    expect((await findScheduleById(db, S))?.currentVersionId).toBe(v1.id);

    // Later edits to the working copy never touch the approved snapshot.
    await setAssignment(db, {
      scheduleId: S,
      userId: U.icuNurse1.id,
      date: isoDate("2026-10-24"),
      shift: "M",
      updatedBy: head,
    });
    expect((await listAssignments(db, S))[0]?.shift).toBe("M");
    expect(
      (
        await versions.listVersionAssignments(db, v1.id, {
          userId: U.icuNurse1.id,
        })
      )[0]?.shift,
    ).toBe("N");
  });

  it("numbers versions 1, 2, … and keeps every one readable", async () => {
    const v1 = await approveCurrentWorkingCopy();
    await setAssignment(db, {
      scheduleId: S,
      userId: U.icuNurse3.id,
      date: isoDate("2026-11-01"),
      shift: "E",
      updatedBy: head,
    });
    const v2 = await approveCurrentWorkingCopy();

    expect(
      (await versions.listVersions(db, S)).map((v) => v.versionNo),
    ).toEqual([1, 2]);
    expect(await versions.findLatestVersion(db, S)).toEqual(v2);
    expect(await versions.findVersionById(db, v1.id)).toEqual(v1);
    expect(await versions.listVersionAssignments(db, v1.id)).toEqual([]);
    expect(await versions.listVersionAssignments(db, v2.id)).toHaveLength(1);
  });

  it("exposes no way to update or delete a version", () => {
    const writers = Object.keys(versions).filter((name) =>
      /update|delete|remove|set/i.test(name),
    );
    expect(writers).toEqual([]);
  });

  it("ties each version to exactly one submission", async () => {
    const v1 = await approveCurrentWorkingCopy();
    await expect(
      versions.createVersionFromWorkingCopy(db, {
        scheduleId: S,
        submissionId: v1.submissionId,
        approvedBy: U.supervisor.id,
      }),
    ).rejects.toThrow();
  });

  it("feeds the nurse visibility rule (approved snapshot once approved)", async () => {
    await approveCurrentWorkingCopy();
    const schedule = (await findScheduleById(db, S))!;
    expect(
      nurseScheduleView({
        status: schedule.status,
        hasApprovedVersion: schedule.currentVersionId !== null,
      }),
    ).toEqual({
      source: "APPROVED_VERSION",
      pendingChangeDates: [],
    });
  });

  it("returns nothing for a schedule that was never approved", async () => {
    expect(await versions.findLatestVersion(db, S)).toBeNull();
    expect(
      await versions.findVersionById(
        db,
        "99999999-0000-4000-8000-000000000000",
      ),
    ).toBeNull();
  });
});

describe("post-approval revisions", () => {
  it("persists an explicit revision scope and extends it", async () => {
    await approveCurrentWorkingCopy();
    const id = await startRevision(db, {
      scheduleId: S,
      reason: "Sick leave on the 29th",
      startedBy: head,
      dates: [isoDate("2026-11-19"), isoDate("2026-11-20")],
    });
    expect(await findOpenRevision(db, S)).toMatchObject({
      id,
      status: "OPEN",
      dates: ["2026-11-19", "2026-11-20"],
    });

    expect(
      await extendRevisionScope(db, {
        revisionId: id,
        dates: [isoDate("2026-11-20"), isoDate("2026-11-21")],
        addedBy: head,
      }),
    ).toBe(1);
    expect(
      await extendRevisionScope(db, {
        revisionId: id,
        dates: [],
        addedBy: head,
      }),
    ).toBe(0);
    const open = (await findOpenRevision(db, S))!;
    expect(open.dates).toEqual(["2026-11-19", "2026-11-20", "2026-11-21"]);

    // D14: the persisted scope drives the domain edit rule.
    const period = { start: isoDate("2026-10-23"), end: isoDate("2026-11-21") };
    const revisionDates = new Set(open.dates);
    expect(
      canEditAssignment({
        status: "REVISING",
        period,
        date: isoDate("2026-11-21"),
        revisionDates,
      }).allowed,
    ).toBe(true);
    expect(
      canEditAssignment({
        status: "REVISING",
        period,
        date: isoDate("2026-11-18"),
        revisionDates,
      }).allowed,
    ).toBe(false);
  });

  it("allows one open revision per schedule; closing frees the slot", async () => {
    const first = await startRevision(db, {
      scheduleId: S,
      reason: "a",
      startedBy: head,
      dates: [isoDate("2026-11-01")],
    });
    await expect(
      startRevision(db, {
        scheduleId: S,
        reason: "b",
        startedBy: head,
        dates: [isoDate("2026-11-02")],
      }),
    ).rejects.toThrow();

    expect(
      await closeRevision(db, { id: first, status: "APPROVED", now }),
    ).toBe(true);
    expect(
      await closeRevision(db, { id: first, status: "DISCARDED", now }),
    ).toBe(false);
    expect(await findOpenRevision(db, S)).toBeNull();
    await startRevision(db, {
      scheduleId: S,
      reason: "c",
      startedBy: head,
      dates: [isoDate("2026-11-03")],
    });
  });
});
