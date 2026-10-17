import { describe, expect, it } from "vitest";

import {
  databaseTarget,
  decideMigration,
  PREVIEW_APPROVAL_VARIABLE,
  previewApproval,
} from "./migration-guard";

const URL_A = "postgresql://owner:s3cr3t@ep-preview-1.example.com/neondb";
const TARGET_A = "ep-preview-1.example.com/neondb";
const URL_PROD = "postgresql://owner:s3cr3t@ep-main-1.example.com/neondb";
const BRANCH = "claude/excel-template-export";
const APPROVAL_A = `${BRANCH}@${TARGET_A}`;

const preview = (extra: Record<string, string> = {}) => ({
  VERCEL: "1",
  VERCEL_ENV: "preview",
  VERCEL_GIT_COMMIT_REF: BRANCH,
  DATABASE_URL_UNPOOLED: URL_A,
  ...extra,
});

describe("databaseTarget / previewApproval", () => {
  it("keeps host, port and database; drops credentials and query", () => {
    expect(
      databaseTarget(
        "postgresql://u:pw@EP-1.Example.com:6543/neondb?sslmode=require",
      ),
    ).toBe("ep-1.example.com:6543/neondb");
  });

  it("binds an approval to a git branch and a destination", () => {
    expect(previewApproval(BRANCH, TARGET_A)).toBe(APPROVAL_A);
  });
});

describe("decideMigration", () => {
  it("migrates locally and in CI (no Vercel variables)", () => {
    expect(decideMigration({ DATABASE_URL: URL_A })).toEqual({
      action: "run",
      reason: "local-or-ci",
    });
  });

  it("migrates in Vercel Production without any approval (behavior unchanged)", () => {
    expect(
      decideMigration({
        VERCEL: "1",
        VERCEL_ENV: "production",
        DATABASE_URL_UNPOOLED: URL_PROD,
      }),
    ).toEqual({ action: "run", reason: "production" });
  });

  it("still honors SKIP_DB_MIGRATIONS=1 everywhere", () => {
    for (const env of [
      { SKIP_DB_MIGRATIONS: "1" },
      { SKIP_DB_MIGRATIONS: "1", VERCEL: "1", VERCEL_ENV: "production" },
      preview({
        SKIP_DB_MIGRATIONS: "1",
        [PREVIEW_APPROVAL_VARIABLE]: APPROVAL_A,
      }),
    ])
      expect(decideMigration(env)).toEqual({
        action: "skip",
        reason: "explicit-skip",
      });
  });

  it("skips a Preview build that has no approval", () => {
    expect(decideMigration(preview())).toEqual({
      action: "skip",
      reason: "preview-unapproved",
      target: TARGET_A,
      branch: BRANCH,
    });
  });

  it("treats a blank approval as no approval", () => {
    expect(
      decideMigration(preview({ [PREVIEW_APPROVAL_VARIABLE]: "  " })),
    ).toMatchObject({ action: "skip", reason: "preview-unapproved" });
  });

  it("skips a Preview with no database configured, without throwing", () => {
    expect(
      decideMigration({
        VERCEL: "1",
        VERCEL_ENV: "preview",
        VERCEL_GIT_COMMIT_REF: BRANCH,
        [PREVIEW_APPROVAL_VARIABLE]: APPROVAL_A,
      }),
    ).toEqual({
      action: "skip",
      reason: "preview-unapproved",
      target: undefined,
      branch: BRANCH,
    });
  });

  it("skips a Preview whose git branch is unknown (for example a CLI deployment)", () => {
    const env: Record<string, string | undefined> = preview({
      [PREVIEW_APPROVAL_VARIABLE]: APPROVAL_A,
    });
    delete env.VERCEL_GIT_COMMIT_REF;
    expect(decideMigration(env)).toMatchObject({
      action: "skip",
      reason: "preview-unapproved",
      target: TARGET_A,
      branch: undefined,
    });
  });

  it("skips when the destination changed after approval (Neon branch recreated or re-pointed)", () => {
    expect(
      decideMigration({
        ...preview({ [PREVIEW_APPROVAL_VARIABLE]: APPROVAL_A }),
        DATABASE_URL_UNPOOLED: URL_PROD,
      }),
    ).toEqual({
      action: "skip",
      reason: "preview-stale-approval",
      target: "ep-main-1.example.com/neondb",
      branch: BRANCH,
    });
  });

  it("does not let an approval for one Preview branch authorize another", () => {
    expect(
      decideMigration(
        preview({
          [PREVIEW_APPROVAL_VARIABLE]: APPROVAL_A,
          VERCEL_GIT_COMMIT_REF: "claude/another-pr",
        }),
      ),
    ).toMatchObject({ action: "skip", reason: "preview-stale-approval" });
  });

  it("rejects approvals that are not the exact branch@destination value", () => {
    for (const approved of [
      TARGET_A,
      "ep-preview-1.example.com",
      "neondb",
      BRANCH,
      "1",
      "true",
      "*",
      APPROVAL_A.toUpperCase(),
    ])
      expect(
        decideMigration(preview({ [PREVIEW_APPROVAL_VARIABLE]: approved })),
      ).toMatchObject({ action: "skip", reason: "preview-stale-approval" });
  });

  it("runs a Preview only for the exact approved branch and destination", () => {
    expect(
      decideMigration(preview({ [PREVIEW_APPROVAL_VARIABLE]: APPROVAL_A })),
    ).toEqual({ action: "run", reason: "approved-preview" });
    expect(
      decideMigration(
        preview({ [PREVIEW_APPROVAL_VARIABLE]: ` ${APPROVAL_A} ` }),
      ),
    ).toEqual({ action: "run", reason: "approved-preview" });
  });

  it("guards the same URL the migration uses (unpooled first, then pooled)", () => {
    expect(
      decideMigration({
        ...preview({ [PREVIEW_APPROVAL_VARIABLE]: APPROVAL_A }),
        DATABASE_URL: URL_A,
        DATABASE_URL_UNPOOLED: URL_PROD,
      }),
    ).toMatchObject({ action: "skip", reason: "preview-stale-approval" });
    const env: Record<string, string | undefined> = preview({
      [PREVIEW_APPROVAL_VARIABLE]: APPROVAL_A,
    });
    delete env.DATABASE_URL_UNPOOLED;
    expect(decideMigration({ ...env, DATABASE_URL: URL_A })).toEqual({
      action: "run",
      reason: "approved-preview",
    });
  });

  it("fails closed for development, custom, unknown and missing VERCEL_ENV", () => {
    for (const env of [
      { VERCEL: "1", VERCEL_ENV: "development" },
      { VERCEL: "1", VERCEL_ENV: "staging" },
      { VERCEL: "1", VERCEL_ENV: "Production" },
      { VERCEL: "1", VERCEL_ENV: "" },
      { VERCEL: "1" },
      { VERCEL_ENV: "preview" },
    ])
      expect(
        decideMigration({
          ...env,
          VERCEL_GIT_COMMIT_REF: BRANCH,
          DATABASE_URL_UNPOOLED: URL_PROD,
        }),
      ).toMatchObject({ action: "skip", reason: "preview-unapproved" });
  });

  it("never exposes credentials in its result", () => {
    expect(JSON.stringify(decideMigration(preview()))).not.toContain("s3cr3t");
  });
});
