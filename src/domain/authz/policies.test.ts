import { describe, expect, it } from "vitest";

import { ForbiddenError } from "../shared/errors";
import type { ScheduleStatus } from "../schedule/status";
import { isHeadNurseOf, isMemberOf, isSupervisorOf, type Actor } from "./actor";
import {
  authorize,
  decide,
  type Action,
  type ActionResources,
} from "./policies";

const DEPT = "icu";

const actors = {
  nurse: {
    userId: "nurse",
    isActive: true,
    memberships: [{ departmentId: DEPT, role: "NURSE" }],
    supervisedDepartmentIds: [],
  },
  headNurse: {
    userId: "head",
    isActive: true,
    memberships: [{ departmentId: DEPT, role: "HEAD_NURSE" }],
    supervisedDepartmentIds: [],
  },
  otherHeadNurse: {
    userId: "head-er",
    isActive: true,
    memberships: [{ departmentId: "er", role: "HEAD_NURSE" }],
    supervisedDepartmentIds: [],
  },
  otherNurse: {
    userId: "nurse-er",
    isActive: true,
    memberships: [{ departmentId: "er", role: "NURSE" }],
    supervisedDepartmentIds: [],
  },
  supervisor: {
    userId: "sup",
    isActive: true,
    memberships: [],
    supervisedDepartmentIds: ["er", DEPT],
  },
  otherSupervisor: {
    userId: "sup-er",
    isActive: true,
    memberships: [],
    supervisedDepartmentIds: ["er"],
  },
  inactiveHeadNurse: {
    userId: "head-old",
    isActive: false,
    memberships: [{ departmentId: DEPT, role: "HEAD_NURSE" }],
    supervisedDepartmentIds: [DEPT],
  },
} satisfies Record<string, Actor>;

type ActorName = keyof typeof actors;
const ACTOR_NAMES = Object.keys(actors) as ActorName[];

const HEAD_NURSE_ONLY = [
  "department.manage",
  "schedule.create",
  "schedule.openPreferences",
  "schedule.closePreferences",
  "schedule.startPlanning",
  "schedule.editRoster",
  "schedule.reopenPreferences",
  "schedule.finalize",
  "schedule.submit",
  "schedule.withdraw",
  "schedule.startRevision",
  "schedule.discardRevision",
  "assignment.edit",
  "assignment.prefill",
  "changeRequest.review",
  "changeRequest.apply",
  "schedule.adjust",
] as const satisfies readonly Action[];

