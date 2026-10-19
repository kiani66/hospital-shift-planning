import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { NotFoundError } from "../../src/application/errors";
import { getWorkforceReportSelection } from "../../src/application/workforce-report/selection";
import { isoDate } from "../../src/domain/shared/dates";
import {
  DEMO_ICU,
  DEMO_ER,
  DEMO_USERS as U,
} from "../../src/infrastructure/db/seed/demo-data";
import { loadActor } from "../../src/infrastructure/repositories/memberships";
import {
  startRevision,
  closeRevision,
} from "../../src/infrastructure/repositories/revisions";
import {
  createSchedule,
  updateSchedule,
} from "../../src/infrastructure/repositories/schedules";
import { createSubmission } from "../../src/infrastructure/repositories/submissions";
import { createVersionFromWorkingCopy } from "../../src/infrastructure/repositories/versions";
import { setupTestDatabase } from "./support/database";

const { db } = setupTestDatabase();
const today = isoDate("2026-10-18");
const period = { start: isoDate("2027-05-01"), end: isoDate("2027-05-31") };
const context = async (id = U.icuHead.id as string) => ({
  db,
  actor: (await loadActor(db, id, today))!,
});
const schedule = (start = "2027-05-02", end = "2027-05-05") =>
  createSchedule(db, {
    departmentId: DEMO_ICU.id,
    period: { start: isoDate(start), end: isoDate(end) },
    label: "برنامه کوتاه",
    createdBy: U.icuHead.id,
  });

describe("workforce report navigation selection", () => {
  it("leaves an empty month empty", async () => {
    expect(
      await getWorkforceReportSelection(await context(), {
        departmentId: DEMO_ICU.id,
        period,
      }),
    ).toEqual({
      schedules: [],
      selectedId: null,
      revisionDraftAvailable: false,
    });
  });
  it("selects a single partial period without changing its dates", async () => {
    const s = await schedule();
    const result = await getWorkforceReportSelection(await context(), {
      departmentId: DEMO_ICU.id,
      period,
    });
    expect(result.selectedId).toBe(s.id);
    expect(result.schedules[0]!.period).toEqual(s.period);
    expect(result.revisionDraftAvailable).toBe(false);
  });
  it("requires explicit choice for several schedules and never combines them", async () => {
    const first = await schedule();
    const second = await schedule("2027-05-20", "2027-06-03");
    const ctx = await context();
    const result = await getWorkforceReportSelection(ctx, {
      departmentId: DEMO_ICU.id,
      period,
    });
    expect(result.selectedId).toBeNull();
    expect(result.schedules.map((s) => s.id)).toEqual([first.id, second.id]);
    expect(
      (
        await getWorkforceReportSelection(ctx, {
          departmentId: DEMO_ICU.id,
          period,
          scheduleId: second.id,
        })
      ).selectedId,
    ).toBe(second.id);
  });
  it.each(["bad-id", randomUUID()])(
    "fails closed for invalid or unknown schedule %s",
    async (scheduleId) => {
      await expect(
        getWorkforceReportSelection(await context(), {
          departmentId: DEMO_ICU.id,
          period,
          scheduleId,
        }),
      ).rejects.toBeInstanceOf(NotFoundError);
    },
  );
  it("does not accept a foreign or out-of-month schedule", async () => {
    const foreign = await createSchedule(db, {
      departmentId: DEMO_ER.id,
      period,
      label: "foreign",
      createdBy: U.erHead.id,
    });
    const outside = await schedule("2027-06-05", "2027-06-07");
    for (const scheduleId of [foreign.id, outside.id])
      await expect(
        getWorkforceReportSelection(await context(), {
          departmentId: DEMO_ICU.id,
          period,
          scheduleId,
        }),
      ).rejects.toBeInstanceOf(NotFoundError);
  });
  it.each([U.icuNurse1.id, U.supervisor.id, U.erHead.id])(
    "denies navigation metadata to unauthorized user %s",
    async (id) => {
      await expect(
        getWorkforceReportSelection(await context(id), {
          departmentId: DEMO_ICU.id,
          period,
        }),
      ).rejects.toBeInstanceOf(NotFoundError);
    },
  );
  it("offers drafts only with an approved pointer and an eligible OPEN revision", async () => {
    const s = await schedule();
    const revision = await startRevision(db, {
      scheduleId: s.id,
      reason: "test",
      startedBy: U.icuHead.id,
      dates: [s.period.start],
    });
    const ctx = await context();
    const input = { departmentId: DEMO_ICU.id, period, scheduleId: s.id };
    expect(
      (await getWorkforceReportSelection(ctx, input)).revisionDraftAvailable,
    ).toBe(false);
    const submission = await createSubmission(db, {
      scheduleId: s.id,
      submittedBy: U.icuHead.id,
    });
    const version = await createVersionFromWorkingCopy(db, {
      scheduleId: s.id,
      submissionId: submission.id,
      approvedBy: U.supervisor.id,
    });
    await updateSchedule(db, {
      id: s.id,
      expectedRevision: 0,
      currentVersionId: version.id,
    });
    expect(
      (await getWorkforceReportSelection(ctx, input)).revisionDraftAvailable,
    ).toBe(true);
    await closeRevision(db, {
      id: revision,
      status: "DISCARDED",
      now: new Date(),
    });
    expect(
      (await getWorkforceReportSelection(ctx, input)).revisionDraftAvailable,
    ).toBe(false);
  });
});
