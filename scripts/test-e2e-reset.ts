import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:net";
import { Client } from "pg";
import { runMigrations } from "../src/infrastructure/db/migrate";
import { createDatabase } from "../src/infrastructure/db/database";
import { seedDemoData } from "../src/infrastructure/db/seed/seed";
import {
  assertResetE2eDatabase,
  resetTestMaintenanceUrl,
} from "./support/reset-e2e-safety";

async function main() {
  const maintenanceUrl = resetTestMaintenanceUrl(process.env);
  if (process.env.PLAYWRIGHT_BASE_URL)
    throw new Error("External servers are forbidden for reset E2E");
  const name = `hsp_phase14_e2e_test_${randomUUID().replaceAll("-", "")}`;
  const target = new URL(maintenanceUrl);
  target.pathname = `/${name}`;
  const socket = createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const address = socket.address();
  if (!address || typeof address === "string")
    throw new Error("Missing test port");
  const port = address.port;
  await new Promise<void>((resolve, reject) =>
    socket.close((e) => (e ? reject(e) : resolve())),
  );
  const env = {
    ...process.env,
    NODE_ENV: "production" as const,
    DATABASE_URL: target.toString(),
    DATABASE_URL_UNPOOLED: target.toString(),
    TEST_DATABASE_URL: target.toString(),
    AUTH_SECRET: randomBytes(32).toString("base64"),
    AUTH_TRUST_HOST: "true",
    FULL_RESET_E2E: "1",
    PORT: String(port),
  };
  assertResetE2eDatabase(env);
  const maintenance = new Client({
    connectionString: maintenanceUrl.toString(),
  });
  await maintenance.connect();
  let created = false;
  let child: ReturnType<typeof spawn> | undefined;
  let interrupted = false;
  const stop = () => {
    interrupted = true;
    child?.kill("SIGTERM");
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  try {
    await maintenance.query(`create database "${name}"`);
    created = true;
    console.log(`[reset-e2e] created disposable ${name}`);
    await runMigrations(target.toString());
    const database = createDatabase(target.toString(), { max: 1 });
    try {
      await seedDemoData(database.db);
    } finally {
      await database.pool.end();
    }
    if (interrupted) throw new Error("Reset E2E interrupted during setup");
    child = spawn(
      "pnpm",
      [
        "exec",
        "playwright",
        "test",
        "--config=playwright.reset.config.ts",
        ...process.argv.slice(2),
      ],
      { env, stdio: "inherit" },
    );
    const [code] = await once(child, "exit");
    process.exitCode = typeof code === "number" ? code : 1;
  } finally {
    try {
      if (created) {
        await maintenance.query(`drop database "${name}" with (force)`);
        console.log(`[reset-e2e] dropped disposable ${name}`);
      }
    } finally {
      await maintenance.end();
      process.removeListener("SIGINT", stop);
      process.removeListener("SIGTERM", stop);
    }
  }
}
main().catch(() => {
  console.error(
    "[reset-e2e] failed; inspect test/setup output (database credentials omitted)",
  );
  process.exitCode = 1;
});
