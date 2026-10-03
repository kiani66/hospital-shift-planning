import { loadEnvConfig } from "@next/env";

import { bootstrapHospitalAdmin } from "../src/application/management/bootstrap";
import { migrationDatabaseUrl } from "../src/infrastructure/config/env-schema";
import { createDatabase } from "../src/infrastructure/db/database";

async function main() {
  loadEnvConfig(process.cwd());
  const { db, pool } = createDatabase(migrationDatabaseUrl(process.env), {
    max: 1,
  });
  try {
    await bootstrapHospitalAdmin(db, {
      email: process.env.BOOTSTRAP_ADMIN_EMAIL,
      confirm: process.env.BOOTSTRAP_ADMIN_CONFIRM,
    });
    console.log(
      "[db:bootstrap-admin] First Hospital Admin established and audited",
    );
  } finally {
    await pool.end();
  }
}

main().catch(() => {
  // Do not print inputs, connection strings, or database error details.
  console.error(
    "[db:bootstrap-admin] Failed: check explicit confirmation, active account, and absence of an existing admin",
  );
  process.exitCode = 1;
});
