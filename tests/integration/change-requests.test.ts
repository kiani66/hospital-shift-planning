import { describe, expect, it } from "vitest";

import { decide } from "../../src/domain/authz/policies";
import { isoDate } from "../../src/domain/shared/dates";
import {
  DEMO_ICU,
  DEMO_SCHEDULE,
  DEMO_USERS,
} from "../../src/infrastructure/db/seed/demo-data";
import {
  listAssignments,
  setAssignment,
} from "../../src/infrastructure/repositories/assignments";
import {
  createChangeRequest,
  findChangeRequest,
  listChangeRequestsForRequester,
  listChangeRequestsForSchedule,
  updateChangeRequestStatus,
} from "../../src/infrastructure/repositories/change-requests";
import {
  endMembership,
  loadActor,
} from "../../src/infrastructure/repositories/memberships";
import { setupTestDatabase } from "./support/database";

const { db } = setupTestDatabase();
const U = DEMO_USERS;
const S = DEMO_SCHEDULE.id;
const now = new Date("2026-11-10T09:00:00Z");

async function requestSwap() {
  return createChangeRequest(db, {
    scheduleId: S,
    requesterId: U.icuNurse1.id,
    counterpartUserId: U.icuNurse2.id,
    reason: "Coordinated with Zahra",
    items: [
      { date: isoDate("2026-11-19"), currentShift: "M", desiredShift: null },
      { date: isoDate("2026-11-20"), currentShift: null, desiredShift: "M" },
    ],
  });
}

describe("shift change requests", () => {
  it("stores a request with its items", async () => {
    const id = await requestSwap();
    expect(await findChangeRequest(db, id)).toMatchObject({
      id,
      scheduleId: S,
      departmentId: DEMO_ICU.id,
      requesterId: U.icuNurse1.id,
      counterpartUserId: U.icuNurse2.id,
      status: "PENDING",
      items: [
        { date: "2026-11-19", currentShift: "M", desiredShift: null },
        { date: "2026-11-20", currentShift: null, desiredShift: "M" },
      ],
    });
  });

  it("submitting and reviewing never change assignments (no automatic swap)", async () => {
    await setAssignment(db, {
      scheduleId: S,
      userId: U.icuNurse1.id,
      date: isoDate("2026-11-19"),
      shift: "M",
      updatedBy: U.icuHead.id,
    });
    const before = await listAssignments(db, S);

    const id = await requestSwap();
    await updateChangeRequestStatus(db, {
      id,
      status: "ACKNOWLEDGED",
      reviewedBy: U.icuHead.id,
      reviewNote: "Will handle",
      now,
    });
    await updateChangeRequestStatus(db, { id, status: "RESOLVED", now });

    expect(await listAssignments(db, S)).toEqual(before);
    expect(await findChangeRequest(db, id)).toMatchObject({
      status: "RESOLVED",
      reviewedBy: U.icuHead.id,
      reviewNote: "Will handle",
    });
  });

  it("lists by schedule and by requester", async () => {
    const id = await requestSwap();
    expect(
      (await listChangeRequestsForSchedule(db, S)).map((r) => r.id),
    ).toEqual([id]);
    expect(
      (await listChangeRequestsForRequester(db, U.icuNurse1.id)).map(
        (r) => r.id,
      ),
    ).toEqual([id]);
    expect(await listChangeRequestsForRequester(db, U.icuNurse3.id)).toEqual(
      [],
    );
  });

  it("keeps a former member's own requests readable (D16)", async () => {
    const id = await requestSwap();
    await endMembership(db, {
      userId: U.icuNurse1.id,
      departmentId: DEMO_ICU.id,
      endedOn: isoDate("2026-11-30"),
    });

    const [request] = await listChangeRequestsForRequester(db, U.icuNurse1.id);
    expect(request?.id).toBe(id);
    // The day after the last day of membership.
    const actor = (await loadActor(db, U.icuNurse1.id, isoDate("2026-12-01")))!;
    const resource = {
      departmentId: request!.departmentId,
      requesterId: request!.requesterId,
    };
    expect(decide(actor, "changeRequest.view", resource).allowed).toBe(true);
    expect(decide(actor, "changeRequest.cancel", resource).allowed).toBe(false);
  });

  it("rejects requests from nurses who are not on the roster", async () => {
    await expect(
      createChangeRequest(db, {
        scheduleId: S,
        requesterId: U.erNurse1.id,
        reason: "x",
        items: [
          {
            date: isoDate("2026-11-19"),
            currentShift: null,
            desiredShift: null,
          },
        ],
      }),
    ).rejects.toThrow();
  });

  it("rejects naming yourself as the counterpart", async () => {
    await expect(
      createChangeRequest(db, {
        scheduleId: S,
        requesterId: U.icuNurse1.id,
        counterpartUserId: U.icuNurse1.id,
        reason: "x",
        items: [
          {
            date: isoDate("2026-11-19"),
            currentShift: null,
            desiredShift: null,
          },
        ],
      }),
    ).rejects.toThrow();
  });

  it("returns null for an unknown request and false for an unknown update", async () => {
    const unknown = "99999999-0000-4000-8000-000000000000";
    expect(await findChangeRequest(db, unknown)).toBeNull();
    expect(
      await updateChangeRequestStatus(db, {
        id: unknown,
        status: "DECLINED",
        now,
      }),
    ).toBe(false);
  });
});
