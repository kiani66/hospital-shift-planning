import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { refresh } from "next/cache";
import type { ActionError } from "@/application/result";
import {
  assignCoverageCandidate,
  getCoverageCandidates,
  type CoverageCandidates,
} from "@/application/schedules/coverage-candidates";
import { requireRequestContext } from "@/features/auth/guards";
import { isoDate } from "@/domain/shared/dates";
import { Button } from "@/components/ui/button";
import { assignCoverageCandidateAction } from "./actions";
import { CandidateList } from "./candidate-list";
import { OffConfirmation } from "./off-confirmation";
import {
  candidateAssignLabel,
  candidateCompletionMessage,
  candidateWriteFailure,
  candidateWriteFindings,
  needsOffConfirmation,
  offReplacementMessage,
} from "./presentation";
import { SHIFT_LABELS } from "../../../tests/support/shift-labels";

vi.mock("next/cache", () => ({ refresh: vi.fn() }));
vi.mock("@/features/auth/guards", () => ({ requireRequestContext: vi.fn() }));
vi.mock("@/application/schedules/coverage-candidates", async () => ({
  ...(await vi.importActual("@/application/schedules/coverage-candidates")),
  assignCoverageCandidate: vi.fn(),
  getCoverageCandidates: vi.fn(),
}));
const date = isoDate("2026-10-25");
const period = { start: isoDate("2026-10-23"), end: isoDate("2026-11-21") };
const id = "00000000-0000-4000-8000-000000000001";
const person = {
  userId: id,
  displayName: "مریم نمونه",
  personnelNumber: null,
  dayStatus: "UNASSIGNED" as const,
  preference: "OFF_PREFERENCE" as const,
  requiresOffReplacement: false,
};
const data: Extract<CoverageCandidates, { status: "SHORTAGE" }> = {
  scheduleId: id,
  revision: 17,
  date,
  shift: "N",
  coverage: {
    period: "N",
    covered: 1,
    bounds: { min: 3 },
    status: "BELOW_MINIMUM",
    gap: 2,
  },
  status: "SHORTAGE",
  canAssign: true,
  assignDenial: null,
  available: [person],
  notAllowed: [],
};
const input = {
  scheduleId: id,
  expectedRevision: 17,
  date,
  shift: "N",
  nurseId: id,
};
const ctx = { actor: { trusted: true } };
const render = (value: CoverageCandidates, pending = false) =>
  renderToStaticMarkup(
    createElement(CandidateList, {
      shiftLabels: SHIFT_LABELS,
      data: value,
      assignControl: (candidate) =>
        createElement(
          Button,
          {
            disabled: pending,
            "aria-label": `${candidateAssignLabel(value.shift, SHIFT_LABELS)} برای ${candidate.displayName}`,
          },
          candidateAssignLabel(value.shift, SHIFT_LABELS),
        ),
    }),
  );
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireRequestContext).mockResolvedValue(ctx as never);
});

