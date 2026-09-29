import { existsSync } from "node:fs";

import { loadEnvConfig } from "@next/env";
import { Client } from "pg";
import type { TestProject } from "vitest/node";

import { runMigrations } from "../../src/infrastructure/db/migrate";

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

/**
 * Wipes TEST_DATABASE_URL and migrates it from empty, once per run. Refuses
 * any database whose name does not contain "test", so a dev or production
 * database can never be wiped by accident.
 */
export default async function setup(project: TestProject) {
  // Next loads .env.test* in test mode; developers keep local URLs in .env.local.
  loadEnvConfig(process.cwd());
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = process.env.TEST_DATABASE_URL;
  if (!url)
    throw new Error(
      "TEST_DATABASE_URL is required for integration tests (see .env.example)",
    );
  const name = new URL(url).pathname.slice(1);
  if (!name.includes("test"))
    throw new Error(
      `Refusing to wipe database "${name}": its name must contain "test"`,
    );

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("drop schema if exists drizzle cascade");
    await client.query("drop schema public cascade");
    await client.query("create schema public");
  } finally {
    await client.end();
  }

  await runMigrations(url);
  project.provide("databaseUrl", url);
}
