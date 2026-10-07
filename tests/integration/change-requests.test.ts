import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import {
  applyChangeRequest,
  cancelChangeRequest,
  createChangeRequest,
  DUPLICATE_ACTIVE_REQUEST,
  refreshSwapRequest,
  rejectChangeRequest,
  respondToSwapRequest,
} from "../../src/application/change-requests/commands";
import {
  getChangeRequestOptions,
  getChangeRequestQueue,
  getChangeRequestReview,
  getMyChangeRequests,
} from "../../src/application/change-requests/queries";
import { NotFoundError } from "../../src/application/errors";
import type { ActionResult } from "../../src/application/result";
import { getAdjustmentPreview } from "../../src/application/schedules/change-preview";
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
import {
  adjustSchedule,
  discardRevision,
  previewScheduleAdjustment,
} from "../../src/application/schedules/schedule-changes";
import type { AppContext } from "../../src/application/use-case";
import { getDepartmentForPage } from "../../src/application/workspace/queries";
import type { Actor } from "../../src/domain/authz/actor";
import { isoDate, type IsoDate } from "../../src/domain/shared/dates";
import type { ShiftCode } from "../../src/domain/shifts/shift-type";
import {
  DEMO_ER,
  DEMO_ICU,
  DEMO_SCHEDULE,
  DEMO_USERS,
} from "../../src/infrastructure/db/seed/demo-data";
import {
  clearAssignment,
  listAssignments,
  setAssignment,
} from "../../src/infrastructure/repositories/assignments";
import { listAuditEventsForSchedule } from "../../src/infrastructure/repositories/audit";
import { findChangeRequest } from "../../src/infrastructure/repositories/change-requests";
import { loadActor } from "../../src/infrastructure/repositories/memberships";
import { listNotificationsForRecipient } from "../../src/infrastructure/repositories/notifications";
import { findOpenRevision } from "../../src/infrastructure/repositories/revisions";
import { listScheduleChanges } from "../../src/infrastructure/repositories/schedule-changes";
import { findScheduleById } from "../../src/infrastructure/repositories/schedules";
import {
  listVersionAssignments,
  listVersions,
} from "../../src/infrastructure/repositories/versions";
import { completeScheduleFixture } from "../support/complete-schedule";
import {
  pinTestRuleSet,
  publishTestRuleSet,
  ruleContent,
} from "./support/rule-sets";
import { setupTestDatabase } from "./support/database";

const { db } = setupTestDatabase();
const U = DEMO_USERS;
const S = DEMO_SCHEDULE.id; // ICU, Aban 1405: 2026-10-23 .. 2026-11-21
const TODAY = isoDate("2026-10-01");
const NOW = new Date("2026-10-01T06:30:00Z");

type Who =
  "head" | "erHead" | "nurse1" | "nurse2" | "nurse3" | "erNurse" | "supervisor";
const actors = {} as Record<Who, Actor>;
const as = (actor: Actor, clock: Date = NOW): AppContext => ({
  db,
  actor,
  clock: () => clock,
});

beforeEach(async () => {
  const load = async (id: string) => (await loadActor(db, id, TODAY))!;
  actors.head = await load(U.icuHead.id);
  actors.erHead = await load(U.erHead.id);
  actors.nurse1 = await load(U.icuNurse1.id);
  actors.nurse2 = await load(U.icuNurse2.id);
  actors.nurse3 = await load(U.icuNurse3.id);
  actors.erNurse = await load(U.erNurse1.id);
  actors.supervisor = await load(U.supervisor.id);
});

const schedule = async () => (await findScheduleById(db, S))!;
const revision = async () => (await schedule()).revision;

function ok<T>(result: ActionResult<T>): T {
  if (!result.ok)
    throw new Error(
      `${result.error.code} ${result.error.reason ?? ""}: ${result.error.message}`,
    );
  return result.data;
}

function failure<T>(result: ActionResult<T>) {
  if (result.ok) throw new Error("expected a failure");
  return result.error;
}

const d = isoDate;
const assign = (userId: string, date: string, shift: ShiftCode) =>
  setAssignment(db, {
    scheduleId: S,
    userId,
    date: d(date),
    shift,
    updatedBy: U.icuHead.id,
  });

/** The working-copy shift of a nurse on a day (null: off). */
async function cell(userId: string, date: string) {
  const all = await listAssignments(db, S);
  return (
    all.find((a) => a.nurseId === userId && a.date === date)?.shift ?? null
  );
}

/**
 * Base plan: 25 Oct nurse1 M, nurse2 E (nurse3 off); 27 Oct nurse1 E,
 * 28 Oct nurse1 M. Valid, so it can be finalized.
 */
async function plan() {
  await assign(U.icuNurse1.id, "2026-10-25", "M");
  await assign(U.icuNurse2.id, "2026-10-25", "E");
  await assign(U.icuNurse1.id, "2026-10-27", "E");
  await assign(U.icuNurse1.id, "2026-10-28", "M");
  await completeScheduleFixture(db, S, [
    U.icuHead.id,
    U.icuNurse4.id,
    U.transferNurse.id,
  ]);
}

async function lifecycle(
  command: typeof finalizeSchedule,
  actor: Actor,
): Promise<void> {
  ok(
    await command(as(actor), {
      scheduleId: S,
      expectedRevision: await revision(),
    }),
  );
}

async function toFinalized() {
  await plan();
  await lifecycle(openPreferenceWindow as typeof finalizeSchedule, actors.head);
  await lifecycle(
    closePreferenceWindow as typeof finalizeSchedule,
    actors.head,
  );
  await lifecycle(finalizeSchedule, actors.head);
}

async function toApproved() {
  await toFinalized();
  await lifecycle(submitSchedule, actors.head);
  await lifecycle(approveSchedule, actors.supervisor);
}

const request = (actor: Actor, input: Record<string, unknown>, clock?: Date) =>
  createChangeRequest(as(actor, clock), {
    scheduleId: S,
    reasonCode: "ILLNESS",
    ...input,
  });

const unavailable = (actor = actors.nurse1, date = "2026-10-25") =>
  request(actor, { type: "UNAVAILABLE", date });

const swap = () =>
  request(actors.nurse1, {
    type: "SWAP",
    date: "2026-10-25",
    counterpartId: U.icuNurse2.id,
    reasonCode: "PERSONAL_MATTER",
  });

async function apply(requestId: string, extra: Record<string, unknown> = {}) {
  return applyChangeRequest(as(actors.head), {
    requestId,
    expectedRevision: await revision(),
    ...extra,
  });
}

async function auditActions() {
  return (await listAuditEventsForSchedule(db, S)).map((e) => e.action);
}