describe("Candidate assignment boundary", () => {
  it("forwards the exact read revision and only validated write fields; refreshes the page on success", async () => {
    vi.mocked(assignCoverageCandidate).mockResolvedValue({
      ok: true,
      data: {},
    } as never);
    expect(
      await assignCoverageCandidateAction({
        ...input,
        expectedRevision: 17,
        rank: 2,
        actor: "forged",
        score: 100,
      }),
    ).toEqual({ ok: true });
    expect(assignCoverageCandidate).toHaveBeenCalledExactlyOnceWith(ctx, input);
    expect(getCoverageCandidates).not.toHaveBeenCalled(); // no pre-write revision substitution
    expect(refresh).toHaveBeenCalledOnce();
  });
  it.each([
    { ...input, shift: "ME" },
    { ...input, date: "bad" },
    { ...input, nurseId: "bad" },
    { ...input, expectedRevision: -1 },
    { ...input, expectedRevision: "17" },
    { ...input, scheduleId: "bad" },
  ])("rejects invalid write input", async (value) => {
    const result = await assignCoverageCandidateAction(value);
    expect(result).toMatchObject({ ok: false, kind: "INVALID" });
    expect(assignCoverageCandidate).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });
  it.each([
    ["NO_SHORTAGE", "NO_SHORTAGE", "قبلاً برطرف"],
    [undefined, "STALE", "فهرست تغییر"],
    ["NOT_A_CANDIDATE", "UNAVAILABLE", "دیگر برای این شیفت"],
    ["CANDIDATE_ALREADY_WORKING", "WORKING", "قبلاً شیفت کاری"],
  ])("maps conflict %s safely and refreshes", async (reason, kind, message) => {
    vi.mocked(assignCoverageCandidate).mockResolvedValue({
      ok: false,
      error: { code: "CONFLICT", reason, message: "internal details" },
    });
    expect(await assignCoverageCandidateAction(input)).toMatchObject({
      ok: false,
      kind,
      message: expect.stringContaining(message!),
      refresh: true,
    });
    expect(refresh).toHaveBeenCalledOnce();
    expect(assignCoverageCandidate).toHaveBeenCalledOnce();
  });
  it("preserves structured rule violations and refreshes", async () => {
    const violations = [
      {
        rule: "NIGHT_REST" as const,
        severity: "error" as const,
        nurseId: id,
        nightDate: isoDate("2026-10-24"),
        date,
        shift: "N" as const,
      },
    ];
    vi.mocked(assignCoverageCandidate).mockResolvedValue({
      ok: false,
      error: { code: "RULE_VIOLATION", message: "raw", violations },
    });
    expect(await assignCoverageCandidateAction(input)).toMatchObject({
      ok: false,
      kind: "RULE",
      violations,
      refresh: true,
    });
    const findings = candidateWriteFindings(violations, period, person);
    expect(findings[0]!.nurses[0]!.displayName).toBe(person.displayName);
    const html = render({
      ...data,
      available: [],
      notAllowed: [{ ...person, findings }],
    });
    expect(html).toContain("استراحت");
    expect(html).not.toContain(id);
    expect(html).not.toContain("NIGHT_REST");
  });
  it.each(["FORBIDDEN", "NOT_FOUND", "INVALID_STATE"] as const)(
    "maps %s without leaking reasons",
    async (code) => {
      vi.mocked(assignCoverageCandidate).mockResolvedValue({
        ok: false,
        error: { code, message: "private", reason: "administrative detail" },
      });
      const result = await assignCoverageCandidateAction(input);
      expect(result).toMatchObject({ ok: false, refresh: true });
      expect(JSON.stringify(result)).not.toMatch(/private|administrative/);
      expect(refresh).toHaveBeenCalledOnce();
    },
  );
  it("sanitizes an unexpected thrown failure without claiming success or refreshing", async () => {
    vi.mocked(assignCoverageCandidate).mockRejectedValue(
      new Error("secret SQL"),
    );
    const result = await assignCoverageCandidateAction(input);
    expect(result).toMatchObject({ ok: false, kind: "SERVER", refresh: false });
    expect(JSON.stringify(result)).not.toContain("secret SQL");
    expect(refresh).not.toHaveBeenCalled();
  });
  it("sanitizes an INTERNAL command result", async () => {
    vi.mocked(assignCoverageCandidate).mockResolvedValue({
      ok: false,
      error: { code: "INTERNAL", message: "secret SQL" },
    });
    const result = await assignCoverageCandidateAction(input);
    expect(result).toMatchObject({ ok: false, kind: "SERVER", refresh: false });
    expect(JSON.stringify(result)).not.toContain("secret SQL");
  });
  it("preserves authentication redirects", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    vi.mocked(requireRequestContext).mockRejectedValue(redirect);
    await expect(assignCoverageCandidateAction(input)).rejects.toBe(redirect);
    expect(assignCoverageCandidate).not.toHaveBeenCalled();
  });
});

