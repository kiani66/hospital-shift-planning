import { migrationDatabaseUrl } from "./env-schema";

/**
 * Decides whether `scripts/db-migrate.ts` may apply migrations. Kept free of
 * `server-only` and side effects so scripts and unit tests can import it.
 *
 * Local runs, CI and Vercel Production migrate as before. Every other Vercel build
 * (Preview, custom environments, an unknown or missing `VERCEL_ENV`) skips
 * migrations unless an operator approved that exact deployment and destination.
 *
 * The destination fingerprint is `host[:port]/database` of the URL the Neon
 * integration injected. It is a tripwire, not proof: a hostname does not establish
 * which Neon branch (or project) an endpoint belongs to, so the approval is only an
 * operator's attestation, made after checking the endpoint in the Neon console. The
 * authoritative check (branch id and parent through the Neon API or Vercel OIDC) is
 * deliberately not used here.
 */

export const PREVIEW_APPROVAL_VARIABLE = "PREVIEW_MIGRATION_APPROVAL";

export type MigrationDecision =
  | { action: "run"; reason: "local-or-ci" | "production" | "approved-preview" }
  | {
      action: "skip";
      reason: "explicit-skip" | "preview-unapproved" | "preview-stale-approval";
      /** `host[:port]/database` of the migration URL; absent when none is configured. */
      target?: string;
      /** Git branch of the Preview build (`VERCEL_GIT_COMMIT_REF`), when known. */
      branch?: string;
    };

/** Credential-free fingerprint: `host[:port]/database`, host lower-cased (database name is case-sensitive). */
export function databaseTarget(connectionString: string): string {
  const { host, pathname } = new URL(connectionString);
  return `${host.toLowerCase()}${pathname}`;
}

/** The approval value for one Preview branch and one destination: `<git branch>@<host[:port]/database>`. */
export function previewApproval(branch: string, target: string): string {
  return `${branch}@${target}`;
}

export function decideMigration(
  env: Readonly<Record<string, string | undefined>>,
): MigrationDecision {
  if (env.SKIP_DB_MIGRATIONS === "1")
    return { action: "skip", reason: "explicit-skip" };

  // Same "is this a deployed build" test as the reset E2E safety contract.
  if (!env.VERCEL && !env.VERCEL_ENV)
    return { action: "run", reason: "local-or-ci" };
  if (env.VERCEL_ENV === "production")
    return { action: "run", reason: "production" };

  let target: string | undefined;
  try {
    target = databaseTarget(migrationDatabaseUrl({ ...env }));
  } catch {
    target = undefined;
  }
  const branch = env.VERCEL_GIT_COMMIT_REF?.trim() || undefined;
  const expectedApproval =
    target !== undefined && branch !== undefined
      ? previewApproval(branch, target)
      : undefined;

  const approved = env[PREVIEW_APPROVAL_VARIABLE]?.trim();
  if (expectedApproval === undefined || !approved)
    return { action: "skip", reason: "preview-unapproved", target, branch };
  if (approved !== expectedApproval)
    return { action: "skip", reason: "preview-stale-approval", target, branch };
  return { action: "run", reason: "approved-preview" };
}
