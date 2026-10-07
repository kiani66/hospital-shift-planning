import { describe, expect, it } from "vitest";

import { version } from "../../../tests/support/staffing-rules";
import { SCHEDULE_STATUSES, type ScheduleStatus } from "../schedule/status";
import { isoDate, type IsoDate } from "../shared/dates";
import {
  APPLY_RULE_SET_INVALID_TARGET,
  APPLY_RULE_SET_REFUSALS,
  planApplyRuleSet,
  unrepairablePastDates,
  type ApplyRepairContext,
} from "./apply";

const hospital1 = version("h1", { versionNo: 1 });
const nicu1 = version("n1", { departmentId: "nicu", versionNo: 1 });
const nicu2 = version("n2", { departmentId: "nicu", versionNo: 2 });
const nicuRetired = version("n0", {
  departmentId: "nicu",
  status: "RETIRED",
  versionNo: 3,
});
const icu1 = version("i1", { departmentId: "icu" });

const today = isoDate("2026-10-10");
const yesterday = isoDate("2026-10-09");
const tomorrow = isoDate("2026-10-11");
const nothingToRepair: ApplyRepairContext = {
  datesToRepair: [],
  revisionDates: null,
  today,
};

const plan = (
  current = nicu2,
  target = nicu1,
  status: (typeof SCHEDULE_STATUSES)[number] = "PLANNING",
  repair: ApplyRepairContext = nothingToRepair,
) =>
  planApplyRuleSet({ status, departmentId: "nicu", current, target, repair });

describe("planApplyRuleSet", () => {
  it.each(["DRAFT", "PLANNING", "FINALIZED", "RETURNED", "REVISING"] as const)(
    "is allowed in %s",
    (status) => {
      expect(plan(hospital1, nicu2, status)).toEqual({
        ok: true,
        value: { rollback: false },
      });
    },
  );

  it("is refused while SUBMITTED (withdraw first)", () => {
    expect(plan(hospital1, nicu2, "SUBMITTED")).toMatchObject({
      ok: false,
      error: { attempted: APPLY_RULE_SET_REFUSALS.SUBMITTED },
    });
  });

  it("is refused on an APPROVED schedule: a revision is required", () => {
    expect(plan(hospital1, nicu2, "APPROVED")).toMatchObject({
      ok: false,
      error: { attempted: APPLY_RULE_SET_REFUSALS.APPROVED },
    });
  });

  it("marks an earlier version of the same lineage as a rollback", () => {
    expect(plan(nicu2, nicu1)).toEqual({ ok: true, value: { rollback: true } });
    // Moving forward, or across lineages, is not a rollback.
    expect(plan(nicu1, nicu2)).toEqual({
      ok: true,
      value: { rollback: false },
    });
    expect(plan(nicu2, hospital1)).toEqual({
      ok: true,
      value: { rollback: false },
    });
  });

  it("accepts a RETIRED version of an applicable lineage", () => {
    expect(plan(nicu1, nicuRetired).ok).toBe(true);
  });

  it.each([
    [
      "a DRAFT",
      version("d", { status: "DRAFT", departmentId: "nicu" }),
      APPLY_RULE_SET_INVALID_TARGET.NOT_PUBLISHED,
    ],
    [
      "another department's version",
      icu1,
      APPLY_RULE_SET_INVALID_TARGET.NOT_APPLICABLE,
    ],
    ["the current pin", nicu2, APPLY_RULE_SET_INVALID_TARGET.ALREADY_PINNED],
  ])("refuses %s", (_, target, reason) => {
    expect(plan(nicu2, target)).toMatchObject({
      ok: false,
      error: { reason, field: "targetVersionId" },
    });
  });
});

describe("unrepairable past days (D109)", () => {
  const repair = (
    datesToRepair: IsoDate[],
    revisionDates: IsoDate[] | null = null,
  ): ApplyRepairContext => ({
    datesToRepair,
    revisionDates: revisionDates && new Set(revisionDates),
    today,
  });

  it("FINALIZED: every past day is unrepairable; today and later are not", () => {
    expect(
      unrepairablePastDates("FINALIZED", repair([yesterday, today, tomorrow])),
    ).toEqual([yesterday]);
    expect(
      plan(hospital1, nicu2, "FINALIZED", repair([yesterday])),
    ).toMatchObject({
      ok: false,
      error: { attempted: APPLY_RULE_SET_REFUSALS.UNREPAIRABLE_PAST_DATES },
    });
    expect(plan(hospital1, nicu2, "FINALIZED", repair([today])).ok).toBe(true);
  });

  it.each([
    ["REVISING", "REVISING"],
    ["a returned revision", "RETURNED"],
  ] as const)(
    "%s: past days outside the revision scope are unrepairable",
    (_, status: ScheduleStatus) => {
      const outside = repair([yesterday, tomorrow], []);
      expect(unrepairablePastDates(status, outside)).toEqual([yesterday]);
      expect(plan(hospital1, nicu2, status, outside)).toMatchObject({
        ok: false,
        error: { attempted: APPLY_RULE_SET_REFUSALS.UNREPAIRABLE_PAST_DATES },
      });
      // A past day already in scope stays editable (D14, unchanged).
      const inScope = repair([yesterday, tomorrow], [yesterday]);
      expect(unrepairablePastDates(status, inScope)).toEqual([]);
      expect(plan(hospital1, nicu2, status, inScope).ok).toBe(true);
    },
  );

  it.each([
    ["DRAFT", null],
    ["PLANNING", null],
    ["RETURNED", null], // first cycle: no revision, the planner edits the whole period
  ] as const)(
    "%s keeps the planner's behaviour: nothing is unrepairable",
    (status, revisionDates) => {
      const pastOnly = repair([yesterday], revisionDates);
      expect(unrepairablePastDates(status, pastOnly)).toEqual([]);
      expect(plan(hospital1, nicu2, status, pastOnly).ok).toBe(true);
    },
  );

  it("status refusals come first", () => {
    expect(
      plan(hospital1, nicu2, "APPROVED", repair([yesterday])),
    ).toMatchObject({
      ok: false,
      error: { attempted: APPLY_RULE_SET_REFUSALS.APPROVED },
    });
  });
});
