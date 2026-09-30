import { describe, expect, it } from "vitest";

import type { Actor } from "../../domain/authz/actor";
import type { Violation } from "../../domain/rules/violation";
import type { ScheduleStatus } from "../../domain/schedule/status";
import { isoDate } from "../../domain/shared/dates";
import type { SubmissionRecord } from "../../infrastructure/repositories/submissions";
import { describeWorkflow, workflowPeople } from "./workflow";

const DEPT = "dept-1";
const HEAD = "head";
const SUPERVISOR = "supervisor";
const PERIOD = { start: isoDate("2026-10-23"), end: isoDate("2026-11-21") };

const head: Actor = {
  userId: HEAD,
  isActive: true,
  memberships: [{ departmentId: DEPT, role: "HEAD_NURSE" }],
  supervisedDepartmentIds: [],
};
const nurse: Actor = {
  userId: "nurse",
  isActive: true,
  memberships: [{ departmentId: DEPT, role: "NURSE" }],
  supervisedDepartmentIds: [],
};
const supervisor: Actor = {
  userId: SUPERVISOR,
  isActive: true,
  memberships: [],
  supervisedDepartmentIds: [DEPT],
};

const nightRest: Violation = {
  rule: "NIGHT_REST",
  severity: "error",
  nurseId: "n1",
  nightDate: isoDate("2026-10-25"),
  date: isoDate("2026-10-26"),
  shift: "M",
};
const outside: Violation = {
  rule: "OUTSIDE_PERIOD",
  severity: "error",
  nurseId: "n1",
  date: isoDate("2026-12-01"),
};

const submission = (
  overrides: Partial<SubmissionRecord> = {},
): SubmissionRecord => ({
  id: "s1",
  scheduleId: "schedule",
  revisionId: null,
  submittedBy: HEAD,
  submittedAt: new Date("2026-10-10T08:00:00Z"),
  note: null,
  decision: null,
  decidedBy: null,
  decidedAt: null,
  decisionComment: null,
  ...overrides,
});

const describeFor = (
  actor: Actor,
  status: ScheduleStatus,
  options: {
    violations?: Violation[];
    windows?: number;
    submissions?: SubmissionRecord[];
  } = {},
) =>
  describeWorkflow(actor, {
    schedule: { departmentId: DEPT, period: PERIOD, status },
    violations: options.violations ?? [],
    activePreferenceWindows: options.windows ?? 0,
    submissions: options.submissions ?? [],
    names: new Map([
      [HEAD, "مریم"],
      [SUPERVISOR, "سوپروایزر"],
    ]),
  });

const offered = (w: ReturnType<typeof describeWorkflow>) =>
  Object.entries(w.actions)
    .filter(([, a]) => a !== null)
    .map(([k]) => k);

describe("describeWorkflow: what each actor is offered", () => {
  it.each([
    ["DRAFT", []],
    ["PLANNING", ["finalize"]],
    ["FINALIZED", ["submit"]],
    ["SUBMITTED", ["withdraw"]],
    ["RETURNED", ["submit"]],
    ["APPROVED", []],
  ] as const)("Head Nurse in %s: %j", (status, expected) => {
    const submissions = status === "SUBMITTED" ? [submission()] : [];
    expect(offered(describeFor(head, status, { submissions }))).toEqual(
      expected,
    );
  });

  it.each(["DRAFT", "PLANNING", "FINALIZED", "RETURNED", "APPROVED"] as const)(
    "Supervisor in %s: nothing",
    (status) => {
      expect(offered(describeFor(supervisor, status))).toEqual([]);
    },
  );

  it("Supervisor in SUBMITTED: approve and return, nothing to block them", () => {
    const w = describeFor(supervisor, "SUBMITTED", {
      submissions: [submission()],
    });
    expect(w.actions).toEqual({
      finalize: null,
      submit: null,
      withdraw: null,
      approve: { blockers: [] },
      return: { blockers: [] },
    });
    expect(w.ownSubmission).toBe(false);
  });

  it("a nurse is offered nothing in any status", () => {
    for (const status of ["PLANNING", "FINALIZED", "SUBMITTED"] as const)
      expect(
        offered(describeFor(nurse, status, { submissions: [submission()] })),
      ).toEqual([]);
  });

  it("an inactive Head Nurse is offered nothing", () => {
    expect(
      offered(describeFor({ ...head, isActive: false }, "PLANNING")),
    ).toEqual([]);
  });

  it("a Supervisor who submitted it is not offered approve or return (SELF_APPROVAL)", () => {
    const both: Actor = { ...head, supervisedDepartmentIds: [DEPT] };
    const w = describeFor(both, "SUBMITTED", {
      submissions: [submission({ submittedBy: HEAD })],
    });
    expect(w.actions.approve).toBeNull();
    expect(w.actions.return).toBeNull();
    expect(w.actions.withdraw).toEqual({ blockers: [] });
    expect(w.ownSubmission).toBe(true);
  });
});

