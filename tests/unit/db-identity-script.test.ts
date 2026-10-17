import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

/**
 * Runs the real scripts. `db-migrate` is pointed at a closed port: it must skip
 * (Preview, unapproved) or fail to connect (Production), and the identity line
 * must appear only for Preview.
 */
function run(script: string, args: string[], env: Record<string, string>) {
  const result = spawnSync("node_modules/.bin/tsx", [script, ...args], {
    cwd: process.cwd(),
    env: {
      NODE_ENV: "test",
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      ...env,
    } as NodeJS.ProcessEnv,
    encoding: "utf8",
    timeout: 60_000,
  });
  return { status: result.status, out: result.stdout + result.stderr };
}

const DATABASE = "postgresql://leaky_user:S3CRET-pw@127.0.0.1:1/neondb";
const commit = "0123456789abcdef0123456789abcdef01234567";

describe("db-migrate identity diagnostic", () => {
  it("prints the identity line in a Preview build and still skips migration", () => {
    const { status, out } = run("scripts/db-migrate.ts", [], {
      VERCEL: "1",
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_REF: "feature/x",
      VERCEL_GIT_COMMIT_SHA: commit,
      VERCEL_DEPLOYMENT_ID: "dpl_SCRIPT",
      DATABASE_URL: DATABASE,
      DATABASE_URL_UNPOOLED: DATABASE,
    });
    expect(status).toBe(0);
    expect(out).toMatch(
      new RegExp(
        `\\[db:identity\\] v1 env=preview commit=${commit} deployment=dpl_SCRIPT pooled=[0-9a-f]{16} unpooled=[0-9a-f]{16}`,
      ),
    );
    expect(out).toContain("skipped: non-production Vercel build");
    expect(out).not.toContain("up to date");
    expect(out).not.toContain("S3CRET");
    expect(out).not.toContain("leaky_user");
  });

  it("prints nothing in Production (output unchanged)", () => {
    const { out } = run("scripts/db-migrate.ts", [], {
      VERCEL: "1",
      VERCEL_ENV: "production",
      VERCEL_GIT_COMMIT_SHA: commit,
      DATABASE_URL_UNPOOLED: DATABASE,
    });
    expect(out).not.toContain("[db:identity]");
    expect(out).toContain("(production)");
  });

  it("prints nothing locally or for custom environments", () => {
    const envs: Record<string, string>[] = [
      { DATABASE_URL_UNPOOLED: DATABASE, SKIP_DB_MIGRATIONS: "1" },
      {
        VERCEL: "1",
        VERCEL_ENV: "development",
        DATABASE_URL_UNPOOLED: DATABASE,
      },
    ];
    for (const env of envs)
      expect(run("scripts/db-migrate.ts", [], env).out).not.toContain(
        "[db:identity]",
      );
  });
});

describe("db-identity-verify CLI", () => {
  const preview = {
    VERCEL: "1",
    VERCEL_ENV: "preview",
    VERCEL_GIT_COMMIT_SHA: commit,
    VERCEL_DEPLOYMENT_ID: "dpl_CLI",
    DATABASE_URL:
      "postgresql://u:p@ep-cli-aaaa-pooler.region.example.tech/neondb",
    DATABASE_URL_UNPOOLED:
      "postgresql://u:p@ep-cli-aaaa.region.example.tech/neondb",
  };
  const line = run("scripts/db-migrate.ts", [], preview)
    .out.split("\n")
    .find((l) => l.startsWith("[db:identity]"))!;

  it("matches the authoritative hostnames and exits 0", () => {
    const { status, out } = run(
      "scripts/db-identity-verify.ts",
      [
        "--line",
        line,
        "--pooled-host",
        "ep-cli-aaaa-pooler.region.example.tech",
        "--unpooled-host",
        "ep-cli-aaaa.region.example.tech",
      ],
      {},
    );
    expect(out).toContain("pooled: MATCH");
    expect(out).toContain("unpooled: MATCH");
    expect(status).toBe(0);
  });

  it("exits 1 on a different endpoint", () => {
    const { status, out } = run(
      "scripts/db-identity-verify.ts",
      [
        "--line",
        line,
        "--pooled-host",
        "ep-other-bbbb-pooler.region.example.tech",
        "--unpooled-host",
        "ep-cli-aaaa.region.example.tech",
      ],
      {},
    );
    expect(out).toContain("pooled: MISMATCH");
    expect(out).toContain("unpooled: MATCH");
    expect(status).toBe(1);
  });

  it("refuses URLs, credentials and ports instead of hostnames", () => {
    for (const bad of [
      "postgresql://u:p@host/db",
      "user:pw@host",
      "host:5432",
      "host/db",
    ]) {
      const { status, out } = run(
        "scripts/db-identity-verify.ts",
        ["--line", line, "--pooled-host", bad, "--unpooled-host", "a.b"],
        {},
      );
      expect(status).toBe(2);
      expect(out).toContain("refused");
      expect(out).not.toContain("pw");
    }
  });
});
