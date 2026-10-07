import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotFoundError } from "@/application/errors";
import { getCoverageCandidates } from "@/application/schedules/coverage-candidates";
import { requireRequestContext } from "@/features/auth/guards";
import { readCoverageCandidatesAction } from "./actions";
import { candidateAccessError, candidateQueryError } from "./presentation";
vi.mock("@/application/schedules/coverage-candidates", () => ({
  getCoverageCandidates: vi.fn(),
}));
vi.mock("@/features/auth/guards", () => ({ requireRequestContext: vi.fn() }));
const input = {
  scheduleId: "00000000-0000-4000-8000-000000000001",
  date: "2026-10-25",
  shift: "M",
};
const ctx = { actor: { trusted: true } };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireRequestContext).mockResolvedValue(ctx as never);
});
describe("candidate read boundary", () => {
  it.each(["M", "E", "N"])(
    "uses the trusted actor and exact target %s",
    async (shift) => {
      const data = { status: "NO_SHORTAGE" };
      vi.mocked(getCoverageCandidates).mockResolvedValue(data as never);
      expect(
        await readCoverageCandidatesAction({
          ...input,
          shift,
          actor: "forged",
        }),
      ).toEqual({ ok: true, data });
      expect(getCoverageCandidates).toHaveBeenCalledWith(ctx, {
        ...input,
        shift,
      });
    },
  );
  it.each([
    { ...input, shift: "ME" },
    { ...input, date: "bad" },
    { ...input, scheduleId: "bad" },
  ])("rejects malformed targets without querying", async (target) => {
    expect((await readCoverageCandidatesAction(target)).ok).toBe(false);
    expect(getCoverageCandidates).not.toHaveBeenCalled();
  });
  it("conceals missing/denied schedules", async () => {
    vi.mocked(getCoverageCandidates).mockRejectedValue(
      new NotFoundError("schedule"),
    );
    expect(await readCoverageCandidatesAction(input)).toEqual({
      ok: false,
      message: candidateAccessError,
    });
  });
  it("does not leak query errors", async () => {
    vi.mocked(getCoverageCandidates).mockRejectedValue(new Error("secret SQL"));
    expect(await readCoverageCandidatesAction(input)).toEqual({
      ok: false,
      message: candidateQueryError,
    });
  });
  it("preserves authentication redirects", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    vi.mocked(requireRequestContext).mockRejectedValue(redirect);
    await expect(readCoverageCandidatesAction(input)).rejects.toBe(redirect);
    expect(getCoverageCandidates).not.toHaveBeenCalled();
  });
});