describe("describeWorkflow: blockers come from the state machine's guards", () => {
  it("finalize is blocked by blocking findings, with the days they belong to", () => {
    const w = describeFor(head, "PLANNING", {
      violations: [nightRest, outside],
    });
    expect(w.actions.finalize).toEqual({ blockers: ["BLOCKING_FINDINGS"] });
    // The outside-period finding belongs to no day (D43) but still counts.
    expect(w.blockingFindings).toEqual({ count: 2, dates: ["2026-10-26"] });
  });

  it("finalize is not blocked by an open preference window", () => {
    const w = describeFor(head, "PLANNING", { windows: 1 });
    expect(w.actions.finalize).toEqual({ blockers: [] });
    expect(w.preferenceWindowOpen).toBe(true);
  });

  it("submit lists every blocker at once", () => {
    expect(
      describeFor(head, "FINALIZED", { violations: [nightRest], windows: 2 })
        .actions.submit,
    ).toEqual({ blockers: ["BLOCKING_FINDINGS", "PREFERENCE_WINDOW_OPEN"] });
    expect(
      describeFor(head, "RETURNED", { windows: 1 }).actions.submit,
    ).toEqual({ blockers: ["PREFERENCE_WINDOW_OPEN"] });
  });

  it("warnings never block", () => {
    const warning = {
      ...nightRest,
      severity: "warning",
    } as unknown as Violation;
    const w = describeFor(head, "PLANNING", { violations: [warning] });
    expect(w.actions.finalize).toEqual({ blockers: [] });
    expect(w.blockingFindings.count).toBe(0);
  });
});

describe("describeWorkflow: submissions", () => {
  it("names the pending submission and the latest decision", () => {
    const returned = submission({
      id: "s1",
      decision: "RETURNED",
      decidedBy: SUPERVISOR,
      decidedAt: new Date("2026-10-11T08:00:00Z"),
      decisionComment: "شب ۱۲ آبان",
    });
    const pending = submission({ id: "s2" });
    const w = describeFor(head, "SUBMITTED", {
      submissions: [returned, pending],
    });
    expect(w.pending).toMatchObject({
      id: "s2",
      submittedBy: { userId: HEAD, displayName: "مریم" },
      decision: null,
    });
    expect(w.lastDecision).toMatchObject({
      id: "s1",
      decision: "RETURNED",
      decidedBy: { userId: SUPERVISOR, displayName: "سوپروایزر" },
      comment: "شب ۱۲ آبان",
    });
  });

  it("has no pending submission outside SUBMITTED", () => {
    expect(
      describeFor(head, "FINALIZED", { submissions: [submission()] }).pending,
    ).toBeNull();
  });

  it("names an unknown person with a dash", () => {
    const w = describeFor(supervisor, "SUBMITTED", {
      submissions: [submission({ submittedBy: "gone" })],
    });
    expect(w.pending?.submittedBy.displayName).toBe("—");
  });

  it("workflowPeople lists submitters and deciders once", () => {
    expect(
      workflowPeople([
        submission({ decidedBy: SUPERVISOR }),
        submission(),
      ]).sort(),
    ).toEqual([HEAD, SUPERVISOR].sort());
  });
});