describe("creating requests (nurse)", () => {
  beforeEach(toFinalized);

  it("1. creates a valid UNAVAILABLE request against what the nurse sees, without changing the schedule", async () => {
    const before = await listAssignments(db, S);
    const { id } = ok(await unavailable());
    expect(await findChangeRequest(db, id)).toMatchObject({
      scheduleId: S,
      departmentId: DEMO_ICU.id,
      versionId: null, // finalized, never approved: the working copy (D11)
      requesterId: U.icuNurse1.id,
      type: "UNAVAILABLE",
      date: "2026-10-25",
      requesterShift: "M",
      reasonCode: "ILLNESS",
      status: "PENDING",
      consent: null,
    });
    expect(await listAssignments(db, S)).toEqual(before);
    const [notification] = await listNotificationsForRecipient(
      db,
      U.icuHead.id,
    );
    expect(notification).toMatchObject({
      type: "CHANGE_REQUEST_SUBMITTED",
      data: { requestId: id, date: "2026-10-25" },
    });
    expect(await auditActions()).toContain("changeRequest.created");
  });

  it("2. creates a CHANGE_SHIFT request naming the requested shift", async () => {
    const { id } = ok(
      await request(actors.nurse1, {
        type: "CHANGE_SHIFT",
        date: "2026-10-25",
        targetShift: "E",
        reasonCode: "EDUCATION",
        note: "کلاس صبح",
      }),
    );
    expect(await findChangeRequest(db, id)).toMatchObject({
      type: "CHANGE_SHIFT",
      requesterShift: "M",
      targetShift: "E",
      note: "کلاس صبح",
    });
  });

  it("3. creates a SWAP request; the partner's consent is pending and asked for", async () => {
    const { id } = ok(await swap());
    expect(await findChangeRequest(db, id)).toMatchObject({
      type: "SWAP",
      counterpartId: U.icuNurse2.id,
      counterpartShift: "E",
      consent: "PENDING",
    });
    const [n] = await listNotificationsForRecipient(db, U.icuNurse2.id);
    expect(n).toMatchObject({ type: "SWAP_CONSENT_REQUESTED" });
  });

  it("5. always asks for the actor themself; another department's nurse is refused", async () => {
    const { id } = ok(
      await request(actors.nurse1, {
        type: "UNAVAILABLE",
        date: "2026-10-25",
        requesterId: U.icuNurse2.id, // ignored: the requester is the actor
      }),
    );
    expect((await findChangeRequest(db, id))!.requesterId).toBe(U.icuNurse1.id);
    // nurse2 asking "for" nurse1's day asks about their own assignment (E).
    const { id: other } = ok(await unavailable(actors.nurse2));
    expect(await findChangeRequest(db, other)).toMatchObject({
      requesterId: U.icuNurse2.id,
      requesterShift: "E",
    });
    expect(failure(await unavailable(actors.erNurse))).toMatchObject({
      code: "FORBIDDEN",
      reason: "NOT_MEMBER_OF_DEPARTMENT",
    });
  });

  it("9. rejects a duplicate active request; history stays and a new one is allowed after cancelling", async () => {
    const { id } = ok(await unavailable());
    expect(
      failure(
        await request(actors.nurse1, {
          type: "CHANGE_SHIFT",
          date: "2026-10-25",
          targetShift: "N",
        }),
      ),
    ).toMatchObject({ code: "CONFLICT", reason: DUPLICATE_ACTIVE_REQUEST });
    ok(await cancelChangeRequest(as(actors.nurse1), { requestId: id }));
    const { id: second } = ok(await unavailable());
    expect(second).not.toBe(id);
    expect((await findChangeRequest(db, id))!.status).toBe("CANCELLED");
    // Another day is a different request.
    ok(await unavailable(actors.nurse1, "2026-10-27"));
  });

  it("enforces one active request per nurse and day in the database too", async () => {
    ok(await unavailable());
    await expect(
      db.execute(sql`
        insert into shift_change_requests (schedule_id, requester_id, type, date, requester_shift_code, reason_code)
        values (${S}, ${U.icuNurse1.id}, 'UNAVAILABLE', '2026-10-25', 'M', 'ILLNESS')`),
    ).rejects.toMatchObject({
      cause: { constraint: "shift_change_requests_one_active_key" },
    });
  });

  it("10. refuses a request for a past day", async () => {
    const dayAfter = new Date("2026-10-26T06:00:00Z"); // Tehran: 26 Oct
    expect(
      failure(
        await request(
          actors.nurse1,
          { type: "UNAVAILABLE", date: "2026-10-25" },
          dayAfter,
        ),
      ),
    ).toMatchObject({
      code: "VALIDATION",
      fieldErrors: { date: [expect.any(String)] },
    });
  });

  it("refuses a day without an assignment and a day outside the period", async () => {
    await clearAssignment(db, {
      scheduleId: S,
      userId: U.icuNurse3.id,
      date: d("2026-10-25"),
    });
    expect(failure(await unavailable(actors.nurse3))).toMatchObject({
      code: "VALIDATION",
      fieldErrors: { date: [expect.any(String)] },
    });
    expect(failure(await unavailable(actors.nurse1, "2026-11-22")).code).toBe(
      "VALIDATION",
    );
  });

  it("11. requires a note when the reason is Other", async () => {
    const other = (note?: string) =>
      request(actors.nurse1, {
        type: "OTHER",
        date: "2026-10-25",
        reasonCode: "OTHER",
        note,
      });
    expect(failure(await other("   "))).toMatchObject({
      code: "VALIDATION",
      fieldErrors: { note: [expect.any(String)] },
    });
    ok(await other("مراجعه به پزشک"));
  });

  it("12. rejects an unknown, inactive or adjustment-only reason", async () => {
    // Reference data survives the seed reset: restore it whatever happens.
    await db.execute(
      sql`update change_reasons set is_active = false where code = 'FAMILY_EMERGENCY'`,
    );
    try {
      for (const reasonCode of ["NOPE", "FAMILY_EMERGENCY", "STAFFING_NEED"])
        expect(
          failure(
            await request(actors.nurse1, {
              type: "UNAVAILABLE",
              date: "2026-10-25",
              reasonCode,
            }),
          ),
        ).toMatchObject({
          code: "VALIDATION",
          fieldErrors: { reasonCode: [expect.any(String)] },
        });
    } finally {
      await db.execute(
        sql`update change_reasons set is_active = true where code = 'FAMILY_EMERGENCY'`,
      );
    }
  });

  it("is refused before finalization (preferences are the way to ask)", async () => {
    await db.execute(
      sql`update schedules set status = 'PLANNING' where id = ${S}`,
    );
    expect(failure(await unavailable())).toMatchObject({
      code: "FORBIDDEN",
      reason: "SCHEDULE_NOT_YET_FINALIZED",
    });
  });
});

describe("cancelling (nurse)", () => {
  beforeEach(toFinalized);

  it("7. the requester cancels a pending request; it stays in history", async () => {
    const { id } = ok(await unavailable());
    expect(
      failure(await cancelChangeRequest(as(actors.nurse2), { requestId: id })),
    ).toMatchObject({
      code: "FORBIDDEN",
      reason: "NOT_REQUESTER",
    });
    expect(
      ok(await cancelChangeRequest(as(actors.nurse1), { requestId: id })),
    ).toEqual({
      status: "CANCELLED",
    });
    expect(await findChangeRequest(db, id)).toMatchObject({
      status: "CANCELLED",
      cancelledBy: U.icuNurse1.id,
    });
    expect(await auditActions()).toContain("changeRequest.cancelled");
  });

  it("8. an applied request cannot be cancelled", async () => {
    const { id } = ok(await unavailable());
    ok(await apply(id));
    expect(
      failure(await cancelChangeRequest(as(actors.nurse1), { requestId: id })),
    ).toMatchObject({
      code: "INVALID_STATE",
      reason: "CANCEL",
    });
    expect((await findChangeRequest(db, id))!.status).toBe("APPLIED");
  });
});

