import { describe, expect, it } from "vitest";

import { SCHEDULE_STATUSES, type ScheduleStatus } from "../schedule/status";
import { isoDate } from "../shared/dates";
import { InvalidStateError, ValidationError } from "../shared/errors";
import {
  acceptsChangeRequests,
  CHANGE_REQUEST_REFUSALS,
  isActiveChangeRequest,
} from "./model";
import { OTHER_REASON_CODE } from "./reason";
import {
  decideChangeRequest,
  refreshSwap,
  respondToSwap,
  swapContextChanged,
  validateNewChangeRequest,
  type ChangeRequestState,
  type NewChangeRequestInput,
} from "./request";

// Aban 1405; "today" is 1 Aban.
const period = { start: isoDate("2026-10-23"), end: isoDate("2026-11-21") };
const today = isoDate("2026-10-23");

const base = (
  overrides: Partial<NewChangeRequestInput> = {},
): NewChangeRequestInput => ({
  type: "UNAVAILABLE",
  date: isoDate("2026-10-25"),
  today,
  schedule: { status: "APPROVED", period },
  requesterId: "sara",
  requesterShift: "M",
  targetShift: null,
  counterpart: null,
  rosterNurseIds: new Set(["sara", "ali", "reza"]),
  reason: {
    code: "ILLNESS",
    scope: "REQUEST",
    requiresNote: false,
    isActive: true,
  },
  note: null,
  ...overrides,
});

function failure(input: NewChangeRequestInput) {
  const result = validateNewChangeRequest(input);
  if (result.ok) throw new Error("expected a failure");
  return result.error;
}

const field = (input: NewChangeRequestInput) =>
  (failure(input) as ValidationError).field;

describe("validateNewChangeRequest", () => {
  it("accepts a valid UNAVAILABLE request with its snapshot", () => {
    expect(validateNewChangeRequest(base({ note: " تب " }))).toEqual({
      ok: true,
      value: {
        type: "UNAVAILABLE",
        date: "2026-10-25",
        requesterId: "sara",
        requesterShift: "M",
        targetShift: null,
        counterpartId: null,
        counterpartShift: null,
        reasonCode: "ILLNESS",
        note: "تب",
        status: "PENDING",
        consent: null,
      },
    });
  });

  it("accepts a CHANGE_SHIFT request naming a different shift", () => {
    const result = validateNewChangeRequest(
      base({ type: "CHANGE_SHIFT", targetShift: "E" }),
    );
    expect(result.ok && result.value.targetShift).toBe("E");
  });

  it("accepts a SWAP with another rostered nurse; consent starts pending", () => {
    const result = validateNewChangeRequest(
      base({ type: "SWAP", counterpart: { nurseId: "ali", shift: null } }),
    );
    expect(result.ok && result.value).toMatchObject({
      counterpartId: "ali",
      counterpartShift: null,
      consent: "PENDING",
    });
  });

  it("accepts OTHER with a note", () => {
    expect(
      validateNewChangeRequest(
        base({
          type: "OTHER",
          reason: {
            code: OTHER_REASON_CODE,
            scope: "BOTH",
            requiresNote: true,
            isActive: true,
          },
          note: "توضیح",
        }),
      ).ok,
    ).toBe(true);
  });

  it.each(["DRAFT", "PLANNING"] as const)(
    "is refused while the schedule is %s (preferences are the way to ask)",
    (status) => {
      const error = failure(base({ schedule: { status, period } }));
      expect(error).toBeInstanceOf(InvalidStateError);
      expect((error as InvalidStateError).attempted).toBe(
        CHANGE_REQUEST_REFUSALS.SCHEDULE_NOT_ACCEPTING,
      );
    },
  );

  it("accepts requests from FINALIZED on (D13)", () => {
    const accepting = SCHEDULE_STATUSES.filter((s: ScheduleStatus) =>
      acceptsChangeRequests(s),
    );
    expect(accepting).toEqual([
      "FINALIZED",
      "SUBMITTED",
      "RETURNED",
      "APPROVED",
      "REVISING",
    ]);
  });

  it.each<[string, Partial<NewChangeRequestInput>, string]>([
    ["a day outside the period", { date: isoDate("2026-11-22") }, "date"],
    ["a past day", { today: isoDate("2026-10-26") }, "date"],
    ["a requester not on the roster", { requesterId: "x" }, "requesterId"],
    ["a day without an assignment", { requesterShift: null }, "date"],
    [
      "a shift change without a shift",
      { type: "CHANGE_SHIFT", targetShift: null },
      "targetShift",
    ],
    [
      "a shift change to the same shift",
      { type: "CHANGE_SHIFT", targetShift: "M" },
      "targetShift",
    ],
    ["a target shift on another type", { targetShift: "E" }, "targetShift"],
    ["a swap without a partner", { type: "SWAP" }, "counterpartId"],
    [
      "a swap with oneself",
      { type: "SWAP", counterpart: { nurseId: "sara", shift: "E" } },
      "counterpartId",
    ],
    [
      "a swap with someone off the roster",
      { type: "SWAP", counterpart: { nurseId: "x", shift: "E" } },
      "counterpartId",
    ],
    [
      "a swap with the same shift",
      { type: "SWAP", counterpart: { nurseId: "ali", shift: "M" } },
      "counterpartId",
    ],
    [
      "a partner on another type",
      { counterpart: { nurseId: "ali", shift: "E" } },
      "counterpartId",
    ],
    ["an inactive reason", { reason: null }, "reasonCode"],
  ])("rejects %s", (_, overrides, expected) => {
    expect(field(base(overrides))).toBe(expected);
  });

  it("allows a request for today", () => {
    expect(validateNewChangeRequest(base({ date: today })).ok).toBe(true);
  });

  it("requires a note when the reason is Other", () => {
    expect(
      field(
        base({
          type: "OTHER",
          reason: {
            code: OTHER_REASON_CODE,
            scope: "BOTH",
            requiresNote: true,
            isActive: true,
          },
          note: " ",
        }),
      ),
    ).toBe("note");
  });
});

