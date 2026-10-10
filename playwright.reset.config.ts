import { defineConfig } from "@playwright/test";
import ordinary from "./playwright.config";
import { assertResetE2eDatabase } from "./scripts/support/reset-e2e-safety";

assertResetE2eDatabase(process.env);
export default defineConfig({
  ...ordinary,
  testMatch: /(?:full-reset|monthly-reset)\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  outputDir: "test-results/reset",
  reporter: process.env.CI
    ? [
        ["github"],
        ["html", { open: "never", outputFolder: "playwright-report/reset" }],
      ]
    : "list",
  projects: ordinary
    .projects!.filter((p) => p.name !== "api")
    .map((p) => ({ ...p, testIgnore: /api\// })),
  webServer: { ...ordinary.webServer!, reuseExistingServer: false },
});
