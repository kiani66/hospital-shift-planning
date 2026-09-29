import { expect, test, type Page } from "@playwright/test";

import { DEMO_USERS, signInAndWait } from "./support/auth";
import { provisionDepartment, type E2eDepartment } from "./support/workspace";

const ISO_DATE = /\d{4}-\d{2}-\d{2}/;

const expectNoHorizontalOverflow = async (page: Page, step: string) => {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow, step).toBeLessThanOrEqual(0);
};

const main = (page: Page) => page.locator("main");
const preferences = (page: Page) =>
  page.getByRole("region", { name: "ثبت ترجیحات پرستاران" });
const roster = (page: Page) =>
  page.getByRole("region", { name: "پرسنل برنامه" });

/** The value next to a term in a card's fact list. */
const fact = (region: ReturnType<Page["getByRole"]>, term: string) =>
  region
    .locator("dt", { hasText: new RegExp(`^${term}$`) })
    .locator("xpath=following-sibling::dd[1]");

test.describe("Head Nurse schedule management", () => {
  let department: E2eDepartment;

  test.beforeEach(async ({ page }) => {
    department = await provisionDepartment();
    await signInAndWait(page, department.headEmail);
  });

  test("creates a Jalali month, opens and closes preference collection", async ({
    page,
  }) => {
    await page.goto(`/departments/${department.code}/schedule`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      department.name,
    );

    // Empty state with one primary action.
    await expect(
      main(page).getByRole("heading", {
        name: "هنوز برنامه‌ای برای این بخش ایجاد نشده است",
      }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page, "empty state");

    // Create: year and month in Persian, preview in Jalali only.
    await main(page)
      .getByRole("button", { name: "ایجاد برنامه ماهانه" })
      .click();
    const dialog = page.getByRole("dialog", { name: "ایجاد برنامه ماهانه" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("سال")).toBeVisible();
    const month = dialog.getByLabel("ماه");
    await expect(month).toBeVisible();
    const label = (await month.locator("option:checked").textContent())!.trim();
    expect(label).toMatch(/^[؀-ۿ]+ [۰-۹]{4}$/);
    await expect(dialog.locator("p", { hasText: label })).toBeVisible();
    await expect(dialog.getByText("از", { exact: true })).toBeVisible();
    await expect(dialog.getByText("تا", { exact: true })).toBeVisible();
    expect(await dialog.innerText()).not.toMatch(ISO_DATE);
    await expectNoHorizontalOverflow(page, "create dialog");

    await dialog.getByRole("button", { name: "ایجاد برنامه" }).click();
    await expect(page).toHaveURL(/\?schedule=[0-9a-f-]{36}$/);
    await expect(dialog).toBeHidden();

    // Summary: Jalali label, status and roster counts.
    await expect(
      main(page).getByRole("heading", { level: 2, name: label }),
    ).toBeVisible();
    await expect(main(page).getByText("پیش‌نویس")).toBeVisible();
    await expect(fact(roster(page), "تعداد پرسنل برنامه")).toHaveText("۴");
    await expect(fact(roster(page), "پرستار")).toHaveText("۳");
    await expect(fact(roster(page), "سرپرستار")).toHaveText("۱");
    await expect(fact(preferences(page), "وضعیت")).toHaveText("باز نشده");
    expect(await main(page).innerText()).not.toMatch(ISO_DATE);
    await expectNoHorizontalOverflow(page, "created");

    // Open preference collection (confirmed).
    await preferences(page)
      .getByRole("button", { name: "باز کردن ثبت ترجیحات" })
      .click();
    const openDialog = page.getByRole("dialog", {
      name: "باز کردن ثبت ترجیحات؟",
    });
    await openDialog.getByRole("button", { name: "بله، باز شود" }).click();
    await expect(openDialog).toBeHidden();
    await expect(fact(preferences(page), "وضعیت")).toHaveText("باز");
    await expect(fact(preferences(page), "دامنه تاریخ")).toContainText(
      "کل دوره",
    );
    await expect(fact(preferences(page), "پرستاران")).toHaveText(
      "همه پرسنل برنامه (۴ نفر)",
    );
    await expect(main(page).getByText("در حال برنامه‌ریزی")).toBeVisible();
    await expectNoHorizontalOverflow(page, "open");

    // Closing needs confirmation; cancelling keeps it open.
    const closeButton = preferences(page).getByRole("button", {
      name: "بستن ثبت ترجیحات",
    });
    await closeButton.click();
    const closeDialog = page.getByRole("dialog", {
      name: "بستن ثبت ترجیحات؟",
    });
    await expect(
      closeDialog.getByRole("button", { name: "انصراف" }),
    ).toBeFocused();
    await closeDialog.getByRole("button", { name: "انصراف" }).click();
    await expect(closeDialog).toBeHidden();
    await expect(fact(preferences(page), "وضعیت")).toHaveText("باز");

    await closeButton.click();
    await closeDialog.getByRole("button", { name: "بله، بسته شود" }).click();
    await expect(closeDialog).toBeHidden();
    await expect(fact(preferences(page), "وضعیت")).toHaveText("بسته");
    await expect(fact(preferences(page), "بسته شده")).toBeVisible();
    await expect(
      preferences(page).getByRole("button", { name: "بستن ثبت ترجیحات" }),
    ).toHaveCount(0);
    await expectNoHorizontalOverflow(page, "closed");

    // The month now has a schedule and cannot be chosen again.
    await main(page)
      .getByRole("button", { name: "برنامه ماهانه جدید" })
      .click();
    await expect(
      dialog.getByRole("option", { name: `${label} (دارای برنامه)` }),
    ).toBeDisabled();
  });

  test("closes the confirmation with Escape", async ({ page }) => {
    await page.goto(`/departments/${department.code}/schedule`);
    await main(page)
      .getByRole("button", { name: "ایجاد برنامه ماهانه" })
      .click();
    const dialog = page.getByRole("dialog", { name: "ایجاد برنامه ماهانه" });
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });
});

test.describe("schedule management access", () => {
  test("a nurse of the department cannot open it", async ({ page }) => {
    const department = await provisionDepartment();
    await signInAndWait(page, department.nurseEmail);
    const response = await page.goto(
      `/departments/${department.code}/schedule`,
    );
    expect(response?.status()).toBe(404);
    // Their own membership is in the shell; the page itself reveals nothing.
    await expect(main(page).getByText(department.name)).toHaveCount(0);
    await expect(
      main(page).getByRole("button", { name: "ایجاد برنامه ماهانه" }),
    ).toHaveCount(0);
  });

  test("a supervisor who is not its Head Nurse cannot open it", async ({
    page,
  }) => {
    await signInAndWait(page, DEMO_USERS.supervisor.email);
    const response = await page.goto("/departments/icu/schedule");
    expect(response?.status()).toBe(404);
    await expect(
      page.getByRole("button", { name: /ایجاد برنامه|ثبت ترجیحات/ }),
    ).toHaveCount(0);
  });
});
