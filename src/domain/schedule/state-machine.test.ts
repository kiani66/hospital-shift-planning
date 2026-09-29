import { describe, expect, it } from "vitest";

import { isoDate } from "../shared/dates";
import {
  InvalidStateError,
  RuleViolationError,
  ValidationError,
} from "../shared/errors";
import type { Violation } from "../rules/violation";
import {
  eventsFrom,
  transition,
  TRANSITIONS,
  type ScheduleCommand,
  type ScheduleEvent,
} from "./state-machine";
import {
  acceptsPreferenceWindows,
  isScheduleStatus,
  SCHEDULE_STATUSES,
  type ScheduleStatus,
} from "./status";

const nightRest: Violation = {
  rule: "NIGHT_REST",
  severity: "error",
  nurseId: "sara",
  nightDate: isoDate("2026-03-21"),
  date: isoDate("2026-03-22"),
  shift: "M",
};
const warning = { ...nightRest, severity: "warning" } as unknown as Violation;

/** A command that passes every guard. */
const passing: Record<ScheduleEvent, ScheduleCommand> = {
  OPEN_PREFERENCES: { type: "OPEN_PREFERENCES" },
  START_PLANNING: { type: "START_PLANNING" },
  FINALIZE: { type: "FINALIZE", violations: [] },
  SUBMIT: { type: "SUBMIT", violations: [], activePreferenceWindows: 0 },
  WITHDRAW: { type: "WITHDRAW", hasApprovedVersion: false },
  APPROVE: { type: "APPROVE" },
  RETURN: { type: "RETURN", comment: "Night coverage on the 12th is short" },
  START_REVISION: { type: "START_REVISION" },
  DISCARD_REVISION: { type: "DISCARD_REVISION", hasApprovedVersion: true },
};

const EVENTS = Object.keys(passing) as ScheduleEvent[];

/** The approved state machine (plan section 5). */
const EXPECTED: Record<
  ScheduleStatus,
  Partial<Record<ScheduleEvent, ScheduleStatus>>
> = {
  DRAFT: { OPEN_PREFERENCES: "PLANNING", START_PLANNING: "PLANNING" },
  PLANNING: { FINALIZE: "FINALIZED" },
  FINALIZED: { SUBMIT: "SUBMITTED" },
  SUBMITTED: { APPROVE: "APPROVED", RETURN: "RETURNED", WITHDRAW: "FINALIZED" },
  RETURNED: { SUBMIT: "SUBMITTED", DISCARD_REVISION: "APPROVED" },
  APPROVED: { START_REVISION: "REVISING" },
  REVISING: { SUBMIT: "SUBMITTED", DISCARD_REVISION: "APPROVED" },
};

describe("schedule state machine", () => {
  const cases = SCHEDULE_STATUSES.flatMap((from) =>
    EVENTS.map(
      (event) => [from, event, EXPECTED[from][event] ?? null] as const,
    ),
  );

  it.each(cases)("%s --%s--> %s", (from, event, expected) => {
    const result = transition(from, passing[event]);
    if (expected) {
      expect(result).toEqual({ ok: true, value: expected });
    } else {
      expect(result.ok).toBe(false);
      expect(!result.ok && result.error).toBeInstanceOf(InvalidStateError);
    }
  });

  it("the transition table matches the approved design", () => {
    expect(TRANSITIONS).toEqual(EXPECTED);
  });

  it.each(SCHEDULE_STATUSES)(
    "eventsFrom(%s) lists its defined events",
    (status) => {
      expect(eventsFrom(status).sort()).toEqual(
        Object.keys(EXPECTED[status]).sort(),
      );
    },
  );

  it("APPROVED has no way back except through a revision", () => {
    expect(eventsFrom("APPROVED")).toEqual(["START_REVISION"]);
  });

  it("RETURN never reopens anything for nurses: it only moves to RETURNED", () => {
    expect(transition("SUBMITTED", passing.RETURN)).toEqual({
      ok: true,
      value: "RETURNED",
    });
    expect(acceptsPreferenceWindows("RETURNED")).toBe(true); // windows are still explicit
  });
});

