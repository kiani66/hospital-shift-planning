import { expect, test, type Browser, type Page } from "@playwright/test";

import {
  DEMO_PASSWORD,
  GENERIC_ERROR,
  signIn,
  signInAndWait,
  signOut,
} from "./support/auth";
import { provisionPersonnel } from "./support/personnel";
import {
  createPersonnelRoster,
  requirePasswordChange,
  rosterOf,
} from "./support/personnel-mutations";

let fixture: Awaited<ReturnType<typeof provisionPersonnel>>;
test.beforeEach(async () => {
  fixture = await provisionPersonnel();
});

const HOME = /\/(my-shifts|home|review)$/;
const NEW_PASSWORD = "my-own-new-password-1";

async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);
}

async function signedInPage(browser: Browser, identifier: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, identifier);
  return { context, page };
}

test("a temporary password forces a change before any other page, then ends older sessions", async ({
  page,
  browser,
}) => {
  await requirePasswordChange(fixture);
  const nurse = fixture.people.nurse;
  // A second device signed in with the same temporary password.
  const other = await signedInPage(browser, nurse.email);
  await expect(other.page).toHaveURL(/\/account\/password$/);

  await signIn(page, nurse.personnelNumber!);
  await expect(page).toHaveURL(/\/account\/password$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "انتخاب رمز عبور شخصی" }),
  ).toBeVisible();
  for (const path of ["/my-shifts", "/admin/personnel", "/notifications"]) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/account\/password$/);
  }
  await noOverflow(page);

  await page.getByLabel("رمز موقت فعلی").fill(DEMO_PASSWORD);
  await page.getByLabel("رمز عبور جدید", { exact: true }).fill(NEW_PASSWORD);
  await page.getByLabel("تکرار رمز عبور جدید").fill("does-not-match-1");
  await page.getByRole("button", { name: "ذخیره رمز عبور جدید" }).click();
  await expect(page.locator("#password-error")).toContainText("یکسان نیست");

  await page.getByLabel("رمز موقت فعلی").fill(DEMO_PASSWORD);
  await page.getByLabel("رمز عبور جدید", { exact: true }).fill(NEW_PASSWORD);
  await page.getByLabel("تکرار رمز عبور جدید").fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "ذخیره رمز عبور جدید" }).click();
  // The new session works at once.
  await expect(page).toHaveURL(HOME);
  await expect(page.getByRole("button", { name: "خروج" })).toBeVisible();

  // The other device's session was issued before the change: signed out.
  await other.page.goto("/my-shifts");
  await expect(other.page).toHaveURL(/\/login/);
  await other.context.close();

  await signOut(page);
  await signIn(page, nurse.personnelNumber!, DEMO_PASSWORD);
  await expect(page.locator("#login-error")).toHaveText(GENERIC_ERROR);
  await signIn(page, nurse.email, NEW_PASSWORD);
  await expect(page).toHaveURL(HOME);
});

test("admin issues a temporary password once; the user's existing sessions end", async ({
  page,
  browser,
}) => {
  const nurse = fixture.people.nurse;
  const other = await signedInPage(browser, nurse.email);
  await expect(other.page).toHaveURL(HOME);

  await signInAndWait(page, fixture.people.admin.email);
  await page.goto(`/admin/personnel/${nurse.id}`);
  await page.getByRole("button", { name: "بازنشانی با رمز موقت" }).click();
  const dialog = page.getByRole("dialog", { name: "بازنشانی با رمز موقت" });
  await dialog.getByRole("button", { name: "ساخت رمز موقت" }).click();
  const shown = page.getByTestId("temporary-password");
  await expect(shown).toHaveText(/^[A-Za-z0-9]{4}(-[A-Za-z0-9]{4}){3}$/);
  const temporary = (await shown.textContent())!;
  await noOverflow(page);
  await page.getByRole("button", { name: "تحویل دادم؛ پنهان شود" }).click();
  await expect(shown).toHaveCount(0);
  await page.reload();
  await expect(page.getByText(temporary)).toHaveCount(0);
  await expect(
    page.getByText("رمز موقت؛ در ورود بعدی باید تغییر کند"),
  ).toBeVisible();

  await other.page.goto("/my-shifts");
  await expect(other.page).toHaveURL(/\/login/);
  await signIn(other.page, nurse.personnelNumber!, temporary);
  await expect(other.page).toHaveURL(/\/account\/password$/);
  await other.context.close();
});

