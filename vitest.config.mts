import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const alias = {
  "@": fileURLToPath(new URL("./src", import.meta.url)),
  // `server-only` throws outside React Server Components; tests run in plain Node.
  "server-only": fileURLToPath(
    new URL("./tests/support/empty-module.ts", import.meta.url),
  ),
};

export default defineConfig({
  resolve: { alias },
  test: {
    restoreMocks: true,
    coverage: {
      provider: "v8",
      include: ["src/domain/**/*.ts"],
      exclude: ["src/domain/**/*.test.ts", "src/domain/index.ts"],
      reporter: ["text", "json-summary"],
      // The domain layer holds the business rules; keep it fully covered.
      thresholds: {
        lines: 100,
        functions: 100,
        statements: 100,
        branches: 100,
      },
    },
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.ts", "tests/unit/**/*.test.ts"],
          restoreMocks: true,
        },
      },
      {
        // Real PostgreSQL (TEST_DATABASE_URL). The database is wiped and migrated once per run.
        resolve: { alias },
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          globalSetup: ["tests/integration/global-setup.ts"],
          fileParallelism: false,
          testTimeout: 20_000,
          hookTimeout: 60_000,
          restoreMocks: true,
        },
      },
    ],
  },
});
