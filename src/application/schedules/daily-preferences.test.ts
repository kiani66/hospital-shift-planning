import { beforeEach, describe, expect, it, vi } from "vitest";

import * as planner from "../../domain/preferences/daily-assistant";
import type { Actor } from "../../domain/authz/actor";
import { isoDate } from "../../domain/shared/dates";
import type { Database } from "../../infrastructure/db/database";
import {
  listAdjacentAssignments,
  listRosterAssignments,
} from "../../infrastructure/repositories/assignments";
import { recordAuditEvent } from "../../infrastructure/repositories/audit";
import { findDepartmentById } from "../../infrastructure/repositories/departments";
import { loadActor } from "../../infrastructure/repositories/memberships";
import { listPreferences } from "../../infrastructure/repositories/preferences";
import {
  listImportPeriodMembers,
  lockImportMemberships,
} from "../../infrastructure/repositories/schedule-import";
import {
  findScheduleById,
  type ScheduleRecord,
} from "../../infrastructure/repositories/schedules";
import { loadRuleSet } from "../staffing-rules/pinned";
import type { AppContext } from "../use-case";
import { writeAssignmentChanges } from "./edit-assignments";
import {
  loadScheduleForAssignmentUpdate,
  saveSchedule,
} from "./load-for-update";
import {
  acceptDailyPreferences,
  readDailyPreferences,
} from "./daily-preferences";

vi.mock("../../infrastructure/repositories/assignments");
vi.mock("../../infrastructure/repositories/audit");
vi.mock("../../infrastructure/repositories/departments");
vi.mock("../../infrastructure/repositories/memberships");
vi.mock("../../infrastructure/repositories/preferences");
vi.mock("../../infrastructure/repositories/schedule-import");
vi.mock("../../infrastructure/repositories/schedules");
vi.mock("../staffing-rules/pinned", async (original) => ({
  ...(await original<object>()),
  loadRuleSet: vi.fn(),
}));
vi.mock("./edit-assignments");
vi.mock("./load-for-update");

const S = "30000000-0000-4000-8000-abcdef000001";
const H = "20000000-0000-4000-8000-000000000010";
const N = "20000000-0000-4000-8000-abcdef000011";
const departmentId = "10000000-0000-4000-8000-000000000001";
const date = isoDate("2026-10-24");
const now = new Date("2026-10-01T08:00:00Z");
const actor: Actor = {
  userId: H,
  isActive: true,
  isHospitalAdmin: false,
  memberships: [{ departmentId, role: "HEAD_NURSE" }],
  supervisedDepartmentIds: [],
};
const schedule: ScheduleRecord = {
  id: S,
  departmentId,
  period: { start: isoDate("2026-10-23"), end: isoDate("2026-11-21") },
  label: "آبان",
  status: "DRAFT",
  revision: 0,
  currentVersionId: null,
  staffingRuleSetVersionId: "40000000-0000-4000-8000-000000000001",
  createdBy: H,
};
const tx = {};
const transaction = vi.fn(
  async (work: (handle: typeof tx) => Promise<unknown>) => work(tx),
);
const ctx: AppContext = {
  db: { transaction } as unknown as Database,
  actor,
  clock: () => now,
};
const target = { scheduleId: S, date };
const read = () => readDailyPreferences(ctx, target);
const request = async () => {
  const p = await read();
  return {
    ...target,
    expectedRevision: p.revision,
    proof: p.proof,
    operation: { kind: "ONE" as const, nurseId: N },
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("AUTH_SECRET", "daily-preferences-unit-only-secret-0001");
  vi.mocked(findScheduleById).mockResolvedValue(schedule);
  vi.mocked(loadScheduleForAssignmentUpdate).mockResolvedValue(schedule);
  vi.mocked(loadActor).mockResolvedValue(actor);
  vi.mocked(findDepartmentById).mockResolvedValue({
    id: departmentId,
    code: "icu",
    name: "ICU",
    timezone: "Asia/Tehran",
    isActive: true,
  });
  vi.mocked(listRosterAssignments).mockResolvedValue({
    assignments: [],
    roster: [
      { userId: N, displayName: "پرستار", personnelNumber: "1", role: "NURSE" },
    ],
  });
  vi.mocked(listPreferences).mockResolvedValue([
    { userId: N, date, value: "ME" },
  ]);
  vi.mocked(listImportPeriodMembers).mockResolvedValue([
    {
      userId: N,
      displayName: "پرستار",
      personnelNumber: "001",
      isActive: true,
      role: "NURSE",
      startedOn: schedule.period.start,
      endedOn: null,
    },
  ]);
  vi.mocked(listAdjacentAssignments).mockResolvedValue([]);
  vi.mocked(loadRuleSet).mockResolvedValue({
    version: {
      id: schedule.staffingRuleSetVersionId,
      ruleSetId: "rules",
      departmentId,
      versionNo: 1,
      status: "PUBLISHED",
      effectiveFrom: isoDate("2000-01-01"),
      note: null,
      origin: "USER",
      revision: 0,
      basedOnVersionId: null,
      createdBy: H,
      createdAt: now,
      publishedBy: H,
      publishedAt: now,
      retiredBy: null,
      retiredAt: null,
      retiredReason: null,
      replacedByVersionId: null,
    },
    content: {
      normal: {
        M: { min: 1, max: null },
        E: { min: 1, max: null },
        N: { min: 1, max: null },
      },
      holiday: {},
      exceptions: [],
    },
  });
  vi.mocked(lockImportMemberships).mockResolvedValue(undefined);
  vi.mocked(saveSchedule).mockResolvedValue({ ...schedule, revision: 1 });
  vi.mocked(writeAssignmentChanges).mockResolvedValue(undefined);
  vi.mocked(recordAuditEvent).mockResolvedValue(undefined);
});

