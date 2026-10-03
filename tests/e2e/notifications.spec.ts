import { expect, test, type Page } from "@playwright/test";

import { isDesktop, mainNav, signInAndWait } from "./support/auth";
import {
  deactivate,
  notificationsOf,
  provisionNotifiedDepartment,
  unreadCountOf,
} from "./support/notifications";

const ISO_DATE = /\d{4}-\d{2}-\d{2}/;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

const main = (page: Page) => page.locator("main");
const badge = (page: Page) => mainNav(page).getByTestId("nav-badge");
const list = (page: Page, name = "همه اعلان‌ها") =>
  page.getByRole("region", { name });
const items = (page: Page, name?: string) =>
  list(page, name).getByRole("listitem");
const openButton = (page: Page, label: string) =>
  items(page)
    .filter({ hasText: label })
    .getByRole("button", {
      name: /^ثبت ترجیحات باز شد/,
    });

const expectNoHorizontalOverflow = async (page: Page, step: string) => {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow, step).toBeLessThanOrEqual(0);
};

test.describe("notification center", () => {
  test("a nurse opens a PREFERENCES_OPENED notification from the badge", async ({
    page,
  }) => {
    const department = await provisionNotifiedDepartment(2);
    const [older, newer] = department.labels as [string, string];
    await signInAndWait(page, department.nurseEmail);

    // Badge: visible count and accessible text on the navigation link.
    await expect(badge(page)).toHaveText("۲");
    const link = mainNav(page).getByRole("link", {
      name: /^اعلان‌ها\s*،\s*۲ اعلان خوانده‌نشده$/,
    });
    await expect(link).toBeVisible();
    await link.click();

    await expect(page).toHaveURL(/\/notifications$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "اعلان‌ها",
    );
    await expect(main(page).getByText("۲ اعلان خوانده‌نشده")).toBeVisible();

    // Newest first, Persian and Jalali, unread shown as text, no ids or ISO dates.
    await expect(items(page)).toHaveCount(2);
    await expect(items(page).nth(0)).toContainText(newer);
    await expect(items(page).nth(1)).toContainText(older);
    const first = items(page).nth(0);
    await expect(first).toContainText("ثبت ترجیحات باز شد");
    await expect(first).toContainText("خوانده‌نشده");
    await expect(first).toContainText(department.name);
    await expect(first.locator("time")).toHaveText(/[۰-۹]/);
    const text = await main(page).innerText();
    expect(text).not.toMatch(ISO_DATE);
    expect(text).not.toMatch(UUID);

    // Opening it marks it read and goes to the preferences placeholder.
    await openButton(page, newer).click();
    await expect(page).toHaveURL(/\/preferences\?schedule=[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("ترجیحات");
    await expect(badge(page)).toHaveText("۱");
    expect(await unreadCountOf(department.nurseEmail)).toBe(1);

    await page.goto("/notifications");
    await expect(main(page).getByText("۱ اعلان خوانده‌نشده")).toBeVisible();
    await expect(items(page).nth(0)).not.toContainText("خوانده‌نشده");
    await expect(items(page).nth(0)).toContainText("(خوانده‌شده)");
    await expect(items(page).nth(1)).toContainText("خوانده‌نشده");
  });

  test("marks all as read, and the badge disappears", async ({ page }) => {
    const department = await provisionNotifiedDepartment(3);
    await signInAndWait(page, department.nurseEmail);
    await page.goto("/notifications");
    await expect(badge(page)).toHaveText("۳");

    const markAll = main(page).getByRole("button", {
      name: "علامت‌گذاری همه به‌عنوان خوانده‌شده",
    });
    await markAll.click();
    await expect(main(page).getByRole("status")).toHaveText(
      "همه اعلان‌ها خوانده شدند.",
    );
    await expect(
      main(page).getByText("همه اعلان‌ها خوانده شده‌اند"),
    ).toBeVisible();
    await expect(badge(page)).toHaveCount(0);
    await expect(markAll).toHaveCount(0);
    await expect(
      mainNav(page).getByRole("link", { name: /اعلان خوانده‌نشده/ }),
    ).toHaveCount(0);
    expect(await unreadCountOf(department.nurseEmail)).toBe(0);
    // Only the current user's notifications.
    expect(await unreadCountOf(department.nurse2Email)).toBe(3);

    await main(page)
      .getByRole("navigation", { name: "فیلتر اعلان‌ها" })
      .getByRole("link", { name: "خوانده‌نشده" })
      .click();
    await expect(page).toHaveURL(/\/notifications\?filter=unread$/);
    await expect(
      main(page).getByRole("heading", { name: "اعلان خوانده‌نشده‌ای ندارید" }),
    ).toBeVisible();
    // Repeating it is harmless (another tab): nothing left to mark.
    await expect(markAll).toHaveCount(0);
  });

  test("marks one as read in place, with the keyboard", async ({ page }) => {
    const department = await provisionNotifiedDepartment(2);
    await signInAndWait(page, department.nurseEmail);
    await page.goto("/notifications?filter=unread");
    await expect(
      main(page)
        .getByRole("navigation", { name: "فیلتر اعلان‌ها" })
        .getByRole("link", { name: /خوانده‌نشده/ }),
    ).toHaveAttribute("aria-current", "page");
    const unread = () => items(page, "اعلان‌های خوانده‌نشده");
    await expect(unread()).toHaveCount(2);

    const markRead = unread()
      .nth(0)
      .getByRole("button", { name: /^علامت خوانده‌شده: ثبت ترجیحات باز شد/ });
    await markRead.focus();
    await expect(markRead).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(unread()).toHaveCount(1);
    await expect(badge(page)).toHaveText("۱");
    // The item left the unread list; focus moved to the list heading.
    await expect(
      page.getByRole("heading", { name: "اعلان‌های خوانده‌نشده" }),
    ).toBeFocused();
    expect(await unreadCountOf(department.nurseEmail)).toBe(1);

    // The remaining one opens with Enter as well.
    const open = unread()
      .nth(0)
      .getByRole("button", {
        name: /^ثبت ترجیحات باز شد/,
      });
    await open.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/preferences\?schedule=/);
    await expect(badge(page)).toHaveCount(0);
  });
});

test.describe("notification isolation", () => {
  test("a user cannot open or mark another user's notification", async ({
    page,
  }) => {
    const department = await provisionNotifiedDepartment(1);
    const [theirs] = await notificationsOf(department.nurse2Email);
    await signInAndWait(page, department.nurseEmail);
    await page.goto("/notifications");
    await expect(items(page)).toHaveCount(1);

    // Tamper with the form: submit user B's notification id as user A.
    const ids = main(page).locator('input[name="notificationId"]');
    const tamper = () =>
      ids.evaluateAll(
        (inputs, id) =>
          inputs.forEach((input) => {
            const hidden = input as HTMLInputElement;
            hidden.value = id;
            // React may restore controlled hidden inputs during submission on WebKit.
            // Tamper with the captured form payload too, so the server actually receives B's id.
            hidden.form?.addEventListener("formdata", (event) =>
              event.formData.set("notificationId", id),
            );
          }),
        theirs!.id,
      );
    await tamper();
    let submitted = page.waitForRequest(
      (request) =>
        request.method() === "POST" && !!request.headers()["next-action"],
    );
    await items(page)
      .nth(0)
      .getByRole("button", { name: /^علامت/ })
      .click();
    expect((await submitted).postData()?.includes(theirs!.id)).toBe(true);
    await expect(main(page).getByRole("alert")).toHaveText(
      "این اعلان پیدا نشد.",
    );
    await tamper();
    submitted = page.waitForRequest(
      (request) =>
        request.method() === "POST" && !!request.headers()["next-action"],
    );
    await items(page)
      .nth(0)
      .getByRole("button", { name: /^ثبت ترجیحات باز شد/ })
      .click();
    expect((await submitted).postData()?.includes(theirs!.id)).toBe(true);
    await expect(main(page).getByRole("alert").first()).toHaveText(
      "این اعلان پیدا نشد.",
    );
    await expect(page).toHaveURL(/\/notifications$/);

    expect((await notificationsOf(department.nurse2Email))[0]!.readAt).toBe(
      null,
    );
    expect(await unreadCountOf(department.nurseEmail)).toBe(1);
  });

  test("a deactivated user loses the notification center at once", async ({
    page,
  }) => {
    const department = await provisionNotifiedDepartment(1);
    await signInAndWait(page, department.nurseEmail);
    await page.goto("/notifications");
    await expect(items(page)).toHaveCount(1);

    await deactivate(department.nurseEmail);
    // The action is refused by the server (sent to sign-in), not by the UI.
    await items(page)
      .nth(0)
      .getByRole("button", { name: /^ثبت ترجیحات باز شد/ })
      .click();
    await expect(page).toHaveURL(/\/login/);
    expect(await unreadCountOf(department.nurseEmail)).toBe(1);

    await page.goto("/notifications");
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("notification center on mobile", () => {
  test("is usable without horizontal overflow and shows the bottom-bar badge", async ({
    page,
  }) => {
    test.skip(isDesktop(page), "mobile only");
    const department = await provisionNotifiedDepartment(2);
    await signInAndWait(page, department.nurseEmail);

    const bottom = page.getByRole("navigation", { name: "ناوبری پایین" });
    await expect(bottom.getByTestId("nav-badge")).toHaveText("۲");
    await bottom.getByRole("link", { name: /^اعلان‌ها/ }).click();
    await expect(page).toHaveURL(/\/notifications$/);
    await expect(items(page)).toHaveCount(2);
    await expectNoHorizontalOverflow(page, "list");

    // Touch targets.
    for (const height of await main(page)
      .getByRole("button")
      .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height)))
      expect(height).toBeGreaterThanOrEqual(44);
    for (const height of await main(page)
      .getByRole("navigation", { name: "فیلتر اعلان‌ها" })
      .getByRole("link")
      .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height)))
      expect(height).toBeGreaterThanOrEqual(44);

    await items(page)
      .nth(0)
      .getByRole("button", { name: /^علامت خوانده‌شده/ })
      .click();
    await expect(bottom.getByTestId("nav-badge")).toHaveText("۱");
    await expect(items(page).nth(0)).not.toContainText("خوانده‌نشده");
    await expectNoHorizontalOverflow(page, "after marking read");

    await page.goto("/notifications?filter=unread");
    await expect(items(page, "اعلان‌های خوانده‌نشده")).toHaveCount(1);
    await expectNoHorizontalOverflow(page, "unread filter");
  });
});
