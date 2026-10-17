import { createHash } from "node:crypto";

import { migrationEnvSchema, parseEnv, serverEnvSchema } from "./env-schema";

/**
 * Preview-only database identity diagnostic.
 *
 * Prints a deterministic identifier of the host and database that a Preview
 * deployment's connection variables resolve to, bound to the deployment
 * environment, commit and deployment id. It exists so an operator can compare
 * the effective target with the authoritative Neon endpoint (which Vercel hides:
 * connection values are sensitive and redacted from build logs).
 *
 * What it is NOT: a secret, a MAC or an access-control boundary. Neon endpoint
 * hostnames are low-entropy and guessable, so anyone can recompute an unkeyed
 * hash of a guessed host. The identifier is a consistency check. Its integrity
 * rests on who can read the deployment's build log and on who can push the code
 * that prints it, not on the hash. It never contains credentials, the user, the
 * full URL or the hostname itself.
 *
 * It is silent unless `VERCEL_ENV === "preview"` and never throws.
 */

export const DB_IDENTITY_VERSION = "v1";
const LINE_PREFIX = "[db:identity]";
const UNKNOWN = "unknown";

export type DatabaseRole = "pooled" | "unpooled";

export type IdentityContext = {
  environment: string;
  commit: string;
  deployment: string;
};

export type EndpointParts = {
  hostname: string;
  port?: string;
  database: string;
};

/** First 16 hex characters of a SHA-256 over an unambiguous (JSON) encoding. */
export function endpointIdentity(
  role: DatabaseRole,
  endpoint: EndpointParts,
  context: IdentityContext,
): string {
  const input = JSON.stringify([
    "hsp-db-identity",
    DB_IDENTITY_VERSION,
    context.environment,
    context.commit,
    context.deployment,
    role,
    endpoint.hostname.toLowerCase(),
    endpoint.port || "5432",
    endpoint.database,
  ]);
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

export function endpointParts(connectionString: string): EndpointParts {
  const url = new URL(connectionString);
  return {
    // Non-special schemes (postgresql:) keep the host's case.
    hostname: url.hostname.toLowerCase(),
    port: url.port,
    database: decodeURIComponent(url.pathname.replace(/^\//, "")),
  };
}

function identityOf(
  role: DatabaseRole,
  read: () => string | undefined,
  context: IdentityContext,
): string {
  try {
    const value = read();
    if (value === undefined) return "unset";
    return endpointIdentity(role, endpointParts(value), context);
  } catch {
    // Never include the error: validation messages must not echo any value.
    return "unavailable";
  }
}

const HEX_IDENTIFIER = /^[0-9a-f]{16}$/;

/**
 * Sanitized failure notice. Missing, `unset`, `unavailable` or failed output is
 * absence of evidence, never evidence of isolation.
 */
export const DIAGNOSTIC_FAILED_LINE = `${LINE_PREFIX} ${DB_IDENTITY_VERSION} env=preview status=diagnostic-failed warning=not-evidence-of-isolation`;

/**
 * The log line for the current build, or `undefined` outside Preview.
 * `pooled` follows the runtime path (`getServerEnv()` parses the same schema);
 * `unpooled` is the connection `db:migrate` would use. In Preview it always
 * returns a line: a failure yields `DIAGNOSTIC_FAILED_LINE`, and an identifier
 * that could not be produced (`unset`, `unavailable`) adds
 * `warning=incomplete-not-evidence-of-isolation`. It never includes error text.
 */
export function describeDatabaseIdentity(
  env: Readonly<Record<string, string | undefined>>,
): string | undefined {
  if (env.VERCEL_ENV !== "preview") return undefined;
  try {
    const source = { ...env };
    const context: IdentityContext = {
      environment: "preview",
      commit: env.VERCEL_GIT_COMMIT_SHA || UNKNOWN,
      deployment: env.VERCEL_DEPLOYMENT_ID || UNKNOWN,
    };
    const pooled = identityOf(
      "pooled",
      () => parseEnv(serverEnvSchema, source).DATABASE_URL,
      context,
    );
    const unpooled = identityOf(
      "unpooled",
      () => parseEnv(migrationEnvSchema, source).DATABASE_URL_UNPOOLED,
      context,
    );
    const complete =
      HEX_IDENTIFIER.test(pooled) && HEX_IDENTIFIER.test(unpooled);
    return `${LINE_PREFIX} ${DB_IDENTITY_VERSION} env=${context.environment} commit=${context.commit} deployment=${context.deployment} pooled=${pooled} unpooled=${unpooled}${complete ? "" : " warning=incomplete-not-evidence-of-isolation"}`;
  } catch {
    return DIAGNOSTIC_FAILED_LINE;
  }
}

export type ParsedIdentityLine = IdentityContext & {
  version: string;
  pooled: string;
  unpooled: string;
};

const LINE_PATTERN =
  /\[db:identity\] (v\d+) env=(\S+) commit=(\S+) deployment=(\S+) pooled=(\S+) unpooled=(\S+)/;

export function parseIdentityLine(line: string): ParsedIdentityLine | null {
  const match = LINE_PATTERN.exec(line);
  if (!match) return null;
  const [, version, environment, commit, deployment, pooled, unpooled] = match;
  return {
    version: version!,
    environment: environment!,
    commit: commit!,
    deployment: deployment!,
    pooled: pooled!,
    unpooled: unpooled!,
  };
}

export type IdentityVerification = {
  pooled: "MATCH" | "MISMATCH";
  unpooled: "MATCH" | "MISMATCH";
};

/**
 * Compares a logged identity line with the authoritative hostnames (from the
 * Neon API or console). Pass hostnames only, never connection strings.
 */
export function verifyIdentityLine(
  line: string,
  expected: { pooledHost: string; unpooledHost: string; database: string },
): IdentityVerification {
  const parsed = parseIdentityLine(line);
  if (!parsed || parsed.version !== DB_IDENTITY_VERSION)
    throw new Error("Not a recognized [db:identity] v1 line");
  const check = (role: DatabaseRole, hostname: string, logged: string) =>
    endpointIdentity(
      role,
      { hostname, database: expected.database },
      parsed,
    ) === logged
      ? "MATCH"
      : "MISMATCH";
  return {
    pooled: check("pooled", expected.pooledHost, parsed.pooled),
    unpooled: check("unpooled", expected.unpooledHost, parsed.unpooled),
  };
}
