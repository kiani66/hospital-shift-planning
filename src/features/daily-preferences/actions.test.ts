import { beforeEach, describe, expect, it, vi } from "vitest";
import { refresh } from "next/cache";
import {
  readDailyPreferences,
  acceptDailyPreferences,
} from "@/application/schedules/daily-preferences";
import { requireRequestContext } from "@/features/auth/guards";
import {
  readDailyPreferencesAction,
  acceptDailyPreferencesAction,
} from "./actions";
vi.mock("@/application/schedules/daily-preferences", async () => ({
  ...(await vi.importActual("@/application/schedules/daily-preferences")),
  readDailyPreferences: vi.fn(),
  acceptDailyPreferences: vi.fn(),
}));
vi.mock("next/cache", () => ({ refresh: vi.fn() }));
vi.mock("@/features/auth/guards", () => ({ requireRequestContext: vi.fn() }));
const target = {
  scheduleId: "00000000-0000-4000-8000-000000000001",
  date: "2026-10-25",
};
const write = {
  ...target,
  expectedRevision: 2,
  proof: {
    issuedAt: 1,
    fingerprint: "a".repeat(64),
    signature: "b".repeat(64),
  },
  operation: { kind: "ONE", nurseId: target.scheduleId },
};
const ctx = { actor: { trusted: true } };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireRequestContext).mockResolvedValue(ctx as never);
});
describe("daily preference action boundary", () => {
  it("passes only validated target and trusted context to preview", async () => {
    vi.mocked(readDailyPreferences).mockResolvedValue({ revision: 2 } as never);
    expect(
      await readDailyPreferencesAction({ ...target, actor: "forged" }),
    ).toEqual({ ok: true, data: { revision: 2 } });
    expect(readDailyPreferences).toHaveBeenCalledWith(ctx, target);
    expect(refresh).not.toHaveBeenCalled();
  });
  it.each([readDailyPreferencesAction, acceptDailyPreferencesAction])(
    "preserves authentication redirects",
    async (action) => {
      const error = new Error("NEXT_REDIRECT");
      vi.mocked(requireRequestContext).mockRejectedValue(error);
      await expect(action(target)).rejects.toBe(error);
    },
  );
  it("rejects invalid writes without invoking command", async () => {
    expect(
      (await acceptDailyPreferencesAction({ ...write, proof: null })).ok,
    ).toBe(false);
    expect(acceptDailyPreferences).not.toHaveBeenCalled();
  });
  it.each([
    write.operation,
    { kind: "BULK", excludedNurseIds: [target.scheduleId] },
  ])(
    "preserves snapshot and operation; strips authoritative client shifts",
    async (operation) => {
      const data = { revision: 3, createdAssignmentCount: 1 };
      vi.mocked(acceptDailyPreferences).mockResolvedValue({
        ok: true,
        data,
      } as never);
      expect(
        await acceptDailyPreferencesAction({
          ...write,
          operation,
          shift: "N",
          actor: "forged",
        }),
      ).toEqual({ ok: true, data });
      expect(acceptDailyPreferences).toHaveBeenCalledWith(ctx, {
        ...write,
        operation,
      });
      expect(refresh).toHaveBeenCalledOnce();
    },
  );
  it.each(["CONFLICT", "RULE_VIOLATION"] as const)(
    "refreshes %s without retrying a write",
    async (code) => {
      vi.mocked(acceptDailyPreferences).mockResolvedValue({
        ok: false,
        error: { code, message: "secret" },
      });
      const response = await acceptDailyPreferencesAction(write);
      expect(response).toMatchObject({ ok: false, reload: true });
      expect(JSON.stringify(response)).not.toContain("secret");
      expect(acceptDailyPreferences).toHaveBeenCalledOnce();
      expect(refresh).toHaveBeenCalledOnce();
    },
  );
  it.each(["FORBIDDEN", "NOT_FOUND", "INVALID_STATE", "INTERNAL"] as const)(
    "safely presents %s failures",
    async (code) => {
      vi.mocked(acceptDailyPreferences).mockResolvedValue({
        ok: false,
        error: { code, message: "secret" },
      });
      const response = await acceptDailyPreferencesAction(write);
      expect(response.ok).toBe(false);
      expect(JSON.stringify(response)).not.toContain("secret");
      expect(refresh).not.toHaveBeenCalled();
    },
  );
  it("conceals unexpected query and command failures", async () => {
    vi.mocked(readDailyPreferences).mockRejectedValue(new Error("secret SQL"));
    vi.mocked(acceptDailyPreferences).mockRejectedValue(
      new Error("secret SQL"),
    );
    expect(
      JSON.stringify(await readDailyPreferencesAction(target)),
    ).not.toContain("secret");
    expect(
      JSON.stringify(await acceptDailyPreferencesAction(write)),
    ).not.toContain("secret");
  });
});
