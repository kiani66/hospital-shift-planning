import { expect, type Page, type TestInfo } from "@playwright/test";

import {
  DEMO_PASSWORD,
  DEMO_USERS,
} from "../../../src/infrastructure/db/seed/demo-data";

/** E2E runs against the demo seed (`pnpm db:seed`). */
export { DEMO_PASSWORD, DEMO_USERS };

export const GENERIC_ERROR = "شماره پرسنلی/ایمیل یا رمز عبور نادرست است.";

/** The sign-in identifier field (personnel number or e-mail). */
export const IDENTIFIER_LABEL = "شماره پرسنلی یا ایمیل";

export async function signIn(
  page: Page,
  identifier: string,
  password: string = DEMO_PASSWORD,
) {
  if (!page.url().includes("/login")) {
    await page.goto("/login");
    // /login sends a still-signed-in browser home: sign out with signOut()
    // first, never by clicking «خروج» and moving on.
    await expect(page, "signIn() needs a signed-out browser").toHaveURL(
      /\/login/,
    );
  }
  await page.getByLabel(IDENTIFIER_LABEL).fill(identifier);
  await page.getByLabel("رمز عبور").fill(password);
  await page.getByRole("button", { name: "ورود" }).click();
}

/** Pages a successful sign-in without a callback URL can land on (D25). */
const HOME = /\/(my-shifts|home|review)$/;

/**
 * Signs in and waits for the final page: sign-in redirects to `/`, which
 * redirects again to the user's home, so "no longer on /login" is not enough
 * (WebKit reports the intermediate URL).
 */
export async function signInAndWait(page: Page, email: string) {
  await signIn(page, email);
  await expect(page).toHaveURL(HOME);
  await expect(accountMenuButton(page)).toBeVisible();
  await page.waitForLoadState("networkidle");
}

/** The header's account button (who is signed in), on every authenticated page. */
export const accountMenuButton = (page: Page) =>
  page.getByRole("banner").getByRole("button", { name: /^حساب کاربری/ });

/** The account panel the button opens (name, roles, password, sign-out). */
export const accountPanel = (page: Page) =>
  page.getByRole("region", { name: "حساب کاربری" });

/** Opens the account panel (idempotent). */
export async function openAccountMenu(page: Page) {
  const button = accountMenuButton(page);
  if ((await button.getAttribute("aria-expanded")) !== "true")
    await button.click();
  await expect(accountPanel(page)).toBeVisible();
  return accountPanel(page);
}

/**
 * Signs out and waits until it has taken effect. «خروج» submits a Server
 * Action whose response clears the session cookie; navigating before that
 * response arrives cancels it and the browser stays signed in (on WebKit
 * in CI that race was lost on every attempt).
 */
export async function signOut(page: Page) {
  // Desktop shows «خروج» in the top bar; on mobile it is in the account menu.
  const direct = page.getByRole("banner").getByRole("button", { name: "خروج" });
  if (await direct.isVisible()) await direct.click();
  else
    await (
      await openAccountMenu(page)
    )
      .getByRole("button", { name: "خروج" })
      .click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByLabel(IDENTIFIER_LABEL)).toBeVisible();
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
