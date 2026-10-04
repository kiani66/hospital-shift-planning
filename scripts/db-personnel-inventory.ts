/**
 * Read-only: lists accounts that still have no personnel number and says
 * whether the staged NOT NULL migration
 * (src/infrastructure/db/staged/0010_personnel_number_required.sql) could run.
 * Writes nothing. Backfill genuine numbers through the Hospital Admin person
 * page (audited) or `PROVISION_MODE=assign-personnel-number pnpm db:provision-user`.
 */
import { loadEnvConfig } from "@next/env";

import { migrationDatabaseUrl } from "../src/infrastructure/config/env-schema";
import { createDatabase } from "../src/infrastructure/db/database";
import { readPersonnelInventory } from "../src/infrastructure/provisioning/personnel-inventory";

async function main() {
  loadEnvConfig(process.cwd());
  const url = migrationDatabaseUrl(process.env);
  const { host, pathname } = new URL(url);
  console.log(`[db:personnel-inventory] target ${host}${pathname} (read-only)`);

  const { db, pool } = createDatabase(url, { max: 1 });
  try {
    const inventory = await readPersonnelInventory(db);
    console.log(`users: ${inventory.totalUsers}`);
    console.log(`without personnel number: ${inventory.missing.length}`);
    for (const user of inventory.missing)
      console.log(
        `  - ${user.id}  ${user.email ?? "(no e-mail)"}  ${user.displayName}` +
          `${user.isHospitalAdmin ? "  [hospital admin]" : ""}` +
          `${user.isActive ? "" : "  [inactive]"}`,
      );
    console.log(
      inventory.readyForStrictStage
        ? "strict stage (personnel_number NOT NULL): prerequisites met; still requires explicit authorization"
        : "strict stage (personnel_number NOT NULL): NOT ready; backfill the accounts above first",
    );
  } finally {
    await pool.end();
  }
}

main().catch(() => {
  console.error("[db:personnel-inventory] failed (no details printed)");
  process.exit(1);
});
