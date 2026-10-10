import { describe, expect, it } from "vitest";
import {
  assertResetE2eDatabase,
  resetTestMaintenanceUrl,
} from "../../scripts/support/reset-e2e-safety";
const maintenance = {
  NODE_ENV: "test",
  FULL_RESET_TEST_DATABASE_URL:
    "postgresql://test:test@127.0.0.1:5432/postgres",
};
const target =
  "postgresql://test:test@127.0.0.1:5432/hsp_phase14_e2e_test_0123456789abcdef0123456789abcdef";
const isolated = {
  FULL_RESET_E2E: "1",
  DATABASE_URL: target,
  DATABASE_URL_UNPOOLED: target,
  TEST_DATABASE_URL: target,
};
describe("reset E2E ownership guards", () => {
  it("accepts only explicit local test maintenance and matching owned target URLs", () => {
    expect(resetTestMaintenanceUrl(maintenance).pathname).toBe("/postgres");
    expect(assertResetE2eDatabase(isolated)).toBe(target);
  });
  it.each([undefined, "development", "production"])(
    "refuses provisioning with NODE_ENV %s",
    (NODE_ENV) => {
      expect(() =>
        resetTestMaintenanceUrl({ ...maintenance, NODE_ENV }),
      ).toThrow();
    },
  );
  it.each(["VERCEL", "VERCEL_ENV"])(
    "refuses deployed environments through %s",
    (key) => {
      expect(() =>
        resetTestMaintenanceUrl({ ...maintenance, [key]: "preview" }),
      ).toThrow();
      expect(() =>
        assertResetE2eDatabase({ ...isolated, [key]: "preview" }),
      ).toThrow();
    },
  );
  it.each([
    "postgresql://test:test@localhost:5432/postgres",
    "postgresql://test:test@db.neon.tech/postgres",
    "postgresql://test:test@127.0.0.1:5432/hsp_test",
    "https://127.0.0.1/postgres",
    "postgresql://127.0.0.1/postgres?host=db.neon.tech",
    "postgresql://127.0.0.1/postgres#remote",
  ])("refuses unsafe maintenance source %s", (FULL_RESET_TEST_DATABASE_URL) => {
    expect(() =>
      resetTestMaintenanceUrl({ ...maintenance, FULL_RESET_TEST_DATABASE_URL }),
    ).toThrow();
  });
  it.each([
    target.replace("127.0.0.1", "localhost"),
    target.replace("127.0.0.1", "db.neon.tech"),
    target.replace(/hsp_phase14_e2e_test_.*/, "hsp_test"),
    target.replace("postgresql:", "https:"),
    target + "?host=db.neon.tech",
    target + "#remote",
  ])("refuses unsafe target %s", (DATABASE_URL) => {
    expect(() =>
      assertResetE2eDatabase({
        ...isolated,
        DATABASE_URL,
        DATABASE_URL_UNPOOLED: DATABASE_URL,
        TEST_DATABASE_URL: DATABASE_URL,
      }),
    ).toThrow();
  });
  it.each(["DATABASE_URL_UNPOOLED", "TEST_DATABASE_URL"])(
    "refuses mismatched %s",
    (key) => {
      expect(() =>
        assertResetE2eDatabase({
          ...isolated,
          [key]: "postgresql://127.0.0.1/hsp_test",
        }),
      ).toThrow();
    },
  );
  it("refuses missing test marker and external/reused servers", () => {
    expect(() =>
      assertResetE2eDatabase({ ...isolated, FULL_RESET_E2E: undefined }),
    ).toThrow();
    expect(() =>
      assertResetE2eDatabase({
        ...isolated,
        PLAYWRIGHT_BASE_URL: "http://localhost:3000",
      }),
    ).toThrow();
  });
});
