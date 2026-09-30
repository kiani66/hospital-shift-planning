/**
 * Creates or updates one real user and their department membership.
 * Production-safe: it only inserts or updates the rows it names (no reset, no
 * truncate, no deletes) and runs only when invoked explicitly, never during a
 * deployment. Not the demo seed (`db:seed`), which stays forbidden in production.
 *
 * Input: PROVISION_EMAIL, PROVISION_PASSWORD, PROVISION_DEPARTMENT_CODE,
 * PROVISION_ROLE (HEAD_NURSE | NURSE), optional PROVISION_DISPLAY_NAME, and
 * PROVISION_DEPARTMENT_NAME (required only if the department does not exist yet).
 */
import { loadEnvConfig } from "@next/env";

import { migrationDatabaseUrl } from "../src/infrastructure/config/env-schema";
import { createDatabase } from "../src/infrastructure/db/database";
import {
  parseProvisionEnv,
  provisionUser,
} from "../src/infrastructure/provisioning/provision-user";

async function main() {
  loadEnvConfig(process.cwd());
  // Validate before connecting: nothing is touched on bad input.
  const input = parseProvisionEnv(process.env);

  const url = migrationDatabaseUrl(process.env);
  const { host, pathname } = new URL(url);
  console.log(`[db:provision-user] target ${host}${pathname}`);

  const { db, pool } = createDatabase(url, { max: 1 });
  try {
    const result = await provisionUser(db, input);
    console.log(
      [
        "Provisioned user:",
        `email: ${result.email}`,
        `department: ${result.departmentCode}`,
        `department status: ${result.departmentStatus}`,
        `role: ${result.role}`,
        "status: active",
        `user: ${result.userCreated ? "created" : "updated (password refreshed)"}`,
        `membership: ${result.membership}`,
      ].join("\n"),
    );
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(
    "[db:provision-user] failed:",
    error instanceof Error ? error.message : "unknown error",
  );
  process.exit(1);
});
