import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { loadEnvConfig } from "@next/env";
import { test as base } from "@playwright/test";
import { Client } from "pg";

import { bootstrapHospitalAdmin } from "../../../src/application/management/bootstrap";
import { createDatabase } from "../../../src/infrastructure/db/database";
import { runMigrations } from "../../../src/infrastructure/db/migrate";
import { DEMO_USERS } from "../../../src/infrastructure/db/seed/demo-data";
import { seedDemoData } from "../../../src/infrastructure/db/seed/seed";
import { countHospitalAdmins } from "../../../src/infrastructure/repositories/management";

/** A truly single-admin browser environment; never changes shared E2E/demo admins. */
export const lastAdminTest = base.extend<{
  lastAdminServer: {
    baseURL: string;
    admin: typeof DEMO_USERS.icuHead;
    activeAdminCount: () => Promise<number>;
  };
}>({
  lastAdminServer: async ({ browserName }, provide) => {
    void browserName;
    loadEnvConfig(process.cwd());
    const source = process.env.TEST_DATABASE_URL;
    if (!source || !new URL(source).pathname.includes("test"))
      throw new Error(
        "A designated TEST_DATABASE_URL is required for isolated last-admin E2E",
      );
    if (process.env.VERCEL_ENV === "production")
      throw new Error("Isolated E2E cannot run in production");
    const name = `hsp_authority_e2e_test_${randomUUID().replaceAll("-", "")}`;
    const maintenance = new Client({ connectionString: source });
    await maintenance.connect();
    let created = false;
    let app: ReturnType<typeof spawn> | undefined;
    let database: ReturnType<typeof createDatabase> | undefined;
    try {
      await maintenance.query(`create database "${name}"`);
      created = true;
      const target = new URL(source);
      target.pathname = `/${name}`;
      await runMigrations(target.toString());
      database = createDatabase(target.toString(), { max: 2 });
      await seedDemoData(database.db);
      await bootstrapHospitalAdmin(database.db, {
        email: DEMO_USERS.icuHead.email,
        confirm: "ESTABLISH_FIRST_HOSPITAL_ADMIN",
      });
      const socket = createServer();
      socket.listen(0, "127.0.0.1");
      await once(socket, "listening");
      const address = socket.address();
      if (!address || typeof address === "string")
        throw new Error("Isolated server port unavailable");
      const port = address.port;
      await new Promise<void>((resolve) => socket.close(() => resolve()));
      const baseURL = `http://127.0.0.1:${port}`;
      app = spawn(
        process.execPath,
        [
          resolve("node_modules/next/dist/bin/next"),
          "start",
          "--port",
          String(port),
          "--hostname",
          "127.0.0.1",
        ],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            DATABASE_URL: target.toString(),
            DATABASE_URL_UNPOOLED: target.toString(),
            AUTH_TRUST_HOST: "true",
          },
          stdio: "ignore",
        },
      );
      let ready = false;
      for (let attempt = 0; attempt < 200; attempt++) {
        if (app.exitCode !== null)
          throw new Error("Isolated production server exited before readiness");
        try {
          ready = (await fetch(`${baseURL}/api/health`)).ok;
        } catch {
          /* Startup in progress. */
        }
        if (ready) break;
        await delay(100);
      }
      if (!ready)
        throw new Error("Isolated production server did not become ready");
      const db = database.db;
      await provide({
        baseURL,
        admin: DEMO_USERS.icuHead,
        activeAdminCount: () => countHospitalAdmins(db),
      });
    } finally {
      if (app && app.exitCode === null) {
        const closed = once(app, "exit");
        app.kill("SIGTERM");
        await closed;
      }
      await database?.pool.end();
      if (created)
        await maintenance.query(`drop database "${name}" with (force)`);
      await maintenance.end();
    }
  },
});