describe("Candidate assignment presentation", () => {
  it("shows the target assignment only for Available when canAssign", () => {
    expect(render(data)).toContain("تخصیص شیفت شب");
    expect(render(data)).toContain(`تخصیص شیفت شب برای ${person.displayName}`);
    expect(
      render({ ...data, canAssign: false, assignDenial: "NOT_AUTHORIZED" }),
    ).not.toContain("<button");
    expect(
      render({
        ...data,
        available: [],
        notAllowed: [{ ...person, findings: [] }],
      }),
    ).not.toContain("<button");
  });
  it.each([
    "SCHEDULE_LOCKED",
    "DATE_OUTSIDE_REVISION_SCOPE",
    "NOT_AUTHORIZED",
  ] as const)("has no assignment controls for denial %s", (assignDenial) => {
    expect(render({ ...data, canAssign: false, assignDenial })).not.toContain(
      "<button",
    );
  });
  it("disables all Available actions while pending, keeping candidates intact", () => {
    const html = render(
      {
        ...data,
        available: [
          person,
          { ...person, userId: "other", displayName: "پرستار دوم" },
        ],
      },
      true,
    );
    expect((html.match(/disabled=""/g) ?? []).length).toBe(2);
    expect(html).toContain(person.displayName);
    expect(html).toContain("پرستار دوم");
  });
  it("UNASSIGNED including OFF preference does not require OFF confirmation", () => {
    expect(needsOffConfirmation(person)).toBe(false);
    const withoutOffPreference = { ...person, preference: "NONE" as const };
    expect(needsOffConfirmation(withoutOffPreference)).toBe(false);
  });
  it("OFF assignment or explicit replacement flag requires confirmation", () => {
    expect(
      needsOffConfirmation({ ...person, dayStatus: "OFF_ASSIGNMENT" }),
    ).toBe(true);
    expect(
      needsOffConfirmation({ ...person, requiresOffReplacement: true }),
    ).toBe(true);
  });
  it.each(["M", "E", "N"] as const)(
    "names the OFF replacement and exact target %s in the dialog",
    (shift) => {
      const html = renderToStaticMarkup(
        createElement(OffConfirmation, {
          shiftLabels: SHIFT_LABELS,
          candidate: { ...person, dayStatus: "OFF_ASSIGNMENT" },
          date,
          shift,
          pending: false,
          onCancel: vi.fn(),
          onConfirm: vi.fn(),
        }),
      );
      expect(html).toContain("جایگزینی تصمیم OFF");
      expect(html).toContain(
        offReplacementMessage(person, date, shift, SHIFT_LABELS),
      );
      expect(html).toContain("OFF حذف");
      expect(html).toContain(candidateAssignLabel(shift, SHIFT_LABELS));
      expect(html).toContain("انصراف");
      expect(html).toContain("aria-describedby=");
      expect(html).not.toContain(id);
    },
  );
  it("pending confirmation disables Cancel and Confirm", () => {
    const html = renderToStaticMarkup(
      createElement(OffConfirmation, {
        shiftLabels: SHIFT_LABELS,
        candidate: person,
        date,
        shift: "N",
        pending: true,
        onCancel: vi.fn(),
        onConfirm: vi.fn(),
      }),
    );
    expect((html.match(/disabled=""/g) ?? []).length).toBe(2);
    expect(html).toContain("در حال تخصیص");
  });
  it("keeps backend ordering after refreshed results", () => {
    const html = render({
      ...data,
      revision: 18,
      available: [
        { ...person, userId: "z", displayName: "اول" },
        { ...person, userId: "a", displayName: "دوم" },
      ],
    });
    expect(html.indexOf("اول")).toBeLessThan(html.indexOf("دوم"));
  });
  it("resolved target names completion and contains no more assignment controls", () => {
    const html = render({ ...data, revision: 19, status: "NO_SHORTAGE" });
    expect(html).toContain(candidateCompletionMessage("N", SHIFT_LABELS));
    expect(html).toContain('role="status"');
    expect(html).not.toContain("<button");
  });
  it("does not render identifiers, hours, fairness, ranks or scores", () => {
    expect(render(data)).not.toMatch(/00000000|امتیاز|درصد|بهترین|ساعت|عدالت/);
  });
  it("does not return raw validation fields or internal messages", () => {
    const failure = candidateWriteFailure({
      code: "VALIDATION",
      message: "secret",
      fieldErrors: { nurseId: [id] },
    } as ActionError);
    expect(failure.kind).toBe("INVALID");
    expect(JSON.stringify(failure)).not.toMatch(/secret|00000000/);
  });
});