test("admin imports nurses from CSV; the Head Nurse adds one to a draft schedule", async ({
  page,
}) => {
  const scheduleId = await createPersonnelRoster(fixture, 10);
  const rosterBefore = await rosterOf(scheduleId);
  const n = BigInt(`0x${fixture.suffix}`).toString().padStart(10, "0");
  const csv =
    "﻿شماره پرسنلی,نام و نام خانوادگی,ایمیل,موبایل\r\n" +
    `0${n}1,پرستار وارداتی ${fixture.suffix},,۰۹۱۲۱۲۳۴۵۶۷\r\n` +
    `0${n}2,پرستار دوم ${fixture.suffix},,\r\n`;

  await signInAndWait(page, fixture.people.admin.email);
  await page.goto("/admin/personnel/import");
  await expect(
    page.getByRole("link", { name: "دریافت فایل نمونه CSV" }),
  ).toHaveAttribute("href", "/personnel-import-sample.csv");
  const form = page.getByRole("form", { name: "بارگذاری فایل پرسنل" });
  await form.getByLabel("فایل CSV").setInputFiles({
    name: "nicu.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv, "utf8"),
  });
  await form.getByLabel("بخش مقصد").selectOption({ label: fixture.own.name });
  await form.getByRole("button", { name: "بررسی و پیش‌نمایش" }).click();

  await expect(page.getByText("ایجاد حساب و عضویت: ۲")).toBeVisible();
  await expect(
    // A card on phones, a table row from md up: whichever layout is shown.
    page
      .getByText(`پرستار وارداتی ${fixture.suffix}`)
      .filter({ visible: true })
      .first(),
  ).toBeVisible();
  await noOverflow(page);
  await page.getByRole("checkbox", { name: /پیش‌نمایش را بررسی کردم/ }).check();
  await page.getByRole("button", { name: "ثبت نهایی" }).click();
  await expect(page.getByText(/ثبت انجام شد: ۲ حساب جدید/)).toBeVisible();
  await page
    .getByRole("button", { name: "ساخت رمز موقت برای حساب‌های جدید" })
    .click();
  const passwords = page.getByRole("region", { name: "رمزهای موقت" });
  await expect(passwords.getByRole("row")).toHaveCount(3);
  await noOverflow(page);
  // Imported people are not added to existing schedules automatically.
  expect(await rosterOf(scheduleId)).toEqual(rosterBefore);

  await signOut(page);
  await signInAndWait(page, fixture.people.head.email);
  await page.goto(
    `/departments/${fixture.own.code}/schedule?schedule=${scheduleId}`,
  );
  await page.getByRole("button", { name: /افزودن پرسنل به برنامه/ }).click();
  const dialog = page.getByRole("dialog", {
    name: "افزودن پرسنل به فهرست برنامه",
  });
  await dialog
    .getByRole("checkbox", {
      name: new RegExp(`پرستار وارداتی ${fixture.suffix}`),
    })
    .check();
  await dialog.getByRole("button", { name: "افزودن ۱ نفر" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByText(/۱ نفر به فهرست پرسنل برنامه اضافه شدند/),
  ).toBeVisible();
  const roster = await rosterOf(scheduleId);
  expect(roster).toHaveLength(rosterBefore.length + 1);
  expect(roster.map((r) => r.displayName)).toContain(
    `پرستار وارداتی ${fixture.suffix}`,
  );
  await noOverflow(page);
});