describe("authorization matrix", () => {
  describe.each(HEAD_NURSE_ONLY)("%s", (action) => {
    it.each(ACTOR_NAMES)("%s", (name) => {
      const expected = name === "headNurse";
      const decision = decide(actors[name], action, { departmentId: DEPT });
      expect(decision.allowed).toBe(expected);
    });
  });

  // [action, resource, actors allowed]
  const RESOURCE_RULES: [
    Action,
    (actor: Actor) => ActionResources[Action],
    ActorName[],
  ][] = [
    [
      "schedule.viewOwn",
      () => ({ departmentId: DEPT, onRoster: false }),
      ["nurse", "headNurse"],
    ],
    [
      "schedule.viewOwn",
      () => ({ departmentId: DEPT, onRoster: true }),
      [
        "nurse",
        "headNurse",
        "otherHeadNurse",
        "otherNurse",
        "supervisor",
        "otherSupervisor",
      ],
    ],
    [
      "preference.editOwn",
      () => ({ departmentId: DEPT }),
      ["nurse", "headNurse"],
    ],
    ["audit.view", () => ({ departmentId: DEPT }), ["headNurse", "supervisor"]],
    [
      "schedule.viewDepartment",
      () => ({ departmentId: DEPT, status: "SUBMITTED" }),
      ["headNurse", "supervisor"],
    ],
    [
      "schedule.approve",
      () => ({ departmentId: DEPT, submittedBy: "head" }),
      ["supervisor"],
    ],
    [
      "schedule.return",
      () => ({ departmentId: DEPT, submittedBy: "head" }),
      ["supervisor"],
    ],
    [
      "changeRequest.submit",
      () => ({ departmentId: DEPT, status: "APPROVED" }),
      ["nurse", "headNurse"],
    ],
    [
      "changeRequest.view",
      (actor) => ({ departmentId: DEPT, requesterId: actor.userId }),
      [
        "nurse",
        "headNurse",
        "otherHeadNurse",
        "otherNurse",
        "supervisor",
        "otherSupervisor",
      ],
    ],
    [
      "changeRequest.view",
      () => ({ departmentId: DEPT, requesterId: "someone-else" }),
      ["headNurse", "supervisor"],
    ],
    [
      "changeRequest.view",
      (actor) => ({
        departmentId: DEPT,
        requesterId: "someone-else",
        counterpartId: actor.userId,
      }),
      [
        "nurse",
        "headNurse",
        "otherHeadNurse",
        "otherNurse",
        "supervisor",
        "otherSupervisor",
      ],
    ],
    [
      "changeRequest.view",
      () => ({
        departmentId: DEPT,
        requesterId: "someone-else",
        counterpartId: null,
      }),
      ["headNurse", "supervisor"],
    ],
    [
      "changeRequest.consent",
      (actor) => ({ departmentId: DEPT, counterpartId: actor.userId }),
      ["nurse", "headNurse"],
    ],
    [
      "changeRequest.consent",
      () => ({ departmentId: DEPT, counterpartId: "someone-else" }),
      [],
    ],
    [
      "changeRequest.cancel",
      (actor) => ({ departmentId: DEPT, requesterId: actor.userId }),
      ["nurse", "headNurse"],
    ],
    [
      "changeRequest.cancel",
      () => ({ departmentId: DEPT, requesterId: "someone-else" }),
      [],
    ],
    [
      "notification.access",
      (actor) => ({ recipientId: actor.userId }),
      ACTOR_NAMES.filter((name) => actors[name].isActive),
    ],
    ["notification.access", () => ({ recipientId: "someone-else" }), []],
  ];

  describe.each(RESOURCE_RULES)("%s %#", (action, resource, allowed) => {
    it.each(ACTOR_NAMES)("%s", (name) => {
      const actor = actors[name];
      expect(decide(actor, action, resource(actor)).allowed).toBe(
        allowed.includes(name),
      );
    });
  });
});

