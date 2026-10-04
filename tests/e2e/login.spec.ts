import { expect, test } from "@playwright/test";

import {
  DEMO_USERS,
  GENERIC_ERROR,
  IDENTIFIER_LABEL,
  signIn,
  signInAndWait,
  wrongPasswordAccount,
} from "./support/auth";

test.describe("login page", () => {
  test("is Persian, right-to-left, labelled and has no registration or reset links", async ({
    page,
  }) => {
    await page.goto("/login");
    await expect(page.locator("html")).toHaveAttribute("lang", "fa");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(
      page.getByRole("heading", { level: 1, name: "ورود به سامانه" }),
    ).toBeVisible();
    await expect(page.getByLabel(IDENTIFIER_LABEL)).toHaveAttribute(
      "autocomplete",
      "username",
    );
    await expect(page.getByLabel("رمز عبور")).toHaveAttribute(
      "autocomplete",
      "current-password",
    );
    await expect(page.getByLabel("رمز عبور")).toHaveAttribute(
      "type",
      "password",
    );
    await expect(page.getByRole("link")).toHaveCount(0);
    await expect(page.getByText(/ثبت‌نام|فراموشی/)).toHaveCount(0);
  });

  test("uses the Vazirmatn font", async ({ page }) => {
    await page.goto("/login");
    await page.evaluate(() => document.fonts.ready);
    expect(
      await page
        .locator("body")
        .evaluate((el) => getComputedStyle(el).fontFamily),
    ).toContain("Vazirmatn");
  });

  test("does not scroll horizontally", async ({ page }) => {
    await page.goto("/login");
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("shows the same generic error for a wrong password and an unknown e-mail", async ({
    page,
  }, testInfo) => {
    await signIn(page, wrongPasswordAccount(testInfo).email, "wrong password");
    // Next.js adds its own role="alert" route announcer; target the form's.
    const alert = page.locator("#login-error");
    await expect(alert).toHaveAttribute("role", "alert");
    await expect(alert).toHaveText(GENERIC_ERROR);
    await expect(page.getByLabel(IDENTIFIER_LABEL)).toHaveAttribute(
      "aria-describedby",
      "login-error",
    );
    await expect(page.getByLabel(IDENTIFIER_LABEL)).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await expect(page.getByLabel("رمز عبور")).toHaveValue("");

    await signIn(page, `unknown-${Date.now()}@demo.invalid`, "wrong password");
    await expect(alert).toHaveText(GENERIC_ERROR);
    await expect(page).toHaveURL(/\/login/);
  });

  test("signs in with a personnel number typed in Persian digits", async ({
    page,
  }) => {
    // icuNurse1's personnel number is 01011: leading zero kept.
    await signIn(page, "۰۱۰۱۱");
    await expect(page).toHaveURL(/\/my-shifts$/);
  });

  test("rejects a deactivated user with the generic error", async ({
    page,
  }) => {
    await signIn(page, DEMO_USERS.inactiveNurse.email);
    await expect(page.locator("#login-error")).toHaveText(GENERIC_ERROR);
    await page.goto("/my-shifts");
    await expect(page).toHaveURL(/\/login/);
  });

  test("works with the keyboard alone", async ({ page }) => {
    test.skip(
      (page.viewportSize()?.width ?? 0) < 768,
      "hardware keyboard flow is checked on desktop",
    );
    await page.goto("/login");
    await page.getByLabel(IDENTIFIER_LABEL).focus();
    await page.keyboard.type(DEMO_USERS.icuNurse1.email);
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("رمز عبور")).toBeFocused();
    await page.keyboard.type("demo-only-password");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "ورود" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/my-shifts$/);
  });
});

test.describe("session", () => {
  test("sends an unauthenticated visitor to login and back to the page afterwards", async ({
    page,
  }) => {
    await page.goto("/preferences");
    await expect(page).toHaveURL(/\/login\?callbackUrl=%2Fpreferences$/);
    await signIn(page, DEMO_USERS.icuNurse1.email);
    await expect(page).toHaveURL(/\/preferences$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("ترجیحات");
  });

  test("protects every page of the application", async ({ page }) => {
    for (const path of [
      "/",
      "/home",
      "/my-shifts",
      "/requests",
      "/notifications",
      "/review",
      "/more",
      "/departments/icu/schedule",
      "/departments/icu/history",
    ]) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/login/);
    }
  });

  test("ignores an external callback URL", async ({ page }) => {
    await page.goto("/login?callbackUrl=https%3A%2F%2Fevil.example%2F");
    await signIn(page, DEMO_USERS.icuNurse1.email);
    await expect(page).toHaveURL(/localhost:\d+\/my-shifts$/);
  });

  test("logs out", async ({ page }) => {
    await signInAndWait(page, DEMO_USERS.icuNurse1.email);
    await page.getByRole("button", { name: "خروج" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByLabel(IDENTIFIER_LABEL)).toBeVisible();
    await page.waitForLoadState("networkidle");
    await page.goto("/my-shifts");
    await expect(page).toHaveURL(/\/login/);
  });

  test("never re-issues the session cookie, so sign-out cannot be undone by a request in flight", async ({
    page,
  }) => {
    await signInAndWait(page, DEMO_USERS.icuNurse1.email);
    for (const path of ["/my-shifts", "/preferences", "/"]) {
      const response = await page.request.get(path, { maxRedirects: 0 });
      expect(response.status(), path).toBeLessThan(400);
      expect(response.headers()["set-cookie"], path).toBeUndefined();
    }
  });

  test("an already signed-in user skips the login page", async ({ page }) => {
    await signInAndWait(page, DEMO_USERS.icuNurse1.email);
    await page.goto("/login");
    await expect(page).toHaveURL(/\/my-shifts$/);
  });
});
