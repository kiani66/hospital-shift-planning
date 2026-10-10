import { signInForReset } from "./support/reset-auth";
import { assertResetE2eDatabase } from "../../scripts/support/reset-e2e-safety";
import { eq } from "drizzle-orm";
import { expect, test } from "@playwright/test";
import { createSchedule } from "../../src/application/schedules/create-schedule";
import { setAssignments } from "../../src/application/schedules/edit-assignments";
import { createDatabase } from "../../src/infrastructure/db/database";
import {
  departments,
  users,
  schedules,
  shiftTypes,
  resetOperations,
  changeReasons,
  staffingRuleSetVersions,
  staffingRuleSetRequirements,
} from "../../src/infrastructure/db/schema";
import { loadActor } from "../../src/infrastructure/repositories/memberships";
import { APP_TIMEZONE, todayIn } from "../../src/infrastructure/auth/actor";
import { provisionPersonnel } from "./support/personnel";
import { provisionDepartment } from "./support/workspace";
import { signIn, signOut, IDENTIFIER_LABEL } from "./support/auth";
function isolatedUrl() {
  assertResetE2eDatabase(process.env);
  const url = process.env.DATABASE_URL!;
  if (
    new URL(url).hostname !== "127.0.0.1" ||
    !new URL(url).pathname.includes("phase14_e2e_test")
  )
    throw new Error("Full Reset E2E requires isolated local data");
  return url;
}
test.describe.configure({ mode: "serial", timeout: 60_000 });
// Validate the database before even provisioning fictional fixtures.
test.beforeEach(() => {
  isolatedUrl();
});
test("admin scope preview refuses stale data then deletes only its test department operations", async ({
  page,
}) => {
  const fixture = await provisionDepartment();
  const { db, pool } = createDatabase(isolatedUrl());
  try {
    const [head] = await db
      .select()
      .from(users)
      .where(eq(users.email, fixture.headEmail));
    const [department] = await db
      .select()
      .from(departments)
      .where(eq(departments.code, fixture.code));
    await db
      .update(users)
      .set({ isHospitalAdmin: true })
      .where(eq(users.id, head!.id));
    const ctx = {
      db,
      actor: (await loadActor(db, head!.id, todayIn(APP_TIMEZONE)))!,
    };
    const made = await createSchedule(ctx, {
      departmentId: department!.id,
      periodStart: "2026-10-23",
      periodEnd: "2026-11-21",
      label: "آبان ۱۴۰۵",
    });
    if (!made.ok) throw new Error(made.error.message);
    expect(
      (
        await setAssignments(ctx, {
          scheduleId: made.data.scheduleId,
          expectedRevision: 0,
          changes: [{ nurseId: head!.id, date: "2026-10-24", shift: "OFF" }],
        })
      ).ok,
    ).toBe(true);
    await signInForReset(page, fixture.nurseEmail);
    await page.goto("/admin/reset");
    await expect(
      page.getByRole("heading", { name: "بازنشانی داده آزمایشی" }),
    ).not.toBeVisible();
    await signOut(page);
    await signInForReset(page, fixture.headEmail);
    await page.goto("/admin/reset");
    await page
      .getByRole("checkbox", { name: fixture.name, exact: true })
      .check();
    await expect(
      page.getByRole("checkbox", { name: /تعریف شیفت‌ها/ }),
    ).not.toBeChecked();
    await page
      .getByRole("button", { name: "نمایش پیش‌نمایش بازنشانی" })
      .click();
    const preview = page.getByRole("region", { name: "پیش‌نمایش بازنشانی" });
    await expect(preview).toContainText("آبان ۱۴۰۵");
    expect(
      (
        await setAssignments(ctx, {
          scheduleId: made.data.scheduleId,
          expectedRevision: 1,
          changes: [{ nurseId: head!.id, date: "2026-10-24", shift: "M" }],
        })
      ).ok,
    ).toBe(true);
    await page.getByRole("button", { name: "تأیید و اجرای بازنشانی" }).click();
    await page
      .getByRole("dialog", { name: "حذف داده‌های پیش‌نمایش؟" })
      .getByRole("button", { name: "حذف داده‌های انتخاب‌شده" })
      .click();
    await expect(
      page.getByRole("alert").filter({ hasText: "پیش‌نمایش تازه بگیرید" }),
    ).toContainText("پیش‌نمایش تازه بگیرید");
    await page
      .getByRole("button", { name: "نمایش پیش‌نمایش بازنشانی" })
      .click();
    await page.getByRole("button", { name: "تأیید و اجرای بازنشانی" }).click();
    await page
      .getByRole("dialog", { name: "حذف داده‌های پیش‌نمایش؟" })
      .getByRole("button", { name: "حذف داده‌های انتخاب‌شده" })
      .click();
    await expect(page.getByRole("status")).toContainText("بازنشانی انجام شد");
    expect(
      await db
        .select()
        .from(schedules)
        .where(eq(schedules.departmentId, department!.id)),
    ).toHaveLength(0);
    expect(
      await db.select().from(users).where(eq(users.id, head!.id)),
    ).toHaveLength(1);
    expect(
      (
        await db
          .select()
          .from(resetOperations)
          .where(eq(resetOperations.executingAdminId, head!.id))
      ).some((r) => r.result === "COMPLETED"),
    ).toBe(true);
  } finally {
    await pool.end();
  }
});
test("scoped reset exposes retained identities; explicit correction permits real CSV creation and account reuse", async ({
  page,
}) => {
  const fixture = await provisionPersonnel();
  const { db, pool } = createDatabase(isolatedUrl());
  try {
    const outsider = fixture.people.outsider;
    const [outsiderBefore] = await db
      .select()
      .from(users)
      .where(eq(users.id, outsider.id));
    await signInForReset(page, fixture.people.admin.email);
    await page.goto("/admin/reset");
    await page
      .getByRole("checkbox", { name: fixture.own.name, exact: true })
      .check();
    await page
      .getByRole("button", { name: "نمایش پیش‌نمایش بازنشانی" })
      .click();
    const readiness = page.getByRole("region", { name: "آمادگی ورود پرسنل" });
    await expect(readiness).toContainText(outsider.personnelNumber!);
    await expect(readiness).toContainText("خارج از دامنه");
    await expect(
      readiness.getByRole("link", { name: outsider.displayName, exact: true }),
    ).toHaveAttribute("href", `/admin/personnel/${outsider.id}`);
    await expect(readiness).toContainText(
      fixture.people.timeline.personnelNumber!,
    );
    await expect(readiness).toContainText("غیرفعال");
    await page.getByRole("button", { name: "تأیید و اجرای بازنشانی" }).click();
    await page
      .getByRole("dialog", { name: "حذف داده‌های پیش‌نمایش؟" })
      .getByRole("button", { name: "حذف داده‌های انتخاب‌شده" })
      .click();
    await expect(page.getByRole("status")).toContainText("بازنشانی انجام شد");
    const csv = (rows: string) =>
      "personnel_number,display_name,email\n" + rows;
    async function upload(text: string) {
      await page.goto("/admin/personnel/import");
      const form = page.getByRole("form", { name: "بارگذاری فایل پرسنل" });
      await form.getByLabel("فایل CSV").setInputFiles({
        name: "real-staff.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(text, "utf8"),
      });
      await form
        .getByLabel("بخش مقصد")
        .selectOption({ label: fixture.own.name });
      await form.getByRole("button", { name: "بررسی و پیش‌نمایش" }).click();
    }
    await upload(
      csv(`${outsider.personnelNumber},کارمند واقعی ${fixture.suffix},\n`),
    );
    await expect(
      page
        .getByText("اطلاعات این ردیف با حساب ثبت‌شده", { exact: false })
        .filter({ visible: true }),
    ).toBeVisible();
    await page
      .getByRole("link", { name: "بررسی حساب دارای تعارض" })
      .filter({ visible: true })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/admin/personnel/${outsider.id}$`),
    );
    await page
      .getByRole("button", { name: "اصلاح شماره پرسنلی", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "اصلاح شماره پرسنلی" });
    const approvedCorrectNumber = `9${outsider.personnelNumber}`;
    await dialog
      .getByLabel("شماره پرسنلی", { exact: true })
      .fill(approvedCorrectNumber);
    await dialog
      .getByRole("button", { name: "ثبت اصلاح", exact: true })
      .click();
    await expect(dialog).toBeHidden();
    await upload(
      csv(
        `${outsider.personnelNumber},کارمند واقعی ${fixture.suffix},\n${approvedCorrectNumber},${outsider.displayName},${outsider.email}\n`,
      ),
    );
    await expect(
      page.getByText("ایجاد حساب و عضویت: ۱", { exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("link", {
          name: "حساب موجود؛ استفاده مجدد بدون تغییر هویت و رمز",
        })
        .filter({ visible: true }),
    ).toHaveAttribute("href", `/admin/personnel/${outsider.id}`);
    await page
      .getByRole("checkbox", { name: /پیش‌نمایش را بررسی کردم/ })
      .check();
    await page.getByRole("button", { name: "ثبت نهایی", exact: true }).click();
    await expect(page.getByText(/ثبت انجام شد: ۱ حساب جدید/)).toBeVisible();
    const [retained] = await db
      .select()
      .from(users)
      .where(eq(users.id, outsider.id));
    expect(retained).toMatchObject({
      personnelNumber: approvedCorrectNumber,
      displayName: outsider.displayName,
      passwordHash: outsiderBefore!.passwordHash,
      isActive: true,
    });
    const [created] = await db
      .select()
      .from(users)
      .where(eq(users.personnelNumber, outsider.personnelNumber!));
    expect(created!.id).not.toBe(outsider.id);
    expect(created!.passwordHash).toBeNull();
  } finally {
    await pool.end();
  }
});

test("confirmed master selection warns of capability loss; empty-state admin navigation and controlled recovery make scheduling possible again", async ({
  page,
}) => {
  const fixture = await provisionDepartment();
  const { db, pool } = createDatabase(isolatedUrl());
  try {
    const [head] = await db
      .select()
      .from(users)
      .where(eq(users.email, fixture.headEmail));
    await db
      .update(users)
      .set({ isHospitalAdmin: true })
      .where(eq(users.id, head!.id));
    await signInForReset(page, fixture.headEmail);
    await page.goto("/admin/reset");
    await page.getByRole("checkbox", { name: "دامنه همه سامانه" }).check();
    for (const name of [
      /^بخش‌ها \(/,
      /^تعریف شیفت‌ها/,
      /^دلایل تغییر/,
      /^قوانین پوشش بخش‌ها/,
      /^قوانین پوشش بیمارستان/,
    ])
      await page.getByRole("checkbox", { name }).check();
    await page
      .getByRole("button", { name: "نمایش پیش‌نمایش بازنشانی" })
      .click();
    const preview = page.getByRole("region", { name: "پیش‌نمایش بازنشانی" });
    await expect(preview).toContainText("ثبت شیفت ممکن نیست");
    await expect(preview).toContainText(
      "ثبت درخواست و اصلاح یا جابه‌جایی دارای دلیل ممکن نیست",
    );
    await expect(preview).toContainText("کد تأییدشده");
    await page.getByRole("button", { name: "تأیید و اجرای بازنشانی" }).click();
    const resetDialog = page.getByRole("dialog", {
      name: "حذف داده‌های پیش‌نمایش؟",
    });
    await expect(resetDialog).toContainText("حداقل یک نفر");
    await expect(resetDialog).toContainText("ثبت شیفت ممکن نیست");
    // Merely opening/cancelling the confirmation must leave masters intact.
    await resetDialog
      .getByRole("button", { name: "انصراف", exact: true })
      .click();
    expect(await db.select().from(shiftTypes)).toHaveLength(5);
    await page.getByRole("button", { name: "تأیید و اجرای بازنشانی" }).click();
    await resetDialog
      .getByRole("button", { name: "حذف داده‌های انتخاب‌شده" })
      .click();
    await expect(page.getByRole("status")).toContainText("بازنشانی انجام شد");
    expect(await db.select().from(departments)).toHaveLength(0);
    expect((await db.select().from(users)).map((u) => u.id)).toEqual([
      head!.id,
    ]);
    expect(await db.select().from(shiftTypes)).toHaveLength(0);
    await signOut(page);
    await page.goto("/login");
    await expect(page.getByLabel(IDENTIFIER_LABEL)).toBeVisible();
    await signIn(page, fixture.headEmail);
    await expect(page).toHaveURL(/\/my-shifts$/);
    await expect(
      page.getByRole("heading", { name: "تعریف شیفت‌ها موجود نیست" }),
    ).toBeVisible();
    for (const [path, heading] of [
      ["/admin/personnel", "کاربران بیمارستان"],
      ["/admin/personnel/import", "ورود گروهی پرسنل"],
      ["/admin/staffing-rules", "تعریف شیفت‌ها موجود نیست"],
      [`/admin/personnel/${head!.id}`, head!.displayName],
      ["/admin/reset", "بازنشانی داده آزمایشی"],
    ]) {
      await page.goto(path!);
      await expect(page).toHaveURL(
        new RegExp(path!.replaceAll("/", "\\/") + "$"),
      );
      await expect(
        page.getByRole("heading", { name: heading!, exact: true }),
      ).toBeVisible();
      await expect(page.locator("main")).not.toContainText("Application error");
    }
    await expect(
      page.getByText("هیچ بخشی وجود ندارد", { exact: false }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "پیش‌نمایش بازیابی داده پایه" })
      .click();
    const recovery = page.getByRole("region", {
      name: "پیش‌نمایش بازیابی",
      exact: true,
    });
    await expect(recovery).toContainText("نسخه منتشرشده: 1");
    await expect(recovery).toContainText("بخش جدید: 0");
    await page.getByRole("button", { name: "تأیید بازیابی داده پایه" }).click();
    const recoveryDialog = page.getByRole("dialog", {
      name: "بازیابی تعریف‌های مفقود؟",
    });
    await expect(recoveryDialog).toContainText("حداقل یک نفر");
    await recoveryDialog
      .getByRole("button", { name: "انصراف", exact: true })
      .click();
    expect(await db.select().from(shiftTypes)).toHaveLength(0);
    await page.getByRole("button", { name: "تأیید بازیابی داده پایه" }).click();
    await recoveryDialog
      .getByRole("button", { name: "افزودن تعریف‌های پیش‌نمایش" })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "بازیابی انجام شد" }),
    ).toBeVisible();
    expect(await db.select().from(shiftTypes)).toHaveLength(5);
    expect(await db.select().from(changeReasons)).toHaveLength(7);
    expect(await db.select().from(staffingRuleSetVersions)).toEqual([
      expect.objectContaining({
        status: "PUBLISHED",
        effectiveFrom: "1900-01-01",
      }),
    ]);
    expect(await db.select().from(staffingRuleSetRequirements)).toHaveLength(3);
    expect(await db.select().from(departments)).toHaveLength(0);
    await page
      .getByRole("button", { name: "پیش‌نمایش بازیابی داده پایه" })
      .click();
    await page.getByRole("button", { name: "تأیید بازیابی داده پایه" }).click();
    await recoveryDialog
      .getByRole("button", { name: "افزودن تعریف‌های پیش‌نمایش" })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "هیچ تغییری لازم نبود" }),
    ).toBeVisible();
    // Explicit fictional department/memberships emulate the documented operator recovery step.
    const recoveredDepartment = await provisionDepartment();
    await signOut(page);
    await signInForReset(page, recoveredDepartment.headEmail);
    await page.goto(
      `/departments/${recoveredDepartment.code}/schedule?month=1405-10`,
    );
    await page.getByRole("button", { name: "ایجاد برنامه ماهانه" }).click();
    const create = page.getByRole("dialog", { name: "ایجاد برنامه ماهانه" });
    await create
      .getByRole("button", { name: "ایجاد برنامه", exact: true })
      .click();
    await expect(page).toHaveURL(/\?schedule=[0-9a-f-]{36}$/);
    await expect(page.getByRole("region", { name: "تقویم ماه" })).toBeVisible();
    await expect(page.getByRole("note")).toContainText(
      "هنوز تصمیمی در این برنامه ثبت نشده است",
    );
    expect(await db.select().from(schedules)).toHaveLength(1);
  } finally {
    await pool.end();
  }
});