describe("specific denials", () => {
  it("inactive actors are denied everything, whatever their roles", () => {
    expect(
      decide(actors.inactiveHeadNurse, "schedule.finalize", {
        departmentId: DEPT,
      }),
    ).toEqual({
      allowed: false,
      reason: "ACTOR_INACTIVE",
    });
    expect(
      decide(actors.inactiveHeadNurse, "schedule.approve", {
        departmentId: DEPT,
        submittedBy: "x",
      }),
    ).toEqual({ allowed: false, reason: "ACTOR_INACTIVE" });
  });

  it("a Head Nurse manages only their own department", () => {
    expect(
      decide(actors.otherHeadNurse, "assignment.edit", { departmentId: DEPT }),
    ).toEqual({
      allowed: false,
      reason: "NOT_HEAD_NURSE_OF_DEPARTMENT",
    });
    expect(
      decide(actors.otherHeadNurse, "assignment.edit", { departmentId: "er" })
        .allowed,
    ).toBe(true);
  });

  it.each(["schedule.approve", "schedule.return"] as const)(
    "%s: a supervisor cannot decide on their own submission",
    (action) => {
      const selfSubmitted = { departmentId: DEPT, submittedBy: "sup" };
      expect(decide(actors.supervisor, action, selfSubmitted)).toEqual({
        allowed: false,
        reason: "SELF_APPROVAL",
      });
    },
  );

  it("the Head Nurse cannot approve their own schedule", () => {
    expect(
      decide(actors.headNurse, "schedule.approve", {
        departmentId: DEPT,
        submittedBy: "head",
      }),
    ).toEqual({
      allowed: false,
      reason: "NOT_SUPERVISOR_OF_DEPARTMENT",
    });
  });

  it("a supervisor of another department cannot approve", () => {
    expect(
      decide(actors.otherSupervisor, "schedule.approve", {
        departmentId: DEPT,
        submittedBy: "head",
      }).allowed,
    ).toBe(false);
  });

  it.each<[ScheduleStatus, boolean]>([
    ["DRAFT", false],
    ["PLANNING", false],
    ["FINALIZED", true],
    ["SUBMITTED", true],
    ["RETURNED", true],
    ["APPROVED", true],
    ["REVISING", true],
  ])(
    "supervisors see the department grid from FINALIZED on (%s → %s)",
    (status, allowed) => {
      const decision = decide(actors.supervisor, "schedule.viewDepartment", {
        departmentId: DEPT,
        status,
      });
      expect(decision).toEqual(
        allowed
          ? { allowed: true }
          : { allowed: false, reason: "SCHEDULE_NOT_YET_FINALIZED" },
      );
      // The Head Nurse always sees it.
      expect(
        decide(actors.headNurse, "schedule.viewDepartment", {
          departmentId: DEPT,
          status,
        }).allowed,
      ).toBe(true);
    },
  );

  it("nurses never see the department grid", () => {
    expect(
      decide(actors.nurse, "schedule.viewDepartment", {
        departmentId: DEPT,
        status: "APPROVED",
      }),
    ).toEqual({
      allowed: false,
      reason: "NO_DEPARTMENT_ACCESS",
    });
  });

  it.each<[ScheduleStatus, boolean]>([
    ["DRAFT", false],
    ["PLANNING", false],
    ["FINALIZED", true],
    ["SUBMITTED", true],
    ["RETURNED", true],
    ["APPROVED", true],
    ["REVISING", true],
  ])(
    "change requests can be submitted from FINALIZED on (%s → %s)",
    (status, allowed) => {
      const decision = decide(actors.nurse, "changeRequest.submit", {
        departmentId: DEPT,
        status,
      });
      expect(decision).toEqual(
        allowed
          ? { allowed: true }
          : { allowed: false, reason: "SCHEDULE_NOT_YET_FINALIZED" },
      );
    },
  );

  it("change requests require department membership", () => {
    expect(
      decide(actors.otherNurse, "changeRequest.submit", {
        departmentId: DEPT,
        status: "APPROVED",
      }),
    ).toEqual({
      allowed: false,
      reason: "NOT_MEMBER_OF_DEPARTMENT",
    });
  });

  it("a nurse cannot view another nurse's change request", () => {
    expect(
      decide(actors.nurse, "changeRequest.view", {
        departmentId: DEPT,
        requesterId: "nurse-2",
      }),
    ).toEqual({
      allowed: false,
      reason: "NO_DEPARTMENT_ACCESS",
    });
  });

  it("own-data actions require membership", () => {
    expect(
      decide(actors.supervisor, "preference.editOwn", { departmentId: DEPT }),
    ).toEqual({
      allowed: false,
      reason: "NOT_MEMBER_OF_DEPARTMENT",
    });
  });

  it("audit is hidden from plain nurses", () => {
    expect(decide(actors.nurse, "audit.view", { departmentId: DEPT })).toEqual({
      allowed: false,
      reason: "NO_DEPARTMENT_ACCESS",
    });
  });
});

describe("notifications", () => {
  it("only the recipient may access a notification, whatever their roles", () => {
    expect(
      decide(actors.supervisor, "notification.access", {
        recipientId: "nurse",
      }),
    ).toEqual({ allowed: false, reason: "NOT_RECIPIENT" });
    expect(
      decide(actors.headNurse, "notification.access", { recipientId: "nurse" }),
    ).toEqual({ allowed: false, reason: "NOT_RECIPIENT" });
  });

  it("needs no current membership (former members keep their own)", () => {
    const former: Actor = {
      userId: "former",
      isActive: true,
      memberships: [],
      supervisedDepartmentIds: [],
    };
    expect(
      decide(former, "notification.access", { recipientId: "former" }).allowed,
    ).toBe(true);
  });

  it("a deactivated recipient is denied", () => {
    expect(
      decide(actors.inactiveHeadNurse, "notification.access", {
        recipientId: "head-old",
      }),
    ).toEqual({ allowed: false, reason: "ACTOR_INACTIVE" });
  });
});

