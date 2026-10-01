import { describe, expect, it } from "vitest";

import { isoDate } from "../shared/dates";
import type { InvalidStateError, ValidationError } from "../shared/errors";
import { CHANGE_REQUEST_REFUSALS } from "./model";
import {
  confirmRequestPlan,
  planRequestChange,
  type CurrentRequestCells,
  type RequestResolution,
} from "./plan-change";
import type { ChangeRequestState } from "./request";

const date = isoDate("2026-10-25");
const roster = new Set(["sara", "ali", "reza"]);

const request = (
  overrides: Partial<ChangeRequestState> = {},
): ChangeRequestState => ({
  type: "UNAVAILABLE",
  status: "PENDING",
  date,
  requesterId: "sara",
  requesterShift: "M",
  targetShift: null,
  counterpartId: null,
  counterpartShift: null,
  consent: null,
  ...overrides,
});

const cells = (
  overrides: Partial<CurrentRequestCells> = {},
): CurrentRequestCells => ({
  requester: "M",
  counterpart: null,
  replacement: null,
  ...overrides,
});

const plan = (
  r: ChangeRequestState,
  current: CurrentRequestCells,
  resolution: RequestResolution = {},
) =>
  planRequestChange({
    request: r,
    current,
    rosterNurseIds: roster,
    resolution,
  });

const value = (result: ReturnType<typeof plan>) => {
  if (!result.ok) throw result.error;
  return result.value;
};

const fieldOf = (result: ReturnType<typeof plan>) =>
  !result.ok && (result.error as ValidationError).field;

describe("planRequestChange", () => {
  it("UNAVAILABLE clears the requester's current shift", () => {
    expect(value(plan(request(), cells()))).toEqual({
      edits: [{ nurseId: "sara", date, shift: null }],
      stale: null,
    });
  });

  it("UNAVAILABLE with a replacement hands the current shift over", () => {
    expect(
      value(plan(request(), cells(), { replacementNurseId: "ali" })).edits,
    ).toEqual([
      { nurseId: "sara", date, shift: null },
      { nurseId: "ali", date, shift: "M" },
    ]);
  });

  it.each<[string, CurrentRequestCells, string]>([
    ["is the requester", cells(), "sara"],
    ["is not on the roster", cells(), "nobody"],
    ["already works that day", cells({ replacement: "E" }), "ali"],
    ["has nothing to take over", cells({ requester: null }), "ali"],
  ])("refuses a replacement who %s", (_, current, replacementNurseId) => {
    expect(fieldOf(plan(request(), current, { replacementNurseId }))).toBe(
      "replacementNurseId",
    );
  });

  it("CHANGE_SHIFT sets the requested shift", () => {
    expect(
      value(plan(request({ type: "CHANGE_SHIFT", targetShift: "E" }), cells()))
        .edits,
    ).toEqual([{ nurseId: "sara", date, shift: "E" }]);
  });

  it("OTHER sets what the Head Nurse decides, and requires the decision", () => {
    const other = request({ type: "OTHER" });
    expect(value(plan(other, cells(), { requesterShift: "N" })).edits).toEqual([
      { nurseId: "sara", date, shift: "N" },
    ]);
    expect(value(plan(other, cells(), { requesterShift: null })).edits).toEqual(
      [{ nurseId: "sara", date, shift: null }],
    );
    expect(fieldOf(plan(other, cells()))).toBe("requesterShift");
  });

  it("refuses resolution fields that do not belong to the type", () => {
    expect(
      fieldOf(
        plan(request({ type: "CHANGE_SHIFT", targetShift: "E" }), cells(), {
          replacementNurseId: "ali",
        }),
      ),
    ).toBe("replacementNurseId");
    expect(fieldOf(plan(request(), cells(), { requesterShift: "E" }))).toBe(
      "requesterShift",
    );
  });

  describe("stale context (UNAVAILABLE / CHANGE_SHIFT / OTHER)", () => {
    it("recomputes against the current assignment and reports the difference", () => {
      const result = value(
        plan(
          request({ type: "CHANGE_SHIFT", targetShift: "E" }),
          cells({
            requester: "N",
          }),
        ),
      );
      expect(result.edits).toEqual([{ nurseId: "sara", date, shift: "E" }]);
      expect(result.stale).toEqual({
        nurseId: "sara",
        date,
        requestedAgainst: "M",
        current: "N",
      });
    });

    it("drops cells that would not change (the schedule already reflects them)", () => {
      const result = value(plan(request(), cells({ requester: null })));
      expect(result.edits).toEqual([]);
      expect(result.stale?.current).toBeNull();
    });
  });

  describe("SWAP", () => {
    const swap = request({
      type: "SWAP",
      counterpartId: "ali",
      counterpartShift: "E",
      consent: "ACCEPTED",
    });

    it("exchanges both nurses' current shifts", () => {
      expect(value(plan(swap, cells({ counterpart: "E" })))).toEqual({
        edits: [
          { nurseId: "sara", date, shift: "E" },
          { nurseId: "ali", date, shift: "M" },
        ],
        stale: null,
      });
    });

    it("swaps a working day with a day off", () => {
      const offSwap = { ...swap, counterpartShift: null };
      expect(value(plan(offSwap, cells())).edits).toEqual([
        { nurseId: "sara", date, shift: null },
        { nurseId: "ali", date, shift: "M" },
      ]);
    });

    it.each<[string, CurrentRequestCells]>([
      ["the requester's", cells({ requester: "N", counterpart: "E" })],
      ["the partner's", cells({ requester: "M", counterpart: null })],
    ])(
      "is blocked when %s assignment changed (re-consent needed)",
      (_, current) => {
        const result = plan(swap, current);
        expect(
          !result.ok && (result.error as InvalidStateError).attempted,
        ).toBe(CHANGE_REQUEST_REFUSALS.SWAP_CONTEXT_CHANGED);
      },
    );
  });
});

describe("confirmRequestPlan", () => {
  const edits = [{ nurseId: "sara", date, shift: null }] as const;
  const stale = {
    nurseId: "sara",
    date,
    requestedAgainst: "M" as const,
    current: "E" as const,
  };

  it("passes a fresh plan", () => {
    expect(confirmRequestPlan({ edits, stale: null }, {})).toEqual({
      ok: true,
      value: edits,
    });
  });

  it("needs explicit confirmation of a stale context", () => {
    const refused = confirmRequestPlan({ edits, stale }, {});
    expect(!refused.ok && (refused.error as InvalidStateError).attempted).toBe(
      CHANGE_REQUEST_REFUSALS.STALE_CONTEXT_NOT_CONFIRMED,
    );
    expect(
      confirmRequestPlan({ edits, stale }, { confirmStaleContext: true }).ok,
    ).toBe(true);
  });

  it("refuses a plan that changes nothing", () => {
    const result = confirmRequestPlan(
      { edits: [], stale },
      { confirmStaleContext: true },
    );
    expect(!result.ok && (result.error as ValidationError).field).toBe(
      "request",
    );
  });
});
