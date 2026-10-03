import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PORT ?? 3000);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;

// Optional override for environments with a preinstalled Chromium build.
const chromiumPath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const chromiumLaunch = chromiumPath
  ? { launchOptions: { executablePath: chromiumPath } }
  : {};

// Users are in Iran; render dates and numbers as they will see them.
const locale = { locale: "fa-IR", timezoneId: "Asia/Tehran" };

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    { name: "api", testMatch: /api\/.*\.spec\.ts/ },
    {
      name: "desktop-chromium",
      testIgnore: /api\//,
      use: { ...devices["Desktop Chrome"], ...locale, ...chromiumLaunch },
    },
    {
      name: "mobile-android",
      testIgnore: /api\//,
      use: { ...devices["Pixel 7"], ...locale, ...chromiumLaunch },
    },
    {
      name: "mobile-ios",
      testIgnore: /api\//,
      // Multi-session workflows take longer on WebKit in the cloud runner.
      // Assertions retain the same auto-wait limits; only the whole-test budget grows.
      timeout: 60_000,
      use: { ...devices["iPhone 14"], ...locale },
    },
  ],
  // Tests run against a production build; run `pnpm build` first.
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: `pnpm start --port ${PORT}`,
        url: `${baseURL}/api/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      },
});