describe("swap consent", () => {
  beforeEach(toFinalized);

  it("4. a swap cannot be applied without the partner's consent; with it, both shifts are exchanged", async () => {
    const { id } = ok(await swap());
    expect(failure(await apply(id))).toMatchObject({
      code: "INVALID_STATE",
      reason: "APPLY_SWAP_WITHOUT_CONSENT",
    });
    // Only the partner answers, not the requester nor the Head Nurse.
    for (const actor of [actors.nurse1, actors.head])
      expect(
        failure(
          await respondToSwapRequest(as(actor), {
            requestId: id,
            accept: true,
          }),
        ),
      ).toMatchObject({ code: "FORBIDDEN", reason: "NOT_COUNTERPART" });
    ok(
      await respondToSwapRequest(as(actors.nurse2), {
        requestId: id,
        accept: true,
      }),
    );
    expect(await findChangeRequest(db, id)).toMatchObject({
      consent: "ACCEPTED",
      consentBy: U.icuNurse2.id,
      status: "PENDING",
    });
    ok(await apply(id));
    expect(await cell(U.icuNurse1.id, "2026-10-25")).toBe("E");
    expect(await cell(U.icuNurse2.id, "2026-10-25")).toBe("M");
  });

  it("a declined swap is closed as rejected by the partner and the requester is told", async () => {
    const { id } = ok(await swap());
    ok(
      await respondToSwapRequest(as(actors.nurse2), {
        requestId: id,
        accept: false,
      }),
    );
    expect(await findChangeRequest(db, id)).toMatchObject({
      status: "REJECTED",
      consent: "DECLINED",
      rejection: "COUNTERPART_DECLINED",
      rejectedBy: U.icuNurse2.id,
    });
    const [n] = await listNotificationsForRecipient(db, U.icuNurse1.id);
    expect(n).toMatchObject({
      type: "CHANGE_REQUEST_REVIEWED",
      data: { outcome: "REJECTED", rejection: "COUNTERPART_DECLINED" },
    });
  });

  it("a changed swap context blocks applying until refreshed and consented again", async () => {
    const { id } = ok(await swap());
    ok(
      await respondToSwapRequest(as(actors.nurse2), {
        requestId: id,
        accept: true,
      }),
    );
    // The Head Nurse moves the partner to N on that day (finalized: whole period editable).
    ok(
      await setAssignments(as(actors.head), {
        scheduleId: S,
        expectedRevision: await revision(),
        changes: [{ nurseId: U.icuNurse2.id, date: "2026-10-25", shift: "N" }],
      }),
    );
    expect(failure(await apply(id))).toMatchObject({
      code: "INVALID_STATE",
      reason: "SWAP_CONTEXT_CHANGED",
    });
    expect(
      ok(await refreshSwapRequest(as(actors.nurse1), { requestId: id })),
    ).toEqual({
      changed: true,
    });
    expect(await findChangeRequest(db, id)).toMatchObject({
      counterpartShift: "N",
      consent: "PENDING",
      consentAt: null,
    });
    expect(failure(await apply(id)).reason).toBe("APPLY_SWAP_WITHOUT_CONSENT");
    ok(
      await respondToSwapRequest(as(actors.nurse2), {
        requestId: id,
        accept: true,
      }),
    );
    ok(await apply(id));
    expect(await cell(U.icuNurse1.id, "2026-10-25")).toBe("N");
    expect(await cell(U.icuNurse2.id, "2026-10-25")).toBe("M");
    expect(await auditActions()).toContain("changeRequest.swapRefreshed");
  });

  it("flags a changed pending swap for both nurses; only the requester may refresh it", async () => {
    const { id } = ok(await swap());
    const flags = async (actor: Actor) => {
      const r = (await getMyChangeRequests(as(actor))).find(
        (x) => x.id === id,
      )!;
      return {
        changed: r.swapContextChanged,
        refresh: r.canRefresh,
        respond: r.canRespond,
      };
    };
    expect(await flags(actors.nurse1)).toEqual({
      changed: false,
      refresh: false,
      respond: false,
    });
    await assign(U.icuNurse2.id, "2026-10-25", "N");
    expect(await flags(actors.nurse1)).toEqual({
      changed: true,
      refresh: true,
      respond: false,
    });
    expect(await flags(actors.nurse2)).toEqual({
      changed: true,
      refresh: false,
      respond: true,
    });
    expect(
      failure(await refreshSwapRequest(as(actors.nurse2), { requestId: id })),
    ).toMatchObject({ code: "FORBIDDEN", reason: "NOT_REQUESTER" });
    ok(await refreshSwapRequest(as(actors.nurse1), { requestId: id }));
    expect((await flags(actors.nurse2)).changed).toBe(false);
  });

  it("a partner cannot accept a swap whose context changed", async () => {
    const { id } = ok(await swap());
    await assign(U.icuNurse2.id, "2026-10-25", "N");
    expect(
      failure(
        await respondToSwapRequest(as(actors.nurse2), {
          requestId: id,
          accept: true,
        }),
      ),
    ).toMatchObject({ code: "INVALID_STATE", reason: "SWAP_CONTEXT_CHANGED" });
  });
});