const pending = (
  overrides: Partial<ChangeRequestState> = {},
): ChangeRequestState => ({
  type: "UNAVAILABLE",
  status: "PENDING",
  date: isoDate("2026-10-25"),
  requesterId: "sara",
  requesterShift: "M",
  targetShift: null,
  counterpartId: null,
  counterpartShift: null,
  consent: null,
  ...overrides,
});

const swap = (overrides: Partial<ChangeRequestState> = {}) =>
  pending({
    type: "SWAP",
    counterpartId: "ali",
    counterpartShift: "E",
    consent: "PENDING",
    ...overrides,
  });

const attempted = (result: { ok: boolean; error?: unknown }) =>
  (result.error as InvalidStateError).attempted;

describe("decideChangeRequest", () => {
  it.each([
    ["CANCEL", "CANCELLED"],
    ["REJECT", "REJECTED"],
    ["APPLY", "APPLIED"],
  ] as const)("%s closes a pending request as %s", (decision, status) => {
    expect(decideChangeRequest(pending(), decision)).toEqual({
      ok: true,
      value: status,
    });
  });

  it.each(["CANCELLED", "REJECTED", "APPLIED"] as const)(
    "refuses every decision on a %s request (an applied one is never undone)",
    (status) => {
      for (const decision of ["CANCEL", "REJECT", "APPLY"] as const) {
        const result = decideChangeRequest(pending({ status }), decision);
        expect(result.ok).toBe(false);
        expect(!result.ok && result.error.message).toContain(
          "the change request",
        );
      }
    },
  );

  it.each(["PENDING", "DECLINED"] as const)(
    "refuses to apply a swap whose consent is %s",
    (consent) => {
      const result = decideChangeRequest(swap({ consent }), "APPLY");
      expect(attempted(result)).toBe(
        CHANGE_REQUEST_REFUSALS.SWAP_CONSENT_REQUIRED,
      );
    },
  );

  it("applies a consented swap; rejects or cancels one without consent", () => {
    expect(decideChangeRequest(swap({ consent: "ACCEPTED" }), "APPLY").ok).toBe(
      true,
    );
    expect(decideChangeRequest(swap(), "REJECT").ok).toBe(true);
    expect(decideChangeRequest(swap(), "CANCEL").ok).toBe(true);
  });
});

