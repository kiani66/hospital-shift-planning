import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

/**
 * Runs the real `scripts/db-migrate.ts` against a closed port. A run that skips
 * exits 0 without connecting; any attempt to migrate would fail with ECONNREFUSED.
 */
function runScript(extra: Record<string, string>) {
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: "test",
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    DATABASE_URL_UNPOOLED: "postgresql://u:pw@127.0.0.1:1/hsp_guard",
    ...extra,
  };
  const result = spawnSync("node_modules/.bin/tsx", ["scripts/db-migrate.ts"], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
    timeout: 60_000,
  });
  return { status: result.status, out: result.stdout + result.stderr };
}

describe("scripts/db-migrate.ts guard", () => {
  it("skips an unapproved Preview build without connecting", () => {
    const { status, out } = runScript({
      VERCEL: "1",
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_REF: "feature/x",
    });
    expect(status).toBe(0);
    expect(out).toContain("skipped: non-production Vercel build");
    expect(out).toContain("branch feature/x");
    expect(out).toContain("127.0.0.1:1/hsp_guard");
    expect(out).not.toContain("pw@");
    expect(out).not.toContain("up to date");
  });

  it("skips a Preview whose approval names another database", () => {
    const { status, out } = runScript({
      VERCEL: "1",
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_REF: "feature/x",
      PREVIEW_MIGRATION_APPROVAL: "feature/x@ep-other.example.com/neondb",
    });
    expect(status).toBe(0);
    expect(out).toContain("does not match this build");
  });

  it("attempts the migration for the approved Preview destination", () => {
    const { status, out } = runScript({
      VERCEL: "1",
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_REF: "feature/x",
      PREVIEW_MIGRATION_APPROVAL: "feature/x@127.0.0.1:1/hsp_guard",
    });
    expect(out).toContain("(approved-preview)");
    expect(status).toBe(1); // closed port: proves the migration path was entered
  });

  it("attempts the migration in Production without an approval variable", () => {
    const { status, out } = runScript({
      VERCEL: "1",
      VERCEL_ENV: "production",
    });
    expect(out).toContain("(production)");
    expect(status).toBe(1);
  });
});
