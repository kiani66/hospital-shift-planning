import "server-only";

import { parseEnv, serverEnvSchema, type ServerEnv } from "./env-schema";

let cached: ServerEnv | undefined;

/**
 * Validated server environment. Parsed lazily on first use so that `next build`
 * does not require runtime secrets; a misconfigured deployment fails on the
 * first request that needs them (and `/api/health` reports it).
 */
export function getServerEnv(): ServerEnv {
  cached ??= parseEnv(serverEnvSchema, process.env);
  return cached;
}