describe("applying and rejecting (Head Nurse)", () => {
  beforeEach(toFinalized);

  it("6. a nurse can neither apply, reject nor edit the finalized schedule directly", async () => {
    const { id } = ok(await unavailable());
    expect(
      failure(
        await applyChangeRequest(as(actors.nurse1), {
          requestId: id,
          expectedRevision: await revision(),
        }),
      ),
    ).toMatchObject({
      code: "FORBIDDEN",
      reason: "NOT_HEAD_NURSE_OF_DEPARTMENT",
    });
    expect(
      failure(await rejectChangeRequest(as(actors.nurse1), { requestId: id }))
        .code,
    ).toBe("FORBIDDEN");
    expect(
      failure(
        await setAssignments(as(actors.nurse1), {
          scheduleId: S,
          expectedRevision: await revision(),
          changes: [
            { nurseId: U.icuNurse1.id, date: "2026-10-25", shift: null },
          ],
        }),
      ).code,
    ).toBe("FORBIDDEN");
    expect(await cell(U.icuNurse1.id, "2026-10-25")).toBe("M");
  });

  it("15/16. applying changes the assignment, records the change separately and keeps the request auditable", async () => {
    const { id } = ok(await unavailable());
    expect(await cell(U.icuNurse1.id, "2026-10-25")).toBe("M");
    const result = ok(await apply(id, { replacementNurseId: U.icuNurse3.id }));
    expect(result).toMatchObject({
      mode: "WORKING_COPY",
      status: "FINALIZED",
      revisionId: null,
    });
    expect(await cell(U.icuNurse1.id, "2026-10-25")).toBe("OFF");
    expect(await cell(U.icuNurse3.id, "2026-10-25")).toBe("M");

    expect(await findChangeRequest(db, id)).toMatchObject({
      status: "APPLIED",
      appliedBy: U.icuHead.id,
      requesterShift: "M",
      reasonCode: "ILLNESS",
    });
    const [change] = await listScheduleChanges(db, { scheduleId: S });
    expect(change).toMatchObject({
      id: result.changeId,
      kind: "REQUEST",
      requestId: id,
      reasonCode: "ILLNESS",
      appliedBy: U.icuHead.id,
      revisionId: null,
      // Before and after of every cell (ordered by day, then nurse id).
      cells: [
        {
          nurseId: U.icuNurse1.id,
          date: "2026-10-25",
          before: "M",
          after: "OFF",
        },
        {
          nurseId: U.icuNurse3.id,
          date: "2026-10-25",
          before: "OFF",
          after: "M",
        },
      ],
    });
    const events = await listAuditEventsForSchedule(db, S);
    const applied = events.find((e) => e.action === "changeRequest.applied")!;
    expect(applied).toMatchObject({
      actorId: U.icuHead.id,
      entityId: id,
      data: { changeId: result.changeId, mode: "WORKING_COPY" },
    });
    expect(
      events
        .filter((e) => e.data.changeId === result.changeId)
        .map((e) => e.action)
        .sort(),
    ).toEqual([
      "assignment.changed",
      "assignment.changed",
      "changeRequest.applied",
    ]);
    const [n] = await listNotificationsForRecipient(db, U.icuNurse1.id);
    expect(n).toMatchObject({
      type: "CHANGE_REQUEST_REVIEWED",
      data: { outcome: "APPLIED" },
    });
  });

  it("rejects with a note the nurse sees; nothing changes in the schedule", async () => {
    const { id } = ok(await unavailable());
    ok(
      await rejectChangeRequest(as(actors.head), {
        requestId: id,
        note: "نیرو کافی نیست",
      }),
    );
    expect(await findChangeRequest(db, id)).toMatchObject({
      status: "REJECTED",
      rejection: "HEAD_NURSE",
      rejectedBy: U.icuHead.id,
      rejectionNote: "نیرو کافی نیست",
    });
    expect(await cell(U.icuNurse1.id, "2026-10-25")).toBe("M");
    expect(failure(await apply(id))).toMatchObject({
      code: "INVALID_STATE",
      reason: "APPLY",
    });
    const [mine] = await getMyChangeRequests(as(actors.nurse1));
    expect(mine).toMatchObject({
      status: "REJECTED",
      rejectionNote: "نیرو کافی نیست",
      canCancel: false,
    });
  });

  it("13. a hard-rule violation (night rest) blocks applying and writes nothing", async () => {
    const { id } = ok(
      await request(actors.nurse1, {
        type: "CHANGE_SHIFT",
        date: "2026-10-27",
        targetShift: "N",
      }),
    );
    const before = await listAssignments(db, S);
    const error = failure(await apply(id));
    expect(error).toMatchObject({ code: "RULE_VIOLATION" });
    expect(error.violations).toMatchObject([
      {
        rule: "NIGHT_REST",
        nurseId: U.icuNurse1.id,
        nightDate: "2026-10-27",
        date: "2026-10-28",
      },
    ]);
    expect(await listAssignments(db, S)).toEqual(before);
    expect((await findChangeRequest(db, id))!.status).toBe("PENDING");
    expect(await listScheduleChanges(db, { scheduleId: S })).toEqual([]);
  });

  it("a pre-existing, unrelated hard violation does not block another change", async () => {
    await assign(U.icuNurse2.id, "2026-10-30", "N");
    await assign(U.icuNurse2.id, "2026-10-31", "M"); // unrelated night-rest finding
    const { id } = ok(await unavailable());
    ok(await apply(id));
  });

  it("14. a pinned staffing minimum blocks a newly introduced shortage", async () => {
    // The schedule's pinned version requires two in the Morning on that day.
    const versionId = await publishTestRuleSet(db, {
      departmentId: DEMO_ICU.id,
      createdBy: U.supervisor.id,
      content: ruleContent(
        { min: 1, max: null },
        {
          exceptions: [
            {
              date: d("2026-10-25"),
              period: "M",
              bounds: { min: 2, max: null },
              note: null,
            },
          ],
        },
      ),
    });
    await pinTestRuleSet(db, S, versionId);
    const { id } = ok(await unavailable());
    const review = await getChangeRequestReview(as(actors.head), {
      departmentId: DEMO_ICU.id,
      requestId: id,
    });
    expect(review.preview).toMatchObject({
      ok: true,
      evaluation: {
        assessment: {
          blocked: true,
          blocking: [
            expect.objectContaining({
              rule: "STAFFING",
              period: "M",
              covered: 1,
            }),
          ],
        },
      },
    });
    expect(failure(await apply(id)).code).toBe("RULE_VIOLATION");
    expect(await cell(U.icuNurse1.id, "2026-10-25")).toBe("M");
  });

  it("recomputes a stale UNAVAILABLE / CHANGE_SHIFT request against the current assignment, after explicit confirmation", async () => {
    const { id } = ok(
      await request(actors.nurse1, {
        type: "CHANGE_SHIFT",
        date: "2026-10-25",
        targetShift: "E",
      }),
    );
    await assign(U.icuNurse1.id, "2026-10-25", "N"); // changed since the request
    const review = await getChangeRequestReview(as(actors.head), {
      departmentId: DEMO_ICU.id,
      requestId: id,
    });
    expect(review.stale).toEqual({
      nurseId: U.icuNurse1.id,
      date: "2026-10-25",
      requestedAgainst: "M",
      current: "N",
    });
    expect(failure(await apply(id))).toMatchObject({
      code: "INVALID_STATE",
      reason: "STALE_CONTEXT_NOT_CONFIRMED",
    });
    const result = ok(await apply(id, { confirmStaleContext: true }));
    expect(result.changes).toEqual([
      { nurseId: U.icuNurse1.id, date: "2026-10-25", before: "N", after: "E" },
    ]);
  });

  it("OTHER: the Head Nurse decides the resulting shift", async () => {
    const { id } = ok(
      await request(actors.nurse1, {
        type: "OTHER",
        date: "2026-10-25",
        reasonCode: "OTHER",
        note: "فقط عصر می‌توانم",
      }),
    );
    expect(failure(await apply(id))).toMatchObject({
      code: "VALIDATION",
      fieldErrors: { requesterShift: [expect.any(String)] },
    });
    ok(await apply(id, { requesterShift: "E" }));
    expect(await cell(U.icuNurse1.id, "2026-10-25")).toBe("E");
  });

  it("a stale revision is refused with CONFLICT and nothing is written", async () => {
    const { id } = ok(await unavailable());
    expect(
      failure(
        await applyChangeRequest(as(actors.head), {
          requestId: id,
          expectedRevision: (await revision()) - 1,
        }),
      ).code,
    ).toBe("CONFLICT");
    expect((await findChangeRequest(db, id))!.status).toBe("PENDING");
  });

  it("a SUBMITTED schedule is frozen: requests are accepted, applying waits for a withdrawal (D10)", async () => {
    await lifecycle(submitSchedule, actors.head);
    const { id } = ok(await unavailable());
    expect(failure(await apply(id))).toMatchObject({
      code: "INVALID_STATE",
      reason: "CHANGE_WHILE_SUBMITTED",
    });
    const review = await getChangeRequestReview(as(actors.head), {
      departmentId: DEMO_ICU.id,
      requestId: id,
    });
    expect(review.preview).toMatchObject({
      ok: false,
      error: { code: "INVALID_STATE", reason: "CHANGE_WHILE_SUBMITTED" },
    });
  });
});