describe("daily preference application boundaries", () => {
  it("canonicalizes valid uppercase schedule and exclusion UUIDs before proof checks and selection", async () => {
    const p = await readDailyPreferences(ctx, {
      ...target,
      scheduleId: S.toUpperCase(),
    });
    expect(findScheduleById).toHaveBeenCalledWith(tx, S);
    expect(
      await acceptDailyPreferences(ctx, {
        ...target,
        scheduleId: S.toUpperCase(),
        expectedRevision: p.revision,
        proof: p.proof,
        operation: { kind: "BULK", excludedNurseIds: [N.toUpperCase()] },
      }),
    ).toMatchObject({
      ok: true,
      data: {
        createdAssignmentCount: 0,
        skippedSuggestions: [{ nurseId: N, reason: "SESSION_EXCLUDED" }],
      },
    });
    expect(writeAssignmentChanges).not.toHaveBeenCalled();
  });

  it("canonicalizes an individual nurse UUID instead of treating it as a different identity", async () => {
    const raw = await request();
    expect(
      await acceptDailyPreferences(ctx, {
        ...raw,
        operation: { kind: "ONE", nurseId: N.toUpperCase() },
      }),
    ).toMatchObject({
      ok: true,
      data: {
        createdAssignmentCount: 1,
        outcomes: [{ nurseId: N, outcome: "CREATED" }],
      },
    });
  });

  it("uses one read-only repeatable-read snapshot and never invokes a writer for preview", async () => {
    const p = await read();
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "repeatable read",
      accessMode: "read only",
    });
    expect(loadActor).toHaveBeenCalledWith(tx, H, isoDate("2026-10-01"));
    expect(listAdjacentAssignments).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        nurseIds: [N],
        dates: [isoDate("2026-10-22"), isoDate("2026-11-22")],
      }),
    );
    expect(loadRuleSet).toHaveBeenCalledWith(
      tx,
      schedule.staffingRuleSetVersionId,
    );
    expect(p.groups.find((g) => g.shift === "ME")).toMatchObject({
      bulkEligible: true,
      suggestions: [{ displayName: "پرستار", status: "ELIGIBLE" }],
    });
    expect(writeAssignmentChanges).not.toHaveBeenCalled();
    expect(saveSchedule).not.toHaveBeenCalled();
    expect(recordAuditEvent).not.toHaveBeenCalled();
  });

  it("takes the schedule locks before protecting eligibility and reloading authority", async () => {
    const raw = await request();
    vi.clearAllMocks();
    expect(await acceptDailyPreferences(ctx, raw)).toMatchObject({
      ok: true,
      data: { createdAssignmentCount: 1, revision: 1 },
    });
    const order = [
      loadScheduleForAssignmentUpdate,
      lockImportMemberships,
      loadActor,
      listPreferences,
      writeAssignmentChanges,
      saveSchedule,
      recordAuditEvent,
    ].map((fn) => vi.mocked(fn).mock.invocationCallOrder[0]!);
    expect(order).toEqual(order.toSorted((a, b) => a - b));
    expect(writeAssignmentChanges).toHaveBeenCalledWith(
      expect.anything(),
      schedule,
      [{ nurseId: N, date, before: null, after: "ME" }],
      { insertOnly: true, source: "PREFILL" },
    );
  });

  it.each([
    { expectedRevision: -1 },
    { proof: {} },
    { operation: { kind: "UNKNOWN" } },
    { operation: { kind: "ONE", nurseId: "not-a-uuid" } },
  ])(
    "refuses malformed acceptance without opening a transaction (%j)",
    async (overrides) => {
      const raw = await request();
      transaction.mockClear();
      expect(
        await acceptDailyPreferences(ctx, { ...raw, ...overrides }),
      ).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
      expect(transaction).not.toHaveBeenCalled();
    },
  );

  it("rejects malformed preview input before any database work", async () => {
    await expect(
      readDailyPreferences(ctx, { scheduleId: "invalid", date }),
    ).rejects.toThrow();
    expect(transaction).not.toHaveBeenCalled();
  });

  it("classifies schedule loading failures as infrastructure errors", async () => {
    const raw = await request();
    vi.mocked(loadScheduleForAssignmentUpdate).mockRejectedValueOnce(
      new Error("database unavailable"),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await acceptDailyPreferences(ctx, raw)).toMatchObject({
      ok: false,
      error: { code: "INTERNAL" },
    });
    expect(writeAssignmentChanges).not.toHaveBeenCalled();
  });

  it("fails closed if the signing secret is unavailable", async () => {
    vi.stubEnv("AUTH_SECRET", "");
    await expect(read()).rejects.toThrow("AUTH_SECRET");
    expect(writeAssignmentChanges).not.toHaveBeenCalled();
  });

  it("returns an infrastructure failure without a success payload when persistence fails", async () => {
    const raw = await request();
    vi.mocked(writeAssignmentChanges).mockRejectedValueOnce(
      new Error("storage failed"),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await acceptDailyPreferences(ctx, raw);
    expect(result).toEqual({
      ok: false,
      error: { code: "INTERNAL", message: "Something went wrong" },
    });
    expect(saveSchedule).not.toHaveBeenCalled();
    expect(recordAuditEvent).not.toHaveBeenCalled();
  });

  it("preserves the planner's aggregate hard-conflict refusal rather than selecting a subset", async () => {
    const raw = await request();
    const original = planner.planDailyPreferences;
    vi.spyOn(planner, "planDailyPreferences").mockImplementation((input) => {
      const result = original(input);
      const violation = {
        rule: "NIGHT_REST" as const,
        severity: "error" as const,
        nurseId: N,
        date,
        nightDate: isoDate("2026-10-23"),
        shift: "ME" as const,
      };
      return {
        ...result,
        proposed: [],
        assessment: {
          ...result.assessment,
          blocked: true,
          blocking: [violation],
        },
      };
    });
    expect(
      await acceptDailyPreferences(ctx, {
        ...raw,
        operation: { kind: "BULK", excludedNurseIds: [] },
      }),
    ).toMatchObject({
      ok: false,
      error: {
        code: "RULE_VIOLATION",
        violations: [expect.objectContaining({ rule: "NIGHT_REST" })],
      },
    });
    expect(writeAssignmentChanges).not.toHaveBeenCalled();
  });
});
