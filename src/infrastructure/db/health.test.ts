import { describe, expect, it, vi } from "vitest";

import { EnvValidationError } from "../config/env-schema";
import { probeWithTimeout } from "./health";

describe("probeWithTimeout", () => {
  it("reports ok when the probe succeeds", async () => {
    await expect(probeWithTimeout(async () => {}, 100)).resolves.toBe("ok");
  });

  it("reports misconfigured when env validation fails", async () => {
    const probe = async () => {
      throw new EnvValidationError("Invalid environment variables");
    };
    await expect(probeWithTimeout(probe, 100)).resolves.toBe("misconfigured");
  });

  it("reports unavailable when the database errors", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const probe = async () => {
      throw new Error("connection refused");
    };
    await expect(probeWithTimeout(probe, 100)).resolves.toBe("unavailable");
  });

  it("reports unavailable when the probe exceeds the timeout", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const never = () => new Promise<void>(() => {});
    await expect(probeWithTimeout(never, 20)).resolves.toBe("unavailable");
  });
});
