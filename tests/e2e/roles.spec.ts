import { expect, test, type Page } from "@playwright/test";

import { DEMO_USERS, mainNav, signInAndWait } from "./support/auth";

const ICU_NAME = "مراقبت‌های ویژه";
const ER_NAME = "اورژانس";

/** A denied department looks exactly like a missing one: 404, no department details. */
const expectNotFound = async (
  page: Page,
  path: string,
  deniedName?: string,
) => {
  const response = await page.goto(path);
  expect(response?.status(), path).toBe(404);
  const main = page.locator("main");
  await expect(
    main.getByRole("heading", { level: 1, name: "صفحه پیدا نشد" }),
  ).toBeVisible();
  if (deniedName) await expect(main.getByText(deniedName)).toHaveCount(0);
};

test.describe("nurse", () => {
  test.beforeEach(async ({ page }) => {
    await signInAndWait(page, DEMO_USERS.icuNurse1.email);
  });

  test("lands on their shifts and sees nurse navigation only", async ({
    page,
  }) => {
    await expect(page).toHaveURL(/\/my-shifts$/);
    const nav = mainNav(page);
    for (const label of ["شیفت‌های من", "ترجیحات", "درخواست‌ها", "اعلان‌ها"])
      await expect(nav.getByRole("link", { name: label })).toBeVisible();
    for (const label of ["برنامه بخش", "تاریخچه", "بررسی برنامه‌ها"])
      await expect(page.getByRole("link", { name: label })).toHaveCount(0);
    await expect(
      nav.getByRole("link", { name: "شیفت‌های من" }),
    ).toHaveAttribute("aria-current", "page");
  });

  test("has no department management or review access by URL", async ({
    page,
  }) => {
    await expectNotFound(page, "/departments/icu/schedule", ICU_NAME);
    await expectNotFound(page, "/departments/icu/history", ICU_NAME);
    await expectNotFound(page, "/review");
  });

  test("shows placeholders clearly marked as not implemented", async ({
    page,
  }) => {
    await page.goto("/my-shifts");
    await expect(
      page.getByRole("note", { name: "هنوز پیاده‌سازی نشده" }),
    ).toBeVisible();
    // Requests are implemented (Phase 9): no placeholder there any more.
    await page.goto("/requests");
    await expect(
      page.getByRole("heading", { level: 2, name: "درخواست‌های من" }),
    ).toBeVisible();
    await expect(
      page.getByRole("note", { name: "هنوز پیاده‌سازی نشده" }),
    ).toHaveCount(0);
  });
});

test.describe("head nurse", () => {
  test.beforeEach(async ({ page }) => {
    await signInAndWait(page, DEMO_USERS.icuHead.email);
  });

  test("lands on the overview with nurse and department navigation", async ({
    page,
  }) => {
    await expect(page).toHaveURL(/\/home$/);
    await expect(
      page.getByRole("heading", { level: 1, name: /خوش آمدید/ }),
    ).toBeVisible();
    const nav = mainNav(page);
    for (const label of ["شیفت‌های من", "برنامه بخش", "درخواست‌ها", "تاریخچه"])
      await expect(nav.getByRole("link", { name: label })).toBeVisible();
  });

  test("opens their own department", async ({ page }) => {
    await mainNav(page).getByRole("link", { name: "برنامه بخش" }).click();
    await expect(page).toHaveURL(/\/departments\/icu\/schedule$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      ICU_NAME,
    );
  });

  test("is denied another department's pages", async ({ page }) => {
    await expectNotFound(page, "/departments/er/schedule", ER_NAME);
    await expectNotFound(page, "/departments/er/history", ER_NAME);
    await expectNotFound(page, "/departments/no-such-department/schedule");
  });
});

test.describe("supervisor", () => {
  test.beforeEach(async ({ page }) => {
    await signInAndWait(page, DEMO_USERS.supervisor.email);
  });

  test("lands on review with review navigation only", async ({ page }) => {
    await expect(page).toHaveURL(/\/review$/);
    const nav = mainNav(page);
    await expect(
      nav.getByRole("link", { name: "بررسی برنامه‌ها" }),
    ).toBeVisible();
    await expect(nav.getByRole("link", { name: "اعلان‌ها" })).toBeVisible();
    for (const label of ["شیفت‌های من", "ترجیحات", "برنامه بخش"])
      await expect(page.getByRole("link", { name: label })).toHaveCount(0);
    const supervised = page.getByRole("region", { name: "بخش‌های تحت نظارت" });
    await expect(supervised.getByRole("listitem")).toHaveCount(2);
  });

  test("has no Head Nurse edit capability", async ({ page }) => {
    await expectNotFound(page, "/departments/icu/schedule", ICU_NAME);
    await expectNotFound(page, "/departments/er/schedule", ER_NAME);
  });
});
