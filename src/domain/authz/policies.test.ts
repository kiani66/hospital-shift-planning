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
      () => ({ departmentId: DEPT }),
      ["nurse", "headNurse"],
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
      ["nurse", "headNurse", "supervisor"],
    ],
    [
      "changeRequest.view",
      () => ({ departmentId: DEPT, requesterId: "someone-else" }),
      ["headNurse", "supervisor"],
    ],
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

  it("owning a request is not enough after leaving the department", () => {
    expect(
      decide(actors.otherNurse, "changeRequest.view", {
        departmentId: DEPT,
        requesterId: "nurse-er",
      }).allowed,
    ).toBe(false);
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