describe("isActiveChangeRequest", () => {
  it("is true only while pending", () => {
    expect(isActiveChangeRequest("PENDING")).toBe(true);
    expect(isActiveChangeRequest("APPLIED")).toBe(false);
    expect(isActiveChangeRequest("CANCELLED")).toBe(false);
    expect(isActiveChangeRequest("REJECTED")).toBe(false);
  });
});

describe("swap consent", () => {
  const unchanged = { requester: "M", counterpart: "E" } as const;

  it("accepting records consent and keeps the request pending", () => {
    expect(respondToSwap(swap(), { accept: true, current: unchanged })).toEqual(
      { ok: true, value: { status: "PENDING", consent: "ACCEPTED" } },
    );
  });

  it("declining closes the request as rejected", () => {
    expect(
      respondToSwap(swap(), { accept: false, current: unchanged }),
    ).toEqual({ ok: true, value: { status: "REJECTED", consent: "DECLINED" } });
  });

  it("refuses to accept a swap whose context changed", () => {
    const result = respondToSwap(swap(), {
      accept: true,
      current: { requester: "M", counterpart: "N" },
    });
    expect(attempted(result)).toBe(
      CHANGE_REQUEST_REFUSALS.SWAP_CONTEXT_CHANGED,
    );
  });

  it("may still decline a swap whose context changed", () => {
    expect(
      respondToSwap(swap(), {
        accept: false,
        current: { requester: null, counterpart: "N" },
      }).ok,
    ).toBe(true);
  });

  it("refuses a second answer, a non-swap and a closed request", () => {
    expect(
      attempted(
        respondToSwap(swap({ consent: "ACCEPTED" }), {
          accept: false,
          current: unchanged,
        }),
      ),
    ).toBe(CHANGE_REQUEST_REFUSALS.SWAP_ALREADY_ANSWERED);
    expect(
      attempted(respondToSwap(pending(), { accept: true, current: unchanged })),
    ).toBe(CHANGE_REQUEST_REFUSALS.NOT_A_SWAP);
    expect(
      attempted(
        respondToSwap(swap({ status: "CANCELLED" }), {
          accept: true,
          current: unchanged,
        }),
      ),
    ).toBe("RESPOND_TO_SWAP");
  });

  it("detects a change on either side", () => {
    expect(swapContextChanged(swap(), unchanged)).toBe(false);
    expect(
      swapContextChanged(swap(), { requester: "N", counterpart: "E" }),
    ).toBe(true);
    expect(
      swapContextChanged(swap(), { requester: "M", counterpart: null }),
    ).toBe(true);
  });
});

describe("refreshSwap", () => {
  it("keeps an unchanged swap (and its consent) as it is", () => {
    expect(
      refreshSwap(swap({ consent: "ACCEPTED" }), {
        requester: "M",
        counterpart: "E",
      }),
    ).toEqual({
      ok: true,
      value: {
        requesterShift: "M",
        counterpartShift: "E",
        consent: "ACCEPTED",
        changed: false,
      },
    });
  });

  it("takes the current shifts and asks for consent again", () => {
    expect(
      refreshSwap(swap({ consent: "ACCEPTED" }), {
        requester: "N",
        counterpart: null,
      }),
    ).toEqual({
      ok: true,
      value: {
        requesterShift: "N",
        counterpartShift: null,
        consent: "PENDING",
        changed: true,
      },
    });
  });

  it("cannot refresh a swap that no longer makes sense", () => {
    const off = refreshSwap(swap(), { requester: null, counterpart: "E" });
    expect(!off.ok && (off.error as ValidationError).field).toBe("date");
    const same = refreshSwap(swap(), { requester: "E", counterpart: "E" });
    expect(!same.ok && (same.error as ValidationError).field).toBe(
      "counterpartId",
    );
  });

  it("refuses a non-swap and a closed swap", () => {
    const current = { requester: "M", counterpart: "E" } as const;
    expect(attempted(refreshSwap(pending(), current))).toBe(
      CHANGE_REQUEST_REFUSALS.NOT_A_SWAP,
    );
    expect(attempted(refreshSwap(swap({ status: "APPLIED" }), current))).toBe(
      "REFRESH_SWAP",
    );
  });
});
