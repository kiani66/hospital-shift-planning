/** Test-only database ownership contract. Never loads local or deployed secrets. */
export function resetTestMaintenanceUrl(
  env: Readonly<Record<string, string | undefined>>,
): URL {
  if (env.NODE_ENV !== "test" || env.VERCEL || env.VERCEL_ENV)
    throw new Error(
      "Reset E2E provisioning requires an undeployed test environment",
    );
  const url = new URL(env.FULL_RESET_TEST_DATABASE_URL ?? "");
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    url.hostname !== "127.0.0.1" ||
    url.pathname !== "/postgres" ||
    url.search ||
    url.hash
  )
    throw new Error(
      "Reset E2E requires an explicit local PostgreSQL maintenance database",
    );
  return url;
}
export function assertResetE2eDatabase(
  env: Readonly<Record<string, string | undefined>>,
): string {
  if (
    env.VERCEL ||
    env.VERCEL_ENV ||
    env.FULL_RESET_E2E !== "1" ||
    env.PLAYWRIGHT_BASE_URL
  )
    throw new Error("Reset E2E requires its own undeployed production server");
  const value = env.DATABASE_URL ?? "";
  const url = new URL(value);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    url.hostname !== "127.0.0.1" ||
    !/^\/hsp_phase14_e2e_test_[a-f0-9]{32}$/.test(url.pathname) ||
    url.search ||
    url.hash ||
    env.DATABASE_URL_UNPOOLED !== value ||
    env.TEST_DATABASE_URL !== value
  )
    throw new Error("Reset E2E requires matching isolated local database URLs");
  return value;
}
