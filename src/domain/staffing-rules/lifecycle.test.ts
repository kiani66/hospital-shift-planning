import { describe, expect, it } from "vitest";

import { version } from "../../../tests/support/staffing-rules";
import { isoDate } from "../shared/dates";
import {
  canDiscardDraft,
  canEditDraft,
  canRetire,
  EFFECTIVE_FROM_IN_PAST,
  planPublish,
  publishConflicts,
  RULE_SET_REFUSALS,
} from "./lifecycle";

const d = isoDate;
const today = d("2026-11-01");
const baseline = version("v1", { effectiveFrom: "1900-01-01" });
const effective = version("v2", { effectiveFrom: "2026-10-23", versionNo: 2 });
const scheduled = version("v3", { effectiveFrom: "2026-11-22", versionNo: 3 });
const later = version("v4", { effectiveFrom: "2026-12-22", versionNo: 4 });
const retired = version("v0", {
  status: "RETIRED",
  effectiveFrom: "2026-12-01",
});
const draft = version("v5", { status: "DRAFT", versionNo: 5 });
const lineage = [baseline, effective, scheduled, later, retired, draft];

describe("draft-only operations (published versions are immutable)", () => {
  it.each([
    ["edit", canEditDraft, RULE_SET_REFUSALS.EDIT],
    ["discard", canDiscardDraft, RULE_SET_REFUSALS.DISCARD],
  ] as const)("%s only a DRAFT", (_, check, attempted) => {
    expect(check(draft).ok).toBe(true);
    for (const v of [effective, retired])
      expect(check(v)).toMatchObject({
        ok: false,
        error: { attempted, status: v.status },
      });
  });
});

describe("publishConflicts", () => {
  it("is every PUBLISHED version effective on or after the new date, by date", () => {
    expect(publishConflicts(lineage, d("2026-11-22")).map((v) => v.id)).toEqual(
      ["v3", "v4"],
    );
    expect(publishConflicts(lineage, d("2026-12-01")).map((v) => v.id)).toEqual(
      ["v4"],
    );
    expect(publishConflicts(lineage, d("2027-01-01"))).toEqual([]);
  });
});

describe("planPublish", () => {
  const publish = (effectiveFrom: string, confirmReplace: string[] = []) =>
    planPublish({
      version: draft,
      lineage,
      effectiveFrom: d(effectiveFrom),
      today,
      confirmReplace,
    });

  it("publishes immediately (today) or for a future day without conflicts", () => {
    expect(publish("2027-01-01")).toEqual({ ok: true, value: { replace: [] } });
    expect(
      planPublish({
        version: draft,
        lineage: [baseline, effective],
        effectiveFrom: today,
        today,
        confirmReplace: [],
      }),
    ).toEqual({ ok: true, value: { replace: [] } });
  });

  it("never publishes in the past", () => {
    expect(publish("2026-10-31")).toMatchObject({
      ok: false,
      error: { field: "effectiveFrom", reason: EFFECTIVE_FROM_IN_PAST },
    });
  });

  it("stops on a conflict with scheduled versions and names them", () => {
    expect(publish("2026-11-22")).toEqual({
      ok: false,
      error: { type: "PUBLISH_CONFLICT", conflicts: [scheduled, later] },
    });
  });

  it("refuses a partial or stale confirmation", () => {
    expect(publish("2026-11-22", ["v3"])).toMatchObject({
      ok: false,
      error: { type: "PUBLISH_CONFLICT" },
    });
    expect(publish("2026-11-22", ["v3", "v4", "v9"])).toMatchObject({
      ok: false,
      error: { type: "PUBLISH_CONFLICT" },
    });
    expect(publish("2027-01-01", ["v3"])).toMatchObject({
      ok: false,
      error: { type: "PUBLISH_CONFLICT", conflicts: [] },
    });
  });

  it("replaces exactly the confirmed conflicting versions", () => {
    expect(publish("2026-11-22", ["v4", "v3"])).toEqual({
      ok: true,
      value: { replace: [scheduled, later] },
    });
  });

  it("publishes only a DRAFT", () => {
    expect(
      planPublish({
        version: effective,
        lineage,
        effectiveFrom: d("2027-01-01"),
        today,
        confirmReplace: [],
      }),
    ).toMatchObject({
      ok: false,
      error: { attempted: RULE_SET_REFUSALS.PUBLISH },
    });
  });
});

describe("canRetire (withdraw without replacement)", () => {
  const nicu = (effectiveFrom: string) =>
    version("n", { departmentId: "nicu", effectiveFrom });

  it("withdraws a department override at any time", () => {
    expect(canRetire(nicu("2026-10-01"), today).ok).toBe(true);
    expect(canRetire(nicu("2026-12-01"), today).ok).toBe(true);
  });

  it("withdraws a Hospital Default version only while scheduled", () => {
    expect(canRetire(scheduled, today).ok).toBe(true);
    for (const v of [
      effective,
      baseline,
      version("t", { effectiveFrom: "2026-11-01" }),
    ])
      expect(canRetire(v, today)).toMatchObject({
        ok: false,
        error: {
          attempted: RULE_SET_REFUSALS.RETIRE_EFFECTIVE_HOSPITAL_DEFAULT,
        },
      });
  });

  it("retires only PUBLISHED versions", () => {
    for (const v of [draft, retired])
      expect(canRetire(v, today)).toMatchObject({
        ok: false,
        error: { attempted: RULE_SET_REFUSALS.RETIRE },
      });
  });
});
