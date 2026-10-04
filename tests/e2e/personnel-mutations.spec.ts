import { expect, test, type Page } from "@playwright/test";

import { addDays } from "../../src/domain/shared/dates";
import { formatJalaliInput } from "../../src/features/calendar/jalali-input";
import { signInAndWait } from "./support/auth";
import { provisionPersonnel } from "./support/personnel";
import {
  createPersonnelRoster,
  personByEmail,
  readPersonMutationState,
  readPersonnelRoster,
} from "./support/personnel-mutations";

let fixture: Awaited<ReturnType<typeof provisionPersonnel>>;
test.beforeEach(async () => {
  fixture = await provisionPersonnel();
});
const detail = (id: string) => `/admin/personnel/${id}`;

async function adminDetail(page: Page, id: string) {
  await signInAndWait(page, fixture.people.admin.email);
  await page.goto(detail(id));
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);
}

test("admin creates an account with a personnel number, sees a one-time temporary password, and edits only the basic profile", async ({
  page,
}) => {
  await signInAndWait(page, fixture.people.admin.email);
  await page.goto("/admin/personnel");
  await page.getByRole("link", { name: "ایجاد کاربر", exact: true }).click();
  const email = `created.${fixture.suffix}@people-e2e.invalid`;
  const name = `کاربر جدید ${fixture.suffix}`;
  const personnelNumber = `9${BigInt(`0x${fixture.suffix}`).toString().padStart(10, "0")}`;
  const form = page.getByRole("form", { name: "ایجاد حساب کاربر" });
  await form.getByLabel("شماره پرسنلی").fill(personnelNumber);
  await form.getByLabel("نام و نام خانوادگی").fill(name);
  await form.getByLabel("ایمیل (اختیاری)").fill(email);
  await expect(form.getByLabel("همین حالا رمز موقت ساخته شود")).toBeChecked();
  await expect(form.getByLabel(/رمز عبور/)).toHaveCount(0);
  await form.getByRole("button", { name: "ایجاد حساب", exact: true }).click();
  const temporary = page.getByTestId("temporary-password");
  await expect(temporary).toHaveText(/^[A-Za-z0-9]{4}(-[A-Za-z0-9]{4}){3}$/);
  const issuedPassword = (await temporary.textContent())!;
  await noOverflow(page);
  await page.getByRole("button", { name: "تحویل دادم؛ پنهان شود" }).click();
  await expect(page).toHaveURL(/\/admin\/personnel\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await expect(page.getByTestId("temporary-password")).toHaveCount(0);
  await expect(page.getByText(personnelNumber, { exact: true })).toBeVisible();
  const created = (await personByEmail(email))!;
  expect(created.isHospitalAdmin).toBe(false);
  await page
    .getByRole("button", { name: "ویرایش اطلاعات حساب", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "ویرایش اطلاعات حساب" });
  const updatedName = `نام ویرایش‌شده ${fixture.suffix}`;
  const updatedEmail = `updated.${fixture.suffix}@people-e2e.invalid`;
  await dialog.getByLabel("نام نمایشی").fill(updatedName);
  await dialog.getByLabel("ایمیل (اختیاری)").fill(updatedEmail);
  await expect(dialog.getByLabel(/رمز/)).toHaveCount(0);
  await dialog.getByRole("button", { name: "ذخیره اطلاعات" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("heading", { name: updatedName, exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "بازگشت به کاربران بیمارستان" }).click();
  await page
    .getByLabel("جستجو با نام، شماره پرسنلی یا ایمیل")
    .fill(personnelNumber);
  await page.getByRole("button", { name: "اعمال فیلتر" }).click();
  await page
    .getByRole("list", { name: "فهرست کاربران" })
    .getByRole("link", { name: updatedName, exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: updatedName, exact: true }),
  ).toBeVisible();
  const state = await readPersonMutationState(fixture, created.id);
  expect(state.events.map((e) => e.action)).toEqual([
    "user.created",
    "user.temporaryCredentialIssued",
    "user.profileChanged",
  ]);
  expect(state.history.memberships).toEqual([]);
  expect(JSON.stringify(state.events)).not.toMatch(
    /password|hash|token|secret/i,
  );
  expect(JSON.stringify(state.events)).not.toContain(issuedPassword);
});

test("create form reports Persian personnel-number and duplicate errors", async ({
  page,
}) => {
  await signInAndWait(page, fixture.people.admin.email);
  await page.goto("/admin/personnel/new");
  const form = page.getByRole("form", { name: "ایجاد حساب کاربر" });
  await form.getByLabel("شماره پرسنلی").fill("12-34");
  await form.getByLabel("نام و نام خانوادگی").fill("نام تکراری");
  await form.getByLabel("ایمیل (اختیاری)").fill("invalid");
  await form.getByRole("button", { name: "ایجاد حساب" }).click();
  await expect(form.getByRole("alert")).toBeVisible();
  await expect(form.getByLabel("شماره پرسنلی")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(form.getByLabel("ایمیل (اختیاری)")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await form
    .getByLabel("شماره پرسنلی")
    .fill(`7${fixture.suffix.replace(/\D/g, "1")}`);
  await form.getByLabel("ایمیل (اختیاری)").fill(fixture.people.nurse.email);
  await form.getByRole("button", { name: "ایجاد حساب" }).click();
  await expect(form.getByRole("alert")).toContainText(
    "این ایمیل قبلاً برای حساب دیگری ثبت شده است",
  );
  expect(
    (await readPersonMutationState(fixture, fixture.people.nurse.id)).events,
  ).toEqual([]);
});

test("admin adds past/current/future fixed-term memberships, ends current membership, and sees preserved history", async ({
  page,
}) => {
  const person = fixture.people.outsider;
  await adminDetail(page, person.id);
  const before = (await readPersonMutationState(fixture, person.id)).history
    .memberships;
  for (const [startOffset, endOffset] of [
    [-90, -20],
    [-2, 10],
    [20, 30],
  ] as const) {
    await page
      .getByRole("button", { name: "افزودن عضویت", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "افزودن عضویت" });
    await dialog
      .getByLabel("بخش", { exact: true })
      .selectOption(fixture.own.id);
    await dialog.getByLabel("نقش عضویت", { exact: true }).selectOption("NURSE");
    await dialog
      .getByLabel("تاریخ شروع (شمسی)")
      .fill(formatJalaliInput(addDays(fixture.today, startOffset)));
    await dialog
      .getByLabel("تاریخ پایان عضویت جدید (شمسی، اختیاری)")
      .fill(formatJalaliInput(addDays(fixture.today, endOffset)));
    await dialog.getByRole("button", { name: "ثبت عضویت" }).click();
    await expect(dialog).not.toBeVisible();
  }
  await page
    .getByRole("button", {
      name: `پایان عضویت در ${fixture.own.name}`,
      exact: true,
    })
    .click();
  const dialog = page.getByRole("dialog", { name: "پایان عضویت", exact: true });
  await expect(dialog.getByText(/حساب کاربر غیرفعال نمی‌شود/)).toBeVisible();
  await dialog.getByRole("button", { name: "ثبت پایان عضویت" }).click();
  await expect(dialog).not.toBeVisible();
  const state = await readPersonMutationState(fixture, person.id);
  const local = state.history.memberships.filter(
    (m) => m.departmentId === fixture.own.id,
  );
  expect(local).toHaveLength(3);
  expect(local[1]?.endedOn).toBe(fixture.today);
  expect(
    state.history.memberships.filter(
      (m) => m.departmentId === fixture.other.id,
    ),
  ).toEqual(before);
  expect(state.user?.isActive).toBe(true);
  expect(state.events.map((e) => e.action)).toEqual([
    "membership.added",
    "membership.added",
    "membership.added",
    "membership.ended",
  ]);
  const history = page.getByRole("region", { name: "تاریخچه عضویت" });
  for (const status of ["جاری", "آینده", "پایان‌یافته"])
    await expect(
      history.getByText(status, { exact: true }).first(),
    ).toBeVisible();
  await expect(history.getByRole("button")).toHaveCount(0);
  await noOverflow(page);
});

test("admin changes role and transfers atomically, with a clear same-day boundary error and unchanged old roster", async ({
  page,
}) => {
  const person = fixture.people.nurse;
  const scheduleId = await createPersonnelRoster(fixture, 0);
  const roster = await readPersonnelRoster(scheduleId);
  await adminDetail(page, person.id);
  await page
    .getByRole("button", {
      name: `تغییر نقش عضویت در ${fixture.own.name}`,
      exact: true,
    })
    .click();
  let dialog = page.getByRole("dialog", { name: "تغییر نقش عضویت" });
  await expect(dialog.getByLabel("نقش جدید")).toHaveValue("HEAD_NURSE");
  await dialog.getByRole("button", { name: "ثبت تغییر نقش" }).click();
  await expect(dialog).not.toBeVisible();
  await page
    .getByRole("button", {
      name: `انتقال به بخش دیگر در ${fixture.own.name}`,
      exact: true,
    })
    .click();
  dialog = page.getByRole("dialog", { name: "انتقال به بخش دیگر" });
  await dialog
    .getByLabel("بخش مقصد", { exact: true })
    .selectOption(fixture.other.id);
  await dialog.getByLabel("نقش در بخش مقصد").selectOption("NURSE");
  await dialog.getByRole("button", { name: "ثبت انتقال" }).click();
  await expect(dialog.getByRole("alert")).toContainText("امروز شروع شده");
  await expect(dialog.getByLabel("تاریخ مؤثر تغییر (شمسی)")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await dialog
    .getByLabel("تاریخ مؤثر تغییر (شمسی)")
    .fill(formatJalaliInput(addDays(fixture.today, 1)));
  await dialog.getByRole("button", { name: "ثبت انتقال" }).click();
  await expect(dialog).not.toBeVisible();
  const state = await readPersonMutationState(fixture, person.id);
  expect(
    state.history.memberships.map((m) => [m.departmentId, m.role, m.endedOn]),
  ).toEqual([
    [fixture.own.id, "NURSE", addDays(fixture.today, -1)],
    [fixture.own.id, "HEAD_NURSE", fixture.today],
    [fixture.other.id, "NURSE", null],
  ]);
  expect(
    state.events
      .filter((e) => e.action.startsWith("membership."))
      .map((e) => e.action),
  ).toEqual(["membership.roleChanged", "membership.transferred"]);
  expect(await readPersonnelRoster(scheduleId)).toEqual(roster);
  await expect(
    page
      .getByRole("region", { name: "تاریخچه عضویت" })
      .getByText("آینده", { exact: true }),
  ).toBeVisible();
  await noOverflow(page);
});

test("deactivation requires confirmation, revokes old-cookie access, preserves memberships/roster, and reactivation restores eligibility", async ({
  page,
  browser,
  baseURL,
}) => {
  const person = fixture.people.nurse;
  const oldSchedule = await createPersonnelRoster(fixture, 0);
  const oldRoster = await readPersonnelRoster(oldSchedule);
  const original = (await readPersonMutationState(fixture, person.id)).history;
  const nurseContext = await browser.newContext({
    baseURL,
    locale: "fa-IR",
    timezoneId: "Asia/Tehran",
  });
  const nursePage = await nurseContext.newPage();
  try {
    await signInAndWait(nursePage, person.email);
    await adminDetail(page, person.id);
    await page
      .getByRole("button", { name: "غیرفعال‌سازی حساب", exact: true })
      .click();
    let dialog = page.getByRole("dialog", { name: "غیرفعال‌سازی حساب" });
    await expect(
      dialog.getByText(/عضویت‌ها خودکار پایان نمی‌یابند/),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "انصراف" }).click();
    expect(
      (await readPersonMutationState(fixture, person.id)).user?.isActive,
    ).toBe(true);
    await page
      .getByRole("button", { name: "غیرفعال‌سازی حساب", exact: true })
      .click();
    dialog = page.getByRole("dialog", { name: "غیرفعال‌سازی حساب" });
    await dialog
      .getByRole("button", { name: "غیرفعال‌سازی حساب", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    await expect(
      page.getByRole("button", { name: "فعال‌سازی حساب", exact: true }),
    ).toBeVisible();
    const inactive = await readPersonMutationState(fixture, person.id);
    expect(inactive.history).toEqual(original);
    expect(await readPersonnelRoster(oldSchedule)).toEqual(oldRoster);
    const newSchedule = await createPersonnelRoster(fixture, 7);
    expect(
      (await readPersonnelRoster(newSchedule)).map((r) => r.userId),
    ).not.toContain(person.id);
    await nursePage.goto("/my-shifts");
    await expect(nursePage).toHaveURL(/\/login/);
    await page
      .getByRole("button", { name: "فعال‌سازی حساب", exact: true })
      .click();
    dialog = page.getByRole("dialog", { name: "فعال‌سازی حساب" });
    await dialog
      .getByRole("button", { name: "فعال‌سازی حساب", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    expect(
      (await readPersonMutationState(fixture, person.id)).events
        .filter((e) => e.entityId === person.id)
        .map((e) => e.action),
    ).toEqual(["user.deactivated", "user.activated"]);
    const reactivatedSchedule = await createPersonnelRoster(fixture, 14);
    expect(
      (await readPersonnelRoster(reactivatedSchedule)).map((r) => r.userId),
    ).toContain(person.id);
    expect(await readPersonnelRoster(oldSchedule)).toEqual(oldRoster);
    await noOverflow(page);
  } finally {
    await nurseContext.close();
  }
});

test("a stale profile dialog refuses overwrite and provides an explicit refresh/review action", async ({
  page,
  context,
}) => {
  const person = fixture.people.nurse;
  await adminDetail(page, person.id);
  const other = await context.newPage();
  try {
    await other.goto(detail(person.id));
    await page
      .getByRole("button", { name: "ویرایش اطلاعات حساب", exact: true })
      .click();
    await other
      .getByRole("button", { name: "ویرایش اطلاعات حساب", exact: true })
      .click();
    const otherDialog = other.getByRole("dialog", {
      name: "ویرایش اطلاعات حساب",
    });
    await otherDialog.getByLabel("نام نمایشی").fill("نام جدید از صفحه دیگر");
    await otherDialog.getByRole("button", { name: "ذخیره اطلاعات" }).click();
    await expect(otherDialog).not.toBeVisible();
    const dialog = page.getByRole("dialog", { name: "ویرایش اطلاعات حساب" });
    await dialog.getByLabel("نام نمایشی").fill("ویرایش قدیمی");
    await dialog.getByRole("button", { name: "ذخیره اطلاعات" }).click();
    await expect(dialog.getByRole("alert")).toContainText(
      "از زمان باز شدن فرم",
    );
    expect(
      (await readPersonMutationState(fixture, person.id)).user?.displayName,
    ).toBe("نام جدید از صفحه دیگر");
    await dialog.getByRole("button", { name: "بازخوانی اطلاعات" }).click();
    await expect(dialog).not.toBeVisible();
    await expect(
      page.getByRole("heading", { name: "نام جدید از صفحه دیگر", exact: true }),
    ).toBeVisible();
  } finally {
    await other.close();
  }
});

for (const role of ["head", "supervisor", "nurse"] as const) {
  test(`${role} has no mutation controls and cannot open account creation`, async ({
    page,
  }) => {
    await signInAndWait(page, fixture.people[role].email);
    if (role !== "nurse") {
      await page.goto(`/departments/${fixture.own.code}/people`);
      await expect(
        page.locator("main").getByRole("button", {
          name: /ایجاد|ویرایش|عضویت|انتقال|فعال‌سازی|تغییر نقش/,
        }),
      ).toHaveCount(0);
    }
    const response = await page.goto("/admin/personnel/new");
    expect(response?.status()).toBe(404);
    await expect(
      page.getByRole("heading", { name: "صفحه پیدا نشد" }),
    ).toBeVisible();
    expect(
      (await readPersonMutationState(fixture, fixture.people.nurse.id)).events,
    ).toEqual([]);
  });
}