describe("authorize", () => {
  it("returns ok when allowed", () => {
    expect(
      authorize(actors.headNurse, "schedule.finalize", { departmentId: DEPT }),
    ).toEqual({
      ok: true,
      value: undefined,
    });
  });

  it("returns a ForbiddenError carrying the reason when denied", () => {
    const result = authorize(actors.nurse, "schedule.finalize", {
      departmentId: DEPT,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(ForbiddenError);
      expect(result.error.reason).toBe("NOT_HEAD_NURSE_OF_DEPARTMENT");
    }
  });
});

describe("actor helpers", () => {
  it("a Head Nurse is also a member (nurse) of the department", () => {
    expect(isMemberOf(actors.headNurse, DEPT)).toBe(true);
    expect(isHeadNurseOf(actors.headNurse, DEPT)).toBe(true);
    expect(isHeadNurseOf(actors.nurse, DEPT)).toBe(false);
  });

  it("supervisors are not members unless they have a membership", () => {
    expect(isSupervisorOf(actors.supervisor, DEPT)).toBe(true);
    expect(isMemberOf(actors.supervisor, DEPT)).toBe(false);
  });
});

describe("historical access after leaving a department (D16)", () => {
  // Was a nurse in ICU; the membership has ended (now in ER).
  const former = actors.otherNurse;

  it("keeps read-only access to own change requests", () => {
    expect(
      decide(former, "changeRequest.view", {
        departmentId: DEPT,
        requesterId: former.userId,
      }),
    ).toEqual({ allowed: true });
  });

  it("cannot withdraw or otherwise change an old request", () => {
    expect(
      decide(former, "changeRequest.cancel", {
        departmentId: DEPT,
        requesterId: former.userId,
      }),
    ).toEqual({ allowed: false, reason: "NOT_MEMBER_OF_DEPARTMENT" });
  });

  it("cannot submit new requests", () => {
    expect(
      decide(former, "changeRequest.submit", {
        departmentId: DEPT,
        status: "APPROVED",
      }),
    ).toEqual({ allowed: false, reason: "NOT_MEMBER_OF_DEPARTMENT" });
  });

  it("keeps access to own shifts in schedules they were rostered on", () => {
    expect(
      decide(former, "schedule.viewOwn", {
        departmentId: DEPT,
        onRoster: true,
      }),
    ).toEqual({ allowed: true });
  });

  it("gets nothing for schedules they were never rostered on", () => {
    expect(
      decide(former, "schedule.viewOwn", {
        departmentId: DEPT,
        onRoster: false,
      }),
    ).toEqual({ allowed: false, reason: "NOT_MEMBER_OF_DEPARTMENT" });
  });

  it("cannot enter preferences", () => {
    expect(
      decide(former, "preference.editOwn", { departmentId: DEPT }),
    ).toEqual({ allowed: false, reason: "NOT_MEMBER_OF_DEPARTMENT" });
  });

  it("gains no department-wide access", () => {
    expect(
      decide(former, "schedule.viewDepartment", {
        departmentId: DEPT,
        status: "APPROVED",
      }).allowed,
    ).toBe(false);
    expect(decide(former, "audit.view", { departmentId: DEPT }).allowed).toBe(
      false,
    );
  });

  it("a deactivated account loses even historical access", () => {
    const deactivated = { ...former, isActive: false };
    expect(
      decide(deactivated, "changeRequest.view", {
        departmentId: DEPT,
        requesterId: former.userId,
      }),
    ).toEqual({ allowed: false, reason: "ACTOR_INACTIVE" });
  });
});

describe("change-request cancellation and consent", () => {
  it("only the requester may cancel", () => {
    expect(
      decide(actors.headNurse, "changeRequest.cancel", {
        departmentId: DEPT,
        requesterId: "nurse",
      }),
    ).toEqual({ allowed: false, reason: "NOT_REQUESTER" });
  });

  it("only the swap partner may answer, and the Head Nurse cannot answer for them", () => {
    expect(
      decide(actors.headNurse, "changeRequest.consent", {
        departmentId: DEPT,
        counterpartId: "nurse",
      }),
    ).toEqual({ allowed: false, reason: "NOT_COUNTERPART" });
  });

  it("a former member named as partner cannot answer any more (D16)", () => {
    expect(
      decide(actors.otherNurse, "changeRequest.consent", {
        departmentId: DEPT,
        counterpartId: actors.otherNurse.userId,
      }),
    ).toEqual({ allowed: false, reason: "NOT_MEMBER_OF_DEPARTMENT" });
  });

  it("a supervisor may read requests but never apply them", () => {
    const resource = { departmentId: DEPT };
    expect(decide(actors.supervisor, "changeRequest.apply", resource)).toEqual({
      allowed: false,
      reason: "NOT_HEAD_NURSE_OF_DEPARTMENT",
    });
    expect(decide(actors.supervisor, "schedule.adjust", resource)).toEqual({
      allowed: false,
      reason: "NOT_HEAD_NURSE_OF_DEPARTMENT",
    });
  });
});
