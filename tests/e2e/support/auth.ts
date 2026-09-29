import { expect, type Page, type TestInfo } from "@playwright/test";

import {
  DEMO_PASSWORD,
  DEMO_USERS,
} from "../../../src/infrastructure/db/seed/demo-data";

/** E2E runs against the demo seed (`pnpm db:seed`). */
export { DEMO_PASSWORD, DEMO_USERS };

export const GENERIC_ERROR = "ایمیل یا رمز عبور نادرست است.";

export async function signIn(
  page: Page,
  email: string,
  password: string = DEMO_PASSWORD,
) {
  if (!page.url().includes("/login")) await page.goto("/login");
  await page.getByLabel("ایمیل").fill(email);
  await page.getByLabel("رمز عبور").fill(password);
  await page.getByRole("button", { name: "ورود" }).click();
}

export async function signInAndWait(page: Page, email: string) {
  await signIn(page, email);
  await expect(page).not.toHaveURL(/\/login/);
}

export const isDesktop = (page: Page) =>
  (page.viewportSize()?.width ?? 0) >= 768;

/** Main navigation for the current layout: sidebar on desktop, bottom bar on mobile. */
export const mainNav = (page: Page) =>
  page.getByRole("navigation", {
    name: isDesktop(page) ? "ناوبری اصلی" : "ناوبری پایین",
  });

/**
 * Failed sign-ins count per e-mail address (throttling); give each browser
 * project its own account for the wrong-password tests so parallel runs and
 * retries stay below the limit.
 */
export function wrongPasswordAccount(testInfo: TestInfo) {
  const accounts = [
    DEMO_USERS.icuNurse2,
    DEMO_USERS.icuNurse3,
    DEMO_USERS.icuNurse4,
  ];
  const index = ["desktop-chromium", "mobile-android", "mobile-ios"].indexOf(
    testInfo.project.name,
  );
  return accounts[Math.max(index, 0)]!;
}