describe("approved schedules: revisions and versions", () => {
  beforeEach(toApproved);

  it("17. an APPROVED schedule cannot be edited directly", async () => {
    expect(
      failure(
        await setAssignments(as(actors.head), {
          scheduleId: S,
          expectedRevision: await revision(),
          changes: [
            { nurseId: U.icuNurse1.id, date: "2026-10-25", shift: "E" },
          ],
        }),
      ),
    ).toMatchObject({ code: "INVALID_STATE", reason: "EDIT_ASSIGNMENT" });
  });

  it("18–20. a request on an approved schedule goes into a revision; v1 stays unchanged; the re-approved v2 becomes current", async () => {
    const [v1] = await listVersions(db, S);
    const v1Cells = await listVersionAssignments(db, v1!.id);

    const { id } = ok(await unavailable());
    expect((await findChangeRequest(db, id))!.versionId).toBe(v1!.id);
    const result = ok(await apply(id));
    expect(result).toMatchObject({
      mode: "START_REVISION",
      status: "REVISING",
    });
    const open = (await findOpenRevision(db, S))!;
    expect(open).toMatchObject({
      id: result.revisionId,
      dates: ["2026-10-25"],
    });
    expect(
      (await listScheduleChanges(db, { scheduleId: S }))[0]!.revisionId,
    ).toBe(open.id);
    expect(await cell(U.icuNurse1.id, "2026-10-25")).toBe("OFF");
    // 19. The approved version is untouched and still current until re-approval.
    expect(await listVersionAssignments(db, v1!.id)).toEqual(v1Cells);
    expect((await schedule()).currentVersionId).toBe(v1!.id);
    expect(await auditActions()).toContain("revision.started");

    // The revision goes through the normal review flow.
    await lifecycle(submitSchedule, actors.head);
    await lifecycle(approveSchedule, actors.supervisor);
    const versions = await listVersions(db, S);
    expect(versions.map((v) => v.versionNo)).toEqual([1, 2]);
    const s = await schedule();
    expect(s).toMatchObject({
      status: "APPROVED",
      currentVersionId: versions[1]!.id,
    });
    expect(await findOpenRevision(db, S)).toBeNull();
    expect(await listVersionAssignments(db, v1!.id)).toEqual(v1Cells);
    expect(
      (await listVersionAssignments(db, versions[1]!.id)).find(
        (a) => a.nurseId === U.icuNurse1.id && a.date === "2026-10-25",
      ),
    ).toMatchObject({ shift: "OFF" });
    // 20. Explicit rest remains a requestable decision (including SWAP).
    const options = await getChangeRequestOptions(as(actors.nurse1));
    expect(options.schedules[0]!.assignments.map((a) => a.date)).toContain(
      "2026-10-25",
    );
  });

  it("a second change extends the open revision by its day", async () => {
    ok(await apply(ok(await unavailable()).id));
    const { id } = ok(
      await request(actors.nurse1, {
        type: "CHANGE_SHIFT",
        date: "2026-10-28",
        targetShift: "E",
      }),
    );
    const result = ok(await apply(id));
    expect(result.mode).toBe("EXTEND_REVISION");
    expect((await findOpenRevision(db, S))!.dates).toEqual([
      "2026-10-25",
      "2026-10-28",
    ]);
    expect(await auditActions()).toContain("revision.scopeExtended");
  });

  it("discarding the revision restores the approved version and keeps the revision as history", async () => {
    const [v1] = await listVersions(db, S);
    const v1Cells = await listVersionAssignments(db, v1!.id);
    const { id } = ok(await unavailable());
    const { revisionId } = ok(await apply(id));

    expect(
      failure(
        await discardRevision(as(actors.nurse1), {
          scheduleId: S,
          expectedRevision: await revision(),
        }),
      ).code,
    ).toBe("FORBIDDEN");
    const discarded = ok(
      await discardRevision(as(actors.head), {
        scheduleId: S,
        expectedRevision: await revision(),
      }),
    );
    expect(discarded).toMatchObject({ status: "APPROVED", revisionId });
    expect(await listAssignments(db, S)).toEqual(
      expect.arrayContaining(v1Cells.map((a) => expect.objectContaining(a))),
    );
    expect((await listAssignments(db, S)).length).toBe(v1Cells.length);
    expect(await findOpenRevision(db, S)).toBeNull();
    const { rows } = await db.execute<{ status: string }>(
      sql`select status from schedule_revisions where id = ${revisionId}`,
    );
    expect(rows).toEqual([{ status: "DISCARDED" }]);
    expect(await auditActions()).toContain("revision.discarded");
    // The request's own history is unchanged.
    expect((await findChangeRequest(db, id))!.status).toBe("APPLIED");
  });

  it("22. a Head Nurse adjustment needs a reason, is validated, goes into a revision and is audited", async () => {
    const adjust = async (extra: Record<string, unknown>) =>
      adjustSchedule(as(actors.head), {
        scheduleId: S,
        expectedRevision: await revision(),
        changes: [{ nurseId: U.icuNurse3.id, date: "2026-10-26", shift: "M" }],
        ...extra,
      });
    expect(failure(await adjust({})).code).toBe("VALIDATION");
    expect(
      failure(await adjust({ reasonCode: "OTHER" })).fieldErrors,
    ).toHaveProperty("note");
    expect(
      failure(await adjust({ reasonCode: "PERSONAL_MATTER" })).fieldErrors,
    ).toHaveProperty("reasonCode");
    expect(
      failure(
        await adjustSchedule(as(actors.nurse1), {
          scheduleId: S,
          expectedRevision: await revision(),
          changes: [
            { nurseId: U.icuNurse1.id, date: "2026-10-26", shift: "M" },
          ],
          reasonCode: "STAFFING_NEED",
        }),
      ).code,
    ).toBe("FORBIDDEN");

    const result = ok(
      await adjust({ reasonCode: "STAFFING_NEED", note: "کمبود نیرو" }),
    );
    expect(result).toMatchObject({
      mode: "START_REVISION",
      status: "REVISING",
    });
    const [change] = await listScheduleChanges(db, { scheduleId: S });
    expect(change).toMatchObject({
      kind: "ADJUSTMENT",
      requestId: null,
      reasonCode: "STAFFING_NEED",
      note: "کمبود نیرو",
      revisionId: result.revisionId,
      cells: [
        {
          nurseId: U.icuNurse3.id,
          date: "2026-10-26",
          before: "OFF",
          after: "M",
        },
      ],
    });
    const event = (await listAuditEventsForSchedule(db, S)).find(
      (e) => e.action === "schedule.adjusted",
    );
    expect(event).toMatchObject({
      actorId: U.icuHead.id,
      reason: "STAFFING_NEED",
      data: { changeId: result.changeId, note: "کمبود نیرو" },
    });

    // A hard violation blocks an adjustment too (N on 27 Oct before nurse1's M on 28 Oct).
    expect(
      failure(
        await adjustSchedule(as(actors.head), {
          scheduleId: S,
          expectedRevision: await revision(),
          changes: [
            { nurseId: U.icuNurse1.id, date: "2026-10-27", shift: "N" },
          ],
          reasonCode: "STAFFING_NEED",
        }),
      ).code,
    ).toBe("RULE_VIOLATION");
  });

  it("previews an adjustment without writing anything", async () => {
    const before = await revision();
    const preview = await previewScheduleAdjustment(as(actors.head), {
      scheduleId: S,
      changes: [{ nurseId: U.icuNurse1.id, date: d("2026-10-27"), shift: "N" }],
    });
    expect(preview).toMatchObject({
      ok: true,
      evaluation: {
        target: { mode: "START_REVISION" },
        assessment: { blocked: true, blocking: [{ rule: "NIGHT_REST" }] },
      },
    });
    expect(await revision()).toBe(before);
    await expect(
      previewScheduleAdjustment(as(actors.erHead), {
        scheduleId: S,
        changes: [],
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("visibility and scope", () => {
  beforeEach(toFinalized);

  it("23. a nurse sees only their own requests and the swaps that name them", async () => {
    const { id: own } = ok(await unavailable(actors.nurse1, "2026-10-27"));
    const { id: swapId } = ok(await swap());
    const { id: nurse2Own } = ok(await unavailable(actors.nurse2));

    const ids = async (actor: Actor) =>
      (await getMyChangeRequests(as(actor))).map((r) => [r.id, r.role]);
    expect((await ids(actors.nurse1)).sort()).toEqual(
      [
        [own, "REQUESTER"],
        [swapId, "REQUESTER"],
      ].sort(),
    );
    expect((await ids(actors.nurse2)).sort()).toEqual(
      [
        [swapId, "COUNTERPART"],
        [nurse2Own, "REQUESTER"],
      ].sort(),
    );
    expect(await ids(actors.nurse3)).toEqual([]);
    const partnerView = (await getMyChangeRequests(as(actors.nurse2))).find(
      (r) => r.id === swapId,
    )!;
    expect(partnerView).toMatchObject({
      canRespond: true,
      canCancel: false,
      consent: "PENDING",
    });
  });

  it("24/21. a Head Nurse sees and decides only their department's requests", async () => {
    const { id } = ok(await unavailable());
    const queue = await getChangeRequestQueue(as(actors.head), {
      departmentId: DEMO_ICU.id,
    });
    expect(queue.items.map((r) => r.id)).toEqual([id]);
    expect(queue.items[0]).toMatchObject({
      requester: { displayName: U.icuNurse1.displayName },
      reason: { code: "ILLNESS", label: "بیماری" },
      requesterShift: "M",
    });
    expect(queue.counts).toEqual({
      PENDING: 1,
      CANCELLED: 0,
      REJECTED: 0,
      APPLIED: 0,
    });
    expect(
      (
        await getChangeRequestQueue(as(actors.erHead), {
          departmentId: DEMO_ER.id,
        })
      ).items,
    ).toEqual([]);

    // Another department's Head Nurse, a Supervisor and a nurse are refused.
    await expect(
      getChangeRequestQueue(as(actors.erHead), { departmentId: DEMO_ICU.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      getChangeRequestQueue(as(actors.supervisor), {
        departmentId: DEMO_ICU.id,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      getChangeRequestReview(as(actors.erHead), {
        departmentId: DEMO_ER.id,
        requestId: id,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    for (const actor of [actors.erHead, actors.supervisor]) {
      expect(
        failure(
          await applyChangeRequest(as(actor), {
            requestId: id,
            expectedRevision: await revision(),
          }),
        ).code,
      ).toBe("FORBIDDEN");
      expect(
        failure(await rejectChangeRequest(as(actor), { requestId: id })).code,
      ).toBe("FORBIDDEN");
    }
  });

  it("filters the queue by status and keeps closed requests", async () => {
    const { id: a } = ok(await unavailable());
    const { id: b } = ok(await unavailable(actors.nurse1, "2026-10-27"));
    ok(await cancelChangeRequest(as(actors.nurse1), { requestId: a }));
    ok(await apply(b));
    const queue = (status: "PENDING" | "CANCELLED" | "APPLIED") =>
      getChangeRequestQueue(as(actors.head), {
        departmentId: DEMO_ICU.id,
        status,
      });
    expect((await queue("PENDING")).items).toEqual([]);
    expect((await queue("CANCELLED")).items.map((r) => r.id)).toEqual([a]);
    expect((await queue("APPLIED")).items.map((r) => r.id)).toEqual([b]);
  });

  it("offers the nurse their own future assignments, swap candidates and request reasons", async () => {
    ok(await unavailable());
    const options = await getChangeRequestOptions(
      as(actors.nurse1, new Date("2026-10-26T06:00:00Z")),
    );
    const [s] = options.schedules;
    expect(s!.assignments.filter((a) => a.shift !== "OFF")).toEqual([
      { date: "2026-10-27", shift: "E", hasActiveRequest: false },
      { date: "2026-10-28", shift: "M", hasActiveRequest: false },
    ]);
    expect(
      s!.swapCandidates[d("2026-10-27") as IsoDate]!.map((c) => c.shift),
    ).not.toContain("E");
    expect(options.reasons.map((r) => r.code)).toEqual([
      "ILLNESS",
      "FAMILY_EMERGENCY",
      "PERSONAL_MATTER",
      "EDUCATION",
      "OTHER",
    ]);
    expect(options.reasons.find((r) => r.code === "OTHER")!.requiresNote).toBe(
      true,
    );
    // Before finalization there is nothing to request.
    await db.execute(
      sql`update schedules set status = 'PLANNING' where id = ${S}`,
    );
    expect(
      (await getChangeRequestOptions(as(actors.nurse1))).schedules,
    ).toEqual([]);
  });
});

describe("Head Nurse queue and review (Slice D)", () => {
  it("rows carry the live shift of pending requests; the detail adds context and candidates", async () => {
    await toFinalized();
    const { id } = ok(await unavailable());
    await assign(U.icuNurse1.id, "2026-10-25", "E"); // changed since the request
    const queue = await getChangeRequestQueue(as(actors.head), {
      departmentId: DEMO_ICU.id,
    });
    expect(queue.items[0]).toMatchObject({
      id,
      requesterShift: "M",
      current: { requester: "E", counterpart: null },
      applied: null,
    });

    const review = await getChangeRequestReview(as(actors.head), {
      departmentId: DEMO_ICU.id,
      requestId: id,
    });
    expect(review.schedule).toMatchObject({
      label: DEMO_SCHEDULE.label,
      status: "FINALIZED",
      hasApprovedVersion: false,
      currentVersionNo: null,
      openRevisionDates: null,
    });
    expect(review.stale).toMatchObject({ requestedAgainst: "M", current: "E" });
    // Off that day: everyone rostered but nurse1 (the requester) and nurse2 (E).
    expect(review.replacementCandidates.map((p) => p.userId).sort()).toEqual(
      [U.icuNurse3.id, U.transferNurse.id].sort(),
    );
    expect(review.previewView).toMatchObject({
      ok: true,
      mode: "WORKING_COPY",
      blocked: false,
      cells: [
        {
          nurseId: U.icuNurse1.id,
          displayName: U.icuNurse1.displayName,
          before: "E",
          after: "OFF",
        },
      ],
    });
  });

  it("names the blocking findings of a preview for the screens", async () => {
    await toFinalized();
    const { id } = ok(
      await request(actors.nurse1, {
        type: "CHANGE_SHIFT",
        date: "2026-10-27",
        targetShift: "N",
      }),
    );
    const review = await getChangeRequestReview(as(actors.head), {
      departmentId: DEMO_ICU.id,
      requestId: id,
    });
    expect(review.blocker).toBeNull();
    expect(review.previewView).toMatchObject({
      ok: true,
      blocked: true,
      blocking: [
        {
          code: "NIGHT_REST",
          blocking: true,
          nurses: [{ displayName: U.icuNurse1.displayName }],
        },
      ],
    });
  });

  it("shows a changed swap even before consent", async () => {
    await toFinalized();
    const { id } = ok(await swap());
    await assign(U.icuNurse2.id, "2026-10-25", "N");
    const review = await getChangeRequestReview(as(actors.head), {
      departmentId: DEMO_ICU.id,
      requestId: id,
    });
    expect(review.swapContextChanged).toBe(true);
    expect(review.blocker).toMatchObject({
      reason: "APPLY_SWAP_WITHOUT_CONSENT",
    });
  });

  it("tells what became of an applied change: pending revision, approved, discarded", async () => {
    await toApproved();
    const stateOf = async (id: string) =>
      (
        await getChangeRequestQueue(as(actors.head), {
          departmentId: DEMO_ICU.id,
          status: "APPLIED",
        })
      ).items.find((r) => r.id === id)!.applied;

    const { id: first } = ok(await unavailable());
    ok(await apply(first));
    expect(await stateOf(first)).toMatchObject({ state: "PENDING_REVISION" });
    // Discarding the revision keeps the request APPLIED, but says so.
    ok(
      await discardRevision(as(actors.head), {
        scheduleId: S,
        expectedRevision: await revision(),
      }),
    );
    expect((await findChangeRequest(db, first))!.status).toBe("APPLIED");
    expect(await stateOf(first)).toMatchObject({ state: "DISCARDED" });
    const review = await getChangeRequestReview(as(actors.head), {
      departmentId: DEMO_ICU.id,
      requestId: first,
    });
    expect(review.appliedChange).toMatchObject({
      state: "DISCARDED",
      cells: [{ nurseId: U.icuNurse1.id, before: "M", after: "OFF" }],
    });
    // The nurse's own view says the same.
    const [mine] = await getMyChangeRequests(as(actors.nurse1));
    expect(mine!.applied?.state).toBe("DISCARDED");

    const { id: second } = ok(
      await request(actors.nurse1, {
        type: "CHANGE_SHIFT",
        date: "2026-10-28",
        targetShift: "E",
      }),
    );
    ok(await apply(second));
    await lifecycle(submitSchedule, actors.head);
    await lifecycle(approveSchedule, actors.supervisor);
    expect(await stateOf(second)).toMatchObject({ state: "APPROVED" });
    expect(await stateOf(first)).toMatchObject({ state: "DISCARDED" });
  });

  it("an applied change to a never-approved schedule waits for approval, then counts as approved", async () => {
    await toFinalized();
    const { id } = ok(await unavailable());
    ok(await apply(id));
    const [mine] = await getMyChangeRequests(as(actors.nurse1));
    expect(mine!.applied?.state).toBe("WORKING_COPY");
    await lifecycle(submitSchedule, actors.head);
    await lifecycle(approveSchedule, actors.supervisor);
    const [after] = await getMyChangeRequests(as(actors.nurse1));
    expect(after!.applied?.state).toBe("APPROVED");
  });

  it("rejecting is audited with actor and time and notifies the requester", async () => {
    await toFinalized();
    const { id } = ok(await unavailable());
    ok(
      await rejectChangeRequest(as(actors.head), {
        requestId: id,
        note: "  ",
      }),
    );
    const event = (await listAuditEventsForSchedule(db, S)).find(
      (e) => e.action === "changeRequest.rejected",
    )!;
    expect(event).toMatchObject({
      actorId: U.icuHead.id,
      entityId: id,
      data: { from: "PENDING", to: "REJECTED", note: null },
    });
    expect(event.occurredAt).toBeInstanceOf(Date);
    expect(await findChangeRequest(db, id)).toMatchObject({
      rejectedBy: U.icuHead.id,
      rejectedAt: NOW,
      rejectionNote: null,
    });
    const [n] = await listNotificationsForRecipient(db, U.icuNurse1.id);
    expect(n).toMatchObject({
      type: "CHANGE_REQUEST_REVIEWED",
      data: { outcome: "REJECTED", rejection: "HEAD_NURSE" },
    });
  });

  it("previews an adjustment for the screens (named cells, mode, blocking)", async () => {
    await toApproved();
    const view = await getAdjustmentPreview(as(actors.head), {
      scheduleId: S,
      changes: [{ nurseId: U.icuNurse3.id, date: d("2026-10-26"), shift: "M" }],
    });
    expect(view).toMatchObject({
      ok: true,
      mode: "START_REVISION",
      targetStatus: "REVISING",
      addedRevisionDates: ["2026-10-26"],
      cells: [
        { displayName: U.icuNurse3.displayName, before: "OFF", after: "M" },
      ],
      blocked: false,
    });
    // Open a revision with a real adjustment, submit it: now it is frozen.
    ok(
      await adjustSchedule(as(actors.head), {
        scheduleId: S,
        expectedRevision: await revision(),
        changes: [{ nurseId: U.icuNurse3.id, date: "2026-10-26", shift: "M" }],
        reasonCode: "STAFFING_NEED",
      }),
    );
    await lifecycle(submitSchedule, actors.head);
    expect(
      await getAdjustmentPreview(as(actors.head), {
        scheduleId: S,
        changes: [
          { nurseId: U.icuNurse3.id, date: d("2026-10-26"), shift: "M" },
        ],
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "INVALID_STATE", reason: "CHANGE_WHILE_SUBMITTED" },
    });
  });

  it("opens the queue page only for the department's Head Nurse", async () => {
    await expect(
      getDepartmentForPage(as(actors.head), "icu", "changeRequest.review"),
    ).resolves.toMatchObject({ id: DEMO_ICU.id });
    for (const actor of [actors.erHead, actors.supervisor, actors.nurse1])
      await expect(
        getDepartmentForPage(as(actor), "icu", "changeRequest.review"),
      ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("revision lifecycle end to end (Slice E)", () => {
  const revisionsOf = async () =>
    (
      await db.execute<{ id: string; status: string }>(
        sql`select id, status from schedule_revisions where schedule_id = ${S} order by started_at`,
      )
    ).rows;
  const openRevisions = async () =>
    (await revisionsOf()).filter((r) => r.status === "OPEN").length;
  const counts = async () => {
    const { rows } = await db.execute<{
      requests: number;
      changes: number;
      cells: number;
      audit: number;
      versions: number;
    }>(sql`select
      (select count(*)::int from shift_change_requests) as requests,
      (select count(*)::int from schedule_changes) as changes,
      (select count(*)::int from schedule_change_cells) as cells,
      (select count(*)::int from audit_events) as audit,
      (select count(*)::int from schedule_versions) as versions`);
    return rows[0]!;
  };
  const cellAt = (
    cells: readonly { nurseId: string; date: string; shift: string }[],
    nurseId: string,
    date: string,
  ) =>
    cells.find((a) => a.nurseId === nurseId && a.date === date)?.shift ?? null;

  beforeEach(toApproved);

  it("v1 → request → apply (revision) → submit → approve → v2 is current; v1 unchanged; history kept", async () => {
    const [v1] = await listVersions(db, S);
    const v1Cells = await listVersionAssignments(db, v1!.id);

    const { id } = ok(
      await request(actors.nurse1, {
        type: "CHANGE_SHIFT",
        date: "2026-10-28",
        targetShift: "E",
      }),
    );
    const applied = ok(await apply(id));
    expect(applied).toMatchObject({
      mode: "START_REVISION",
      status: "REVISING",
    });
    expect((await findOpenRevision(db, S))!.dates).toEqual(["2026-10-28"]);
    expect(await cell(U.icuNurse1.id, "2026-10-28")).toBe("E");
    expect((await findChangeRequest(db, id))!.status).toBe("APPLIED");
    expect(await openRevisions()).toBe(1);

    await lifecycle(submitSchedule, actors.head);
    await lifecycle(approveSchedule, actors.supervisor);

    const versions = await listVersions(db, S);
    expect(versions.map((v) => v.versionNo)).toEqual([1, 2]);
    expect((await schedule()).currentVersionId).toBe(versions[1]!.id);
    expect(await revisionsOf()).toEqual([
      { id: applied.revisionId, status: "APPROVED" },
    ]);
    expect(await listVersionAssignments(db, v1!.id)).toEqual(v1Cells);
    const v2Cells = await listVersionAssignments(db, versions[1]!.id);
    expect(cellAt(v1Cells, U.icuNurse1.id, "2026-10-28")).toBe("M");
    expect(cellAt(v2Cells, U.icuNurse1.id, "2026-10-28")).toBe("E");
    // The request and its change are history, unchanged by the approval.
    expect((await findChangeRequest(db, id))!.status).toBe("APPLIED");
    const [change] = await listScheduleChanges(db, { requestIds: [id] });
    expect(change).toMatchObject({
      kind: "REQUEST",
      requestId: id,
      revisionId: applied.revisionId,
      reasonCode: "ILLNESS",
      appliedBy: U.icuHead.id,
      cells: [
        {
          nurseId: U.icuNurse1.id,
          date: "2026-10-28",
          before: "M",
          after: "E",
        },
      ],
    });
    const events = await listAuditEventsForSchedule(db, S);
    expect(events.find((e) => e.action === "revision.approved")).toMatchObject({
      actorId: U.supervisor.id,
      entityId: applied.revisionId,
      data: { versionNo: 2, dates: ["2026-10-28"] },
    });
  });

  it("scope: a second day extends it, the same day is not added twice, one revision stays open", async () => {
    ok(await apply(ok(await unavailable()).id)); // 25 Oct (nurse1 M)
    ok(await apply(ok(await unavailable(actors.nurse2)).id)); // 25 Oct again (nurse2 E)
    expect((await findOpenRevision(db, S))!.dates).toEqual(["2026-10-25"]);
    ok(
      await apply(
        ok(
          await request(actors.nurse1, {
            type: "CHANGE_SHIFT",
            date: "2026-10-28",
            targetShift: "E",
          }),
        ).id,
      ),
    );
    expect((await findOpenRevision(db, S))!.dates).toEqual([
      "2026-10-25",
      "2026-10-28",
    ]);
    expect(await openRevisions()).toBe(1);
    const actions = await auditActions();
    expect(actions.filter((a) => a === "revision.started")).toHaveLength(1);
    expect(actions.filter((a) => a === "revision.scopeExtended")).toHaveLength(
      1,
    );
    const { rows } = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from schedule_revision_dates d join schedule_revisions r on r.id = d.revision_id where r.schedule_id = ${S}`,
    );
    expect(rows[0]!.n).toBe(2);
  });

  it("a returned revision keeps its revision: changes extend it, resubmission approves it", async () => {
    const first = ok(await apply(ok(await unavailable()).id));
    await lifecycle(submitSchedule, actors.head);
    ok(
      await returnSchedule(as(actors.supervisor), {
        scheduleId: S,
        expectedRevision: await revision(),
        comment: "شیفت ۶ آبان را هم بررسی کنید",
      }),
    );
    expect((await schedule()).status).toBe("RETURNED");
    const second = ok(
      await apply(
        ok(
          await request(actors.nurse1, {
            type: "CHANGE_SHIFT",
            date: "2026-10-28",
            targetShift: "E",
          }),
        ).id,
      ),
    );
    expect(second).toMatchObject({
      mode: "EXTEND_REVISION",
      status: "RETURNED",
      revisionId: first.revisionId,
    });
    expect(await openRevisions()).toBe(1);
    await lifecycle(submitSchedule, actors.head);
    await lifecycle(approveSchedule, actors.supervisor);
    expect(await revisionsOf()).toEqual([
      { id: first.revisionId, status: "APPROVED" },
    ]);
    expect((await listVersions(db, S)).map((v) => v.versionNo)).toEqual([1, 2]);
  });

  it("discard: working copy restored, v1 stays current, history kept, requesters told", async () => {
    const [v1] = await listVersions(db, S);
    const v1Cells = await listVersionAssignments(db, v1!.id);
    const { id } = ok(await swap());
    ok(
      await respondToSwapRequest(as(actors.nurse2), {
        requestId: id,
        accept: true,
      }),
    );
    const applied = ok(await apply(id));
    ok(
      await adjustSchedule(as(actors.head), {
        scheduleId: S,
        expectedRevision: await revision(),
        changes: [{ nurseId: U.icuNurse3.id, date: "2026-10-26", shift: "M" }],
        reasonCode: "STAFFING_NEED",
      }),
    );
    const before = await counts();

    ok(
      await discardRevision(as(actors.head), {
        scheduleId: S,
        expectedRevision: await revision(),
      }),
    );
    const s = await schedule();
    expect(s).toMatchObject({ status: "APPROVED", currentVersionId: v1!.id });
    const working = await listAssignments(db, S);
    expect(working.length).toBe(v1Cells.length);
    expect(working).toEqual(
      expect.arrayContaining(v1Cells.map((a) => expect.objectContaining(a))),
    );
    expect(await listVersionAssignments(db, v1!.id)).toEqual(v1Cells);
    expect(await revisionsOf()).toEqual([
      { id: applied.revisionId, status: "DISCARDED" },
    ]);
    // Nothing historical was deleted: requests, changes and cells all remain.
    const after = await counts();
    expect(after).toMatchObject({
      requests: before.requests,
      changes: before.changes,
      cells: before.cells,
      versions: before.versions,
    });
    expect(after.audit).toBeGreaterThan(before.audit);
    expect((await findChangeRequest(db, id))!.status).toBe("APPLIED");
    const event = (await listAuditEventsForSchedule(db, S)).find(
      (e) => e.action === "revision.discarded",
    );
    expect(event).toMatchObject({
      actorId: U.icuHead.id,
      data: { revisionId: applied.revisionId, appliedRequestIds: [id] },
    });
    // Both nurses of the applied swap are told it is no longer executable.
    for (const nurse of [U.icuNurse1.id, U.icuNurse2.id]) {
      const [latest] = await listNotificationsForRecipient(db, nurse);
      expect(latest).toMatchObject({
        type: "CHANGE_REQUEST_REVIEWED",
        data: { outcome: "REVISION_DISCARDED" },
      });
    }
  });

  it("a direct adjustment goes through the same revision path to v2", async () => {
    const [v1] = await listVersions(db, S);
    const result = ok(
      await adjustSchedule(as(actors.head), {
        scheduleId: S,
        expectedRevision: await revision(),
        changes: [{ nurseId: U.icuNurse3.id, date: "2026-10-26", shift: "M" }],
        reasonCode: "OTHER",
        note: "پوشش جلسه آموزشی",
      }),
    );
    expect(result).toMatchObject({
      mode: "START_REVISION",
      status: "REVISING",
    });
    await lifecycle(submitSchedule, actors.head);
    await lifecycle(approveSchedule, actors.supervisor);
    const versions = await listVersions(db, S);
    expect((await schedule()).currentVersionId).toBe(versions[1]!.id);
    expect(
      cellAt(
        await listVersionAssignments(db, versions[1]!.id),
        U.icuNurse3.id,
        "2026-10-26",
      ),
    ).toBe("M");
    expect(
      cellAt(
        await listVersionAssignments(db, v1!.id),
        U.icuNurse3.id,
        "2026-10-26",
      ),
    ).toBe("OFF");
    const [change] = await listScheduleChanges(db, { scheduleId: S });
    expect(change).toMatchObject({
      kind: "ADJUSTMENT",
      requestId: null,
      revisionId: result.revisionId,
      reasonCode: "OTHER",
      note: "پوشش جلسه آموزشی",
      appliedBy: U.icuHead.id,
    });
  });
});

describe("audit trail covers every Phase 9 fact", () => {
  it("records creation, cancellation, consent, decline, rejection, apply, adjustment and every revision step", async () => {
    await toApproved();
    ok(
      await cancelChangeRequest(as(actors.nurse1), {
        requestId: ok(await unavailable()).id,
      }),
    );
    const declined = ok(await swap()).id;
    ok(
      await respondToSwapRequest(as(actors.nurse2), {
        requestId: declined,
        accept: false,
      }),
    );
    const accepted = ok(await swap()).id;
    ok(
      await respondToSwapRequest(as(actors.nurse2), {
        requestId: accepted,
        accept: true,
      }),
    );
    ok(await apply(accepted)); // revision.started
    ok(
      await rejectChangeRequest(as(actors.head), {
        requestId: ok(await unavailable(actors.nurse1, "2026-10-28")).id,
      }),
    );
    ok(
      await adjustSchedule(as(actors.head), {
        scheduleId: S,
        expectedRevision: await revision(),
        changes: [{ nurseId: U.icuNurse3.id, date: "2026-10-26", shift: "M" }],
        reasonCode: "STAFFING_NEED",
      }),
    ); // revision.scopeExtended
    await lifecycle(submitSchedule, actors.head);
    await lifecycle(approveSchedule, actors.supervisor); // revision.approved
    ok(
      await adjustSchedule(as(actors.head), {
        scheduleId: S,
        expectedRevision: await revision(),
        changes: [{ nurseId: U.icuNurse3.id, date: "2026-10-27", shift: "E" }],
        reasonCode: "STAFFING_NEED",
      }),
    );
    ok(
      await discardRevision(as(actors.head), {
        scheduleId: S,
        expectedRevision: await revision(),
      }),
    );

    const actions = new Set(await auditActions());
    for (const action of [
      "changeRequest.created",
      "changeRequest.cancelled",
      "changeRequest.swapAccepted",
      "changeRequest.swapDeclined",
      "changeRequest.rejected",
      "changeRequest.applied",
      "schedule.adjusted",
      "revision.started",
      "revision.scopeExtended",
      "revision.approved",
      "revision.discarded",
      "assignment.changed",
    ])
      expect(actions, action).toContain(action);
  });
});
