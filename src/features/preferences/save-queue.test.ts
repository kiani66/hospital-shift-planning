import { describe, expect, it, vi } from "vitest";

import {
  createPreferenceSaver,
  type PreferenceChoice,
  type SaveResult,
} from "./save-queue";

/** A fake server: every send waits until the test resolves it. */
function fakeServer() {
  const calls: {
    value: PreferenceChoice;
    resolve: (result: SaveResult) => void;
    reject: (error: unknown) => void;
  }[] = [];
  const send = vi.fn(
    (value: PreferenceChoice) =>
      new Promise<SaveResult>((resolve, reject) =>
        calls.push({ value, resolve, reject }),
      ),
  );
  const ok = async (i: number) => {
    calls[i]!.resolve({ ok: true, value: calls[i]!.value });
    await flush();
  };
  const fail = async (i: number, retryable = true) => {
    calls[i]!.resolve({ ok: false, message: "بسته شد", retryable });
    await flush();
  };
  return { calls, send, ok, fail };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("createPreferenceSaver", () => {
  it("shows the choice while saving, then the confirmed value", async () => {
    const server = fakeServer();
    const confirmed = vi.fn();
    const saver = createPreferenceSaver(null, server.send, confirmed);
    saver.choose("M");
    expect(saver.getState()).toMatchObject({ shown: "M", phase: "saving" });
    await server.ok(0);
    expect(saver.getState()).toMatchObject({
      shown: "M",
      confirmed: "M",
      phase: "saved",
      failure: null,
    });
    expect(confirmed).toHaveBeenCalledWith("M");
    saver.settle();
    expect(saver.getState().phase).toBe("idle");
  });

  it("replaces and clears a preference", async () => {
    const server = fakeServer();
    const saver = createPreferenceSaver("M", server.send);
    saver.choose("E");
    await server.ok(0);
    saver.choose(null);
    await server.ok(1);
    expect(server.calls.map((c) => c.value)).toEqual(["E", null]);
    expect(saver.getState()).toMatchObject({ shown: null, confirmed: null });
  });

  it("never sends the shown value again (no duplicate submissions)", async () => {
    const server = fakeServer();
    const saver = createPreferenceSaver(null, server.send);
    saver.choose("N");
    saver.choose("N");
    await server.ok(0);
    saver.choose("N");
    expect(server.send).toHaveBeenCalledTimes(1);
  });

  it("rapid taps: one request at a time, only the latest queued choice is sent", async () => {
    const server = fakeServer();
    const saver = createPreferenceSaver(null, server.send);
    saver.choose("M");
    saver.choose("E");
    saver.choose("N");
    saver.choose("ME");
    expect(server.send).toHaveBeenCalledTimes(1);
    expect(saver.getState()).toMatchObject({ shown: "ME", phase: "saving" });
    // The stale response for M does not overwrite the latest choice.
    await server.ok(0);
    expect(saver.getState()).toMatchObject({
      shown: "ME",
      confirmed: "M",
      phase: "saving",
    });
    expect(server.calls.map((c) => c.value)).toEqual(["M", "ME"]);
    await server.ok(1);
    expect(saver.getState()).toMatchObject({
      shown: "ME",
      confirmed: "ME",
      phase: "saved",
    });
  });

  it("rapid taps back to the value in flight send nothing more", async () => {
    const server = fakeServer();
    const saver = createPreferenceSaver(null, server.send);
    saver.choose("M");
    saver.choose("E");
    saver.choose("M");
    await server.ok(0);
    expect(server.send).toHaveBeenCalledTimes(1);
    expect(saver.getState()).toMatchObject({
      shown: "M",
      confirmed: "M",
      phase: "saved",
    });
  });

  it("a failure falls back to the stored value and never claims it saved", async () => {
    const server = fakeServer();
    const confirmed = vi.fn();
    const saver = createPreferenceSaver("E", server.send, confirmed);
    saver.choose("N");
    await server.fail(0);
    expect(saver.getState()).toEqual({
      shown: "E",
      confirmed: "E",
      phase: "error",
      failure: { value: "N", message: "بسته شد", retryable: true },
    });
    expect(confirmed).not.toHaveBeenCalled();
  });

  it("retry sends the failed choice again", async () => {
    const server = fakeServer();
    const saver = createPreferenceSaver(null, server.send);
    saver.choose("OFF");
    await server.fail(0);
    saver.retry();
    expect(saver.getState()).toMatchObject({ shown: "OFF", phase: "saving" });
    await server.ok(1);
    expect(saver.getState()).toMatchObject({
      shown: "OFF",
      confirmed: "OFF",
      phase: "saved",
    });
    saver.retry();
    expect(server.send).toHaveBeenCalledTimes(2);
  });

  it("a rejected request (network) is a retryable failure", async () => {
    const server = fakeServer();
    const saver = createPreferenceSaver(null, server.send);
    saver.choose("M");
    server.calls[0]!.reject(new Error("offline"));
    await flush();
    expect(saver.getState()).toMatchObject({
      shown: null,
      phase: "error",
      failure: { value: "M", retryable: true },
    });
    const throwing = createPreferenceSaver(null, () => {
      throw new Error("sync");
    });
    throwing.choose("E");
    await flush();
    expect(throwing.getState().phase).toBe("error");
  });

  it("a failure followed by a queued choice still saves the latest choice", async () => {
    const server = fakeServer();
    const saver = createPreferenceSaver(null, server.send);
    saver.choose("M");
    saver.choose("E");
    await server.fail(0);
    expect(saver.getState()).toMatchObject({ shown: "E", phase: "saving" });
    await server.ok(1);
    expect(saver.getState()).toMatchObject({
      shown: "E",
      confirmed: "E",
      phase: "saved",
      failure: null,
    });
  });

  it("choosing the stored value after an error clears the error without a request", async () => {
    const server = fakeServer();
    const saver = createPreferenceSaver("M", server.send);
    saver.choose("E");
    await server.fail(0);
    saver.choose("M");
    expect(saver.getState()).toMatchObject({
      shown: "M",
      phase: "idle",
      failure: null,
    });
    expect(server.send).toHaveBeenCalledTimes(1);
  });

  it("applies a newer server value only while idle", async () => {
    const server = fakeServer();
    const saver = createPreferenceSaver(null, server.send);
    saver.choose("M");
    saver.sync("N");
    expect(saver.getState().shown).toBe("M");
    await server.ok(0);
    saver.sync("N");
    expect(saver.getState()).toMatchObject({ shown: "N", confirmed: "N" });
    const listener = vi.fn();
    const unsubscribe = saver.subscribe(listener);
    saver.sync("N");
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
});