describe("approved workflow decisions", () => {
  it.each(["APPROVED", "RETURNED"] as const)(
    "D10: WITHDRAW is no longer possible once the Supervisor has acted (%s)",
    (status) => {
      const result = transition(status, passing.WITHDRAW);
      expect(!result.ok && result.error).toBeInstanceOf(InvalidStateError);
    },
  );

  it.each(SCHEDULE_STATUSES.filter((s) => s !== "SUBMITTED"))(
    "D12: APPROVE and RETURN are only available in SUBMITTED, not %s",
    (status) => {
      expect(transition(status, passing.APPROVE).ok).toBe(false);
      expect(transition(status, passing.RETURN).ok).toBe(false);
    },
  );
});

describe("guards", () => {
  describe.each(["FINALIZE", "SUBMIT"] as const)("%s", (event) => {
    const from: ScheduleStatus =
      event === "FINALIZE" ? "PLANNING" : "FINALIZED";

    it("is blocked by a night-rest violation", () => {
      const result = transition(from, {
        ...passing[event],
        violations: [nightRest],
      } as ScheduleCommand);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(RuleViolationError);
        expect((result.error as RuleViolationError).violations).toEqual([
          nightRest,
        ]);
      }
    });

    it("reports only the blocking violations", () => {
      const result = transition(from, {
        ...passing[event],
        violations: [warning, nightRest],
      } as ScheduleCommand);
      expect(
        !result.ok && (result.error as RuleViolationError).violations,
      ).toEqual([nightRest]);
    });

    it("is not blocked by warnings", () => {
      const result = transition(from, {
        ...passing[event],
        violations: [warning],
      } as ScheduleCommand);
      expect(result.ok).toBe(true);
    });
  });

  it.each(["RETURNED", "REVISING"] as const)(
    "SUBMIT from %s is blocked by night-rest too",
    (from) => {
      const result = transition(from, {
        type: "SUBMIT",
        violations: [nightRest],
        activePreferenceWindows: 0,
      });
      expect(!result.ok && result.error).toBeInstanceOf(RuleViolationError);
    },
  );

  it("SUBMIT is blocked while a preference window is active", () => {
    const result = transition("FINALIZED", {
      type: "SUBMIT",
      violations: [],
      activePreferenceWindows: 1,
    });
    expect(!result.ok && result.error).toBeInstanceOf(InvalidStateError);
  });

  it.each(["", "   ", "\n"])("RETURN requires a comment (%j)", (comment) => {
    const result = transition("SUBMITTED", { type: "RETURN", comment });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(ValidationError);
      expect((result.error as ValidationError).field).toBe("comment");
    }
  });

  it("DISCARD_REVISION from RETURNED requires an approved version", () => {
    const result = transition("RETURNED", {
      type: "DISCARD_REVISION",
      hasApprovedVersion: false,
    });
    expect(!result.ok && result.error).toBeInstanceOf(InvalidStateError);
  });

  it.each([
    [false, "FINALIZED"],
    [true, "REVISING"],
  ] as const)(
    "WITHDRAW (hasApprovedVersion=%s) returns to %s",
    (hasApprovedVersion, expected) => {
      expect(
        transition("SUBMITTED", { type: "WITHDRAW", hasApprovedVersion }),
      ).toEqual({
        ok: true,
        value: expected,
      });
    },
  );
});

describe("status helpers", () => {
  it.each([
    ["DRAFT", true],
    ["REVISING", true],
    ["draft", false],
    ["CLOSED", false],
    [42, false],
  ])("isScheduleStatus(%j) = %s", (value, expected) => {
    expect(isScheduleStatus(value)).toBe(expected);
  });

  it.each([
    ["DRAFT", false],
    ["PLANNING", true],
    ["FINALIZED", true],
    ["SUBMITTED", false],
    ["RETURNED", true],
    ["APPROVED", false],
    ["REVISING", true],
  ] as const)("acceptsPreferenceWindows(%s) = %s", (status, expected) => {
    expect(acceptsPreferenceWindows(status)).toBe(expected);
  });
});
