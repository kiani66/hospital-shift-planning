/**
 * Operator provisioning of one real account, without manual SQL.
 * Production-safe: it only inserts or updates the rows it names (no reset, no
 * truncate, no deletes) and runs only when invoked explicitly, never during a
 * deployment. Not the demo seed (`db:seed`), which stays forbidden in production.
 *
 * PROVISION_MODE selects the operation (default `create`); see
 * src/infrastructure/provisioning/provision-user.ts and docs/deployment.md.
 */
import { loadEnvConfig } from "@next/env";

import { migrationDatabaseUrl } from "../src/infrastructure/config/env-schema";
import { createDatabase } from "../src/infrastructure/db/database";
import {
  parseProvisionEnv,
  provisionUser,
  type ProvisionResult,
} from "../src/infrastructure/provisioning/provision-user";

/** What is printed: never a password, hash or connection string. */
export function describeResult(result: ProvisionResult): string {
  switch (result.mode) {
    case "create":
      return [
        "Provisioned account:",
        `personnel number: ${result.personnelNumber}`,
        `department: ${result.departmentCode}`,
        `department status: ${result.departmentStatus}`,
        `role: ${result.role}`,
        `user: ${result.user}`,
        `membership: ${result.membership}`,
        `password: ${result.password}`,
      ].join("\n");
    case "reset-password":
      return "Temporary password set; all sessions ended; change required at next sign-in.";
    case "assign-personnel-number":
      return `Personnel number ${result.personnelNumber}: ${result.result}`;
  }
}

async function main() {
  loadEnvConfig(process.cwd());
  // Validate before connecting: nothing is touched on bad input.
  const input = parseProvisionEnv(process.env);

  const url = migrationDatabaseUrl(process.env);
  const { host, pathname } = new URL(url);
  console.log(`[db:provision-user] target ${host}${pathname} (${input.mode})`);

  const { db, pool } = createDatabase(url, { max: 1 });
  try {
    console.log(describeResult(await provisionUser(db, input)));
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(
    "[db:provision-user] failed:",
    error instanceof Error && error.name === "ProvisionError"
      ? error.message
      : "unexpected error (no details printed)",
  );
  process.exit(1);
});
