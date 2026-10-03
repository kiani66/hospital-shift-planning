import { expect, test, type Page } from "@playwright/test";

import { formatJalaliDate } from "../../src/features/calendar/jalali";
import { isDesktop, mainNav, signInAndWait } from "./support/auth";
import { provisionPersonnel } from "./support/personnel";

let fixture: Awaited<ReturnType<typeof provisionPersonnel>>;
test.beforeEach(async () => {
  fixture = await provisionPersonnel();
});

async function scopedNavigation(page: Page) {
  if (isDesktop(page)) return mainNav(page);
  await mainNav(page).getByRole("link", { name: "بیشتر" }).click();
  return page.getByRole("navigation", { name: "همه بخش‌ها" });
}

async function concealed(page: Page, path: string) {
  const response = await page.goto(path);
  expect(response?.status(), path).toBe(404);
  await expect(
    page.getByRole("heading", { name: "صفحه پیدا نشد" }),
  ).toBeVisible();
  await expect(
    page.getByText(fixture.people.timeline.email, { exact: true }),
  ).toHaveCount(0);
}

test("Hospital Admin reaches the directory, searches/filters, and reads Jalali histories", async ({
  page,
}) => {
  await signInAndWait(page, fixture.people.admin.email);
  await mainNav(page).getByRole("link", { name: "کاربران بیمارستان" }).click();
  await expect(
    page.getByRole("heading", { name: "کاربران بیمارستان", exact: true }),
  ).toBeVisible();
  const form = page.getByRole("form", { name: "جستجو و فیلتر کاربران" });
  await form.getByLabel("جستجو با نام یا ایمیل").fill(fixture.suffix);
  await form.getByRole("button", { name: "اعمال فیلتر" }).click();
  const list = page.getByRole("list", { name: "فهرست کاربران" });
  await expect(list.locator(":scope > li")).toHaveCount(6);
  await form.getByLabel("وضعیت حساب").selectOption("inactive");
  await form.getByLabel("بخش جاری").selectOption(fixture.own.id);
  await form.getByLabel("نقش عضویت جاری").selectOption("HEAD_NURSE");
  await form.getByRole("button", { name: "اعمال فیلتر" }).click();
  await expect(list.locator(":scope > li")).toHaveCount(1);
  await expect(list.getByText("حساب غیرفعال")).toBeVisible();
  await list
    .getByRole("link", { name: fixture.people.timeline.displayName })
    .click();
  await expect(
    page.getByRole("heading", {
      name: fixture.people.timeline.displayName,
      exact: true,
    }),
  ).toBeVisible();
  for (const title of ["تاریخچه عضویت", "تاریخچه نظارت"]) {
    const section = page.getByRole("region", { name: title });
    await expect(section.getByRole("listitem")).toHaveCount(3);
    for (const status of ["جاری", "آینده", "پایان‌یافته"])
      await expect(section.getByText(status, { exact: true })).toBeVisible();
    await expect(
      section
        .getByText(formatJalaliDate(fixture.today), { exact: true })
        .first(),
    ).toBeVisible();
  }
  await expect(
    page.locator("main").getByRole("button", {
      name: /اعطای نقش مدیر|حذف نقش مدیر|افزودن سوپروایزر|پایان نظارت/,
    }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);
});

test("Hospital Admin filters system authority and searches a login identifier", async ({
  page,
}) => {
  await signInAndWait(page, fixture.people.admin.email);
  await page.goto("/admin/personnel");
  await page
    .getByLabel("جستجو با نام یا ایمیل")
    .fill(fixture.people.admin.email.toUpperCase());
  await page.getByLabel("نقش سیستمی").selectOption("admin");
  await page.getByRole("button", { name: "اعمال فیلتر" }).click();
  const list = page.getByRole("list", { name: "فهرست کاربران" });
  await expect(list.locator(":scope > li")).toHaveCount(1);
  await expect(list.getByText("مدیر بیمارستان", { exact: true })).toBeVisible();
  await page.getByLabel("نقش سیستمی").selectOption("other");
  await page.getByRole("button", { name: "اعمال فیلتر" }).click();
  await expect(
    page.getByRole("heading", { name: "کاربری یافت نشد" }),
  ).toBeVisible();
});

test("Head Nurse sees only current department people without global account details", async ({
  page,
}) => {
  await signInAndWait(page, fixture.people.head.email);
  const nav = await scopedNavigation(page);
  await expect(
    nav.getByRole("link", { name: "کاربران بیمارستان" }),
  ).toHaveCount(0);
  await nav
    .getByRole("link", { name: `افراد بخش (${fixture.own.name})` })
    .click();
  await expect(
    page.getByRole("heading", {
      name: `افراد بخش ${fixture.own.name}`,
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page
      .locator("main")
      .getByText(fixture.people.nurse.displayName, { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator("main")
      .getByText(fixture.people.timeline.displayName, { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator("main").getByText("حساب غیرفعال", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator("main")
      .getByText(fixture.people.outsider.displayName, { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.locator("main").getByText(fixture.people.nurse.email, { exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);
  await concealed(page, `/departments/${fixture.other.code}/people`);
  await concealed(page, "/admin/personnel");
  await concealed(page, `/admin/personnel/${fixture.people.timeline.id}`);
});

test("Supervisor navigation and reads stay within currently supervised scope", async ({
  page,
}) => {
  await signInAndWait(page, fixture.people.supervisor.email);
  const nav = await scopedNavigation(page);
  await expect(
    nav.getByRole("link", { name: `افراد بخش (${fixture.other.name})` }),
  ).toHaveCount(0);
  await nav
    .getByRole("link", { name: `افراد بخش (${fixture.own.name})` })
    .click();
  await expect(
    page
      .locator("main")
      .getByText(fixture.people.nurse.displayName, { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "سوپروایزرهای جاری بخش" })
      .getByText(fixture.people.supervisor.displayName, { exact: true }),
  ).toBeVisible();
  await concealed(page, `/departments/${fixture.other.code}/people`);
  await concealed(page, "/admin/personnel");
  await concealed(page, `/admin/personnel/${fixture.people.timeline.id}`);
});

test("Nurse has no personnel navigation and management URLs are concealed", async ({
  page,
}) => {
  await signInAndWait(page, fixture.people.nurse.email);
  await expect(
    mainNav(page).getByRole("link", { name: /کاربران بیمارستان|افراد بخش/ }),
  ).toHaveCount(0);
  await concealed(page, "/admin/personnel");
  await concealed(page, `/admin/personnel/${fixture.people.timeline.id}`);
  await concealed(page, `/departments/${fixture.own.code}/people`);
  await concealed(page, "/departments/unknown-people/people");
});
