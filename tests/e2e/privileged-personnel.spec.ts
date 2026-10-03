import { expect, test, type Page } from "@playwright/test";

import { addDays } from "../../src/domain/shared/dates";
import { formatJalaliInput } from "../../src/features/calendar/jalali-input";
import { mainNav, signInAndWait } from "./support/auth";
import { lastAdminTest } from "./support/last-admin";
import { provisionPersonnel } from "./support/personnel";
import { readPersonMutationState } from "./support/personnel-mutations";

let fixture: Awaited<ReturnType<typeof provisionPersonnel>>;
test.beforeEach(async () => {
  fixture = await provisionPersonnel();
});
async function adminDetail(page: Page, userId: string) {
  await signInAndWait(page, fixture.people.admin.email);
  await page.goto(`/admin/personnel/${userId}`);
  await expect(
    page.getByRole("region", { name: "نقش مدیریتی سیستم" }),
  ).toBeVisible();
}
async function authority(page: Page, grant: boolean) {
  const title = grant ? "اعطای نقش مدیر بیمارستان" : "حذف نقش مدیر بیمارستان";
  await page.getByRole("button", { name: title, exact: true }).click();
  return page.getByRole("dialog", { name: title });
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
}

test("admin grants/removes authority; the target's existing session gains/loses navigation on the next request", async ({
  page,
  browser,
  baseURL,
}) => {
  const target = fixture.people.nurse;
  const targetContext = await browser.newContext({
    baseURL,
    viewport: page.viewportSize()!,
    locale: "fa-IR",
    timezoneId: "Asia/Tehran",
  });
  const targetPage = await targetContext.newPage();
  try {
    await signInAndWait(targetPage, target.email);
    await expect(
      mainNav(targetPage).getByRole("link", { name: "کاربران بیمارستان" }),
    ).toHaveCount(0);
    await adminDetail(page, target.id);
    const before = (await readPersonMutationState(fixture, target.id)).history;
    let dialog = await authority(page, true);
    await expect(
      dialog.getByText(/نقش سیستمی مستقل از عضویت بخش/),
    ).toBeVisible();
    await dialog
      .getByRole("button", { name: "اعطای نقش مدیر بیمارستان", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    await targetPage.reload();
    await expect(
      mainNav(targetPage).getByRole("link", { name: "کاربران بیمارستان" }),
    ).toBeVisible();
    expect((await targetPage.goto("/admin/personnel"))?.status()).toBe(200);
    dialog = await authority(page, false);
    await dialog.getByRole("button", { name: "انصراف", exact: true }).click();
    expect(
      (await readPersonMutationState(fixture, target.id)).user?.isHospitalAdmin,
    ).toBe(true);
    dialog = await authority(page, false);
    await dialog
      .getByRole("button", { name: "حذف نقش مدیر بیمارستان", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    expect((await targetPage.goto("/admin/personnel"))?.status()).toBe(404);
    await targetPage.goto("/my-shifts");
    await expect(
      mainNav(targetPage).getByRole("link", { name: "کاربران بیمارستان" }),
    ).toHaveCount(0);
    const state = await readPersonMutationState(fixture, target.id);
    expect(state.history).toEqual(before);
    expect(state.user).toMatchObject({
      isActive: true,
      isHospitalAdmin: false,
    });
    expect(state.events.map((e) => [e.action, e.data])).toEqual([
      ["user.hospitalAdminChanged", { before: false, after: true }],
      ["user.hospitalAdminChanged", { before: true, after: false }],
    ]);
    await noOverflow(page);
  } finally {
    await targetContext.close();
  }
});

test("inactive authority is visibly stored and does not activate the account", async ({
  page,
}) => {
  const target = fixture.people.timeline;
  await adminDetail(page, target.id);
  const dialog = await authority(page, true);
  await expect(
    dialog.getByText(/تا فعال‌سازی صریح حساب هیچ دسترسی/),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "اعطای نقش مدیر بیمارستان", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "نقش مدیریتی سیستم" })
      .getByText(/تا فعال‌سازی صریح حساب دسترسی نمی‌دهد/),
  ).toBeVisible();
  expect(
    (await readPersonMutationState(fixture, target.id)).user,
  ).toMatchObject({ isActive: false, isHospitalAdmin: true });
  await expect(
    page.getByRole("button", { name: "فعال‌سازی حساب", exact: true }),
  ).toBeVisible();
});

test("self-demotion warns, redirects, removes controls/navigation and denies an old admin tab", async ({
  page,
  context,
}) => {
  await adminDetail(page, fixture.people.nurse.id);
  let dialog = await authority(page, true);
  await dialog
    .getByRole("button", { name: "اعطای نقش مدیر بیمارستان", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  const stale = await context.newPage();
  try {
    await stale.goto(`/admin/personnel/${fixture.people.outsider.id}`);
    const staleForm = await authority(stale, true);
    await page.goto(`/admin/personnel/${fixture.people.admin.id}`);
    dialog = await authority(page, false);
    await expect(
      dialog.getByText("هشدار: حذف اختیار مدیریتی خود", { exact: true }),
    ).toBeVisible();
    await dialog
      .getByRole("button", { name: "حذف نقش مدیر بیمارستان", exact: true })
      .click();
    await expect(page).toHaveURL(/\/my-shifts$/);
    await expect(
      mainNav(page).getByRole("link", { name: "کاربران بیمارستان" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", {
        name: /اعطای نقش مدیر|حذف نقش مدیر|افزودن سوپروایزر/,
      }),
    ).toHaveCount(0);
    await staleForm
      .getByRole("button", { name: "اعطای نقش مدیر بیمارستان", exact: true })
      .click();
    await expect(staleForm.getByRole("alert")).toContainText("اجازه");
    expect(
      (await readPersonMutationState(fixture, fixture.people.outsider.id)).user
        ?.isHospitalAdmin,
    ).toBe(false);
    expect((await page.goto("/admin/personnel"))?.status()).toBe(404);
  } finally {
    await stale.close();
  }
});

test("stale authority state is refused and refresh requires reviewing the new flags", async ({
  page,
  context,
}) => {
  await adminDetail(page, fixture.people.nurse.id);
  const other = await context.newPage();
  try {
    await other.goto(`/admin/personnel/${fixture.people.nurse.id}`);
    const stale = await authority(other, true);
    const fresh = await authority(page, true);
    await fresh
      .getByRole("button", { name: "اعطای نقش مدیر بیمارستان", exact: true })
      .click();
    await expect(fresh).not.toBeVisible();
    await stale
      .getByRole("button", { name: "اعطای نقش مدیر بیمارستان", exact: true })
      .click();
    await expect(stale.getByRole("alert")).toContainText("صفحه را تازه کنید");
    expect(
      (await readPersonMutationState(fixture, fixture.people.nurse.id)).events,
    ).toHaveLength(1);
    await stale
      .getByRole("button", { name: "بازخوانی اطلاعات", exact: true })
      .click();
    await expect(stale).not.toBeVisible();
    await expect(
      other.getByRole("button", {
        name: "حذف نقش مدیر بیمارستان",
        exact: true,
      }),
    ).toBeVisible();
  } finally {
    await other.close();
  }
});

test("admin assigns current/future fixed-term Supervisor access and ends it inclusively with visible preserved history", async ({
  page,
}) => {
  const target = fixture.people.nurse;
  await adminDetail(page, target.id);
  const before = (await readPersonMutationState(fixture, target.id)).history
    .memberships;
  for (const [start, end] of [
    [0, 10],
    [20, 30],
  ] as const) {
    await page
      .getByRole("button", { name: "افزودن سوپروایزر", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "افزودن سوپروایزر" });
    await dialog
      .getByLabel("بخش نظارت", { exact: true })
      .selectOption(fixture.own.id);
    await dialog
      .getByLabel("تاریخ شروع نظارت (شمسی)")
      .fill(formatJalaliInput(addDays(fixture.today, start)));
    await dialog
      .getByLabel("تاریخ پایان نظارت (شمسی، اختیاری)")
      .fill(formatJalaliInput(addDays(fixture.today, end)));
    await dialog
      .getByRole("button", { name: "ثبت دسترسی سوپروایزر", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
  }
  await page
    .getByRole("button", {
      name: `پایان نظارت در ${fixture.own.name}`,
      exact: true,
    })
    .click();
  const dialog = page.getByRole("dialog", { name: "پایان نظارت", exact: true });
  await expect(dialog.getByText(/سپس در تاریخچه حفظ می‌شود/)).toBeVisible();
  await dialog
    .getByRole("button", { name: "ثبت پایان نظارت", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  const state = await readPersonMutationState(fixture, target.id);
  expect(state.history.memberships).toEqual(before);
  expect(
    state.history.supervisors.map((s) => [s.startedOn, s.endedOn]),
  ).toEqual([
    [fixture.today, fixture.today],
    [addDays(fixture.today, 20), addDays(fixture.today, 30)],
  ]);
  expect(state.events.map((e) => e.action)).toEqual([
    "supervisor.assigned",
    "supervisor.assigned",
    "supervisor.ended",
  ]);
  const history = page.getByRole("region", { name: "تاریخچه نظارت" });
  await expect(history.getByRole("listitem")).toHaveCount(2);
  await expect(history.getByText("آینده", { exact: true })).toBeVisible();
  await expect(history.getByRole("button")).toHaveCount(0);
  await noOverflow(page);
});

test("Supervisor overlap and stale ending show safe feedback without extra writes", async ({
  page,
  context,
}) => {
  await adminDetail(page, fixture.people.supervisor.id);
  await page
    .getByRole("button", { name: "افزودن سوپروایزر", exact: true })
    .click();
  let dialog = page.getByRole("dialog", { name: "افزودن سوپروایزر" });
  await dialog
    .getByLabel("بخش نظارت", { exact: true })
    .selectOption(fixture.own.id);
  await dialog
    .getByRole("button", { name: "ثبت دسترسی سوپروایزر", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("هم‌پوشانی");
  await dialog.getByRole("button", { name: "انصراف", exact: true }).click();
  const other = await context.newPage();
  try {
    await other.goto(`/admin/personnel/${fixture.people.supervisor.id}`);
    await other
      .getByRole("button", {
        name: `پایان نظارت در ${fixture.own.name}`,
        exact: true,
      })
      .click();
    const stale = other.getByRole("dialog", {
      name: "پایان نظارت",
      exact: true,
    });
    await page
      .getByRole("button", {
        name: `پایان نظارت در ${fixture.own.name}`,
        exact: true,
      })
      .click();
    dialog = page.getByRole("dialog", { name: "پایان نظارت", exact: true });
    await dialog
      .getByLabel("تاریخ پایان نظارت (شمسی)")
      .fill(formatJalaliInput(addDays(fixture.today, 2)));
    await dialog
      .getByRole("button", { name: "ثبت پایان نظارت", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    await stale
      .getByRole("button", { name: "ثبت پایان نظارت", exact: true })
      .click();
    await expect(stale.getByRole("alert")).toContainText("صفحه را تازه کنید");
    expect(
      (
        await readPersonMutationState(fixture, fixture.people.supervisor.id)
      ).events.map((e) => e.action),
    ).toEqual(["supervisor.ended"]);
  } finally {
    await other.close();
  }
});

for (const role of ["head", "supervisor", "nurse"] as const) {
  test(`${role} cannot access privileged management; scoped views contain no elevated controls`, async ({
    page,
  }) => {
    await signInAndWait(page, fixture.people[role].email);
    if (role !== "nurse") {
      await page.goto(`/departments/${fixture.own.code}/people`);
      await expect(
        page.getByRole("button", {
          name: /اعطای نقش مدیر|حذف نقش مدیر|افزودن سوپروایزر|پایان نظارت/,
        }),
      ).toHaveCount(0);
    }
    expect(
      (
        await page.goto(`/admin/personnel/${fixture.people.nurse.id}`)
      )?.status(),
    ).toBe(404);
    expect(
      (await readPersonMutationState(fixture, fixture.people.nurse.id)).events,
    ).toEqual([]);
  });
}

lastAdminTest(
  "the sole active admin cannot remove authority or deactivate through confirmation dialogs",
  async ({ browser, lastAdminServer }) => {
    lastAdminTest.setTimeout(60_000);
    const isolated = await browser.newContext({
      baseURL: lastAdminServer.baseURL,
      locale: "fa-IR",
      timezoneId: "Asia/Tehran",
    });
    try {
      const page = await isolated.newPage();
      await signInAndWait(page, lastAdminServer.admin.email);
      await page.goto(`/admin/personnel/${lastAdminServer.admin.id}`);
      let dialog = await authority(page, false);
      await dialog
        .getByRole("button", { name: "حذف نقش مدیر بیمارستان", exact: true })
        .click();
      await expect(dialog.getByRole("alert")).toContainText("آخرین مدیر فعال");
      await dialog.getByRole("button", { name: "انصراف", exact: true }).click();
      await page
        .getByRole("button", { name: "غیرفعال‌سازی حساب", exact: true })
        .click();
      dialog = page.getByRole("dialog", { name: "غیرفعال‌سازی حساب" });
      await dialog
        .getByRole("button", { name: "غیرفعال‌سازی حساب", exact: true })
        .click();
      await expect(dialog.getByRole("alert")).toContainText("آخرین مدیر فعال");
      expect(await lastAdminServer.activeAdminCount()).toBe(1);
      await dialog.getByRole("button", { name: "انصراف", exact: true }).click();
      await page.reload();
      await expect(
        mainNav(page).getByRole("link", { name: "کاربران بیمارستان" }),
      ).toBeVisible();
    } finally {
      await isolated.close();
    }
  },
);
