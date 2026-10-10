import { signInForReset } from "./support/reset-auth";
import { assertResetE2eDatabase } from "../../scripts/support/reset-e2e-safety";
import { eq } from "drizzle-orm";
import { expect, test } from "@playwright/test";
import { createSchedule } from "../../src/application/schedules/create-schedule";
import { setAssignments } from "../../src/application/schedules/edit-assignments";
import { createDatabase } from "../../src/infrastructure/db/database";
import { departments, users } from "../../src/infrastructure/db/schema";
import { loadActor } from "../../src/infrastructure/repositories/memberships";
import { todayIn, APP_TIMEZONE } from "../../src/infrastructure/auth/actor";
import { provisionDepartment } from "./support/workspace";
test("Monthly Reset previews real impact and refreshes to unassigned planning", async ({
  page,
}) => {
  assertResetE2eDatabase(process.env);
  const url = process.env.DATABASE_URL!;
  if (
    new URL(url).hostname !== "127.0.0.1" ||
    !new URL(url).pathname.includes("phase14_e2e_test")
  )
    throw new Error("Phase 14 E2E requires its isolated local database");
  const fixture = await provisionDepartment();
  const { db, pool } = createDatabase(url);
  let id = "";
  try {
    const [head] = await db
      .select()
      .from(users)
      .where(eq(users.email, fixture.headEmail));
    const [department] = await db
      .select()
      .from(departments)
      .where(eq(departments.code, fixture.code));
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
    id = made.data.scheduleId;
    expect(
      (
        await setAssignments(ctx, {
          scheduleId: id,
          expectedRevision: 0,
          changes: [{ nurseId: head!.id, date: "2026-10-24", shift: "M" }],
        })
      ).ok,
    ).toBe(true);
  } finally {
    await pool.end();
  }
  await signInForReset(page, fixture.headEmail);
  await page.goto(`/departments/${fixture.code}/schedule?schedule=${id}`);
  await page.getByRole("button", { name: "بازنشانی چیدمان" }).click();
  const dialog = page.getByRole("dialog", { name: "بازنشانی چیدمان ماه؟" });
  await expect(dialog).toContainText("۱ شیفت");
  await expect(dialog).toContainText(
    "پنجره‌های ترجیحات و قوانین تغییر نمی‌کنند",
  );
  await dialog.getByRole("button", { name: "پاک کردن چیدمان" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByText("هنوز تصمیمی در این برنامه ثبت نشده است", { exact: false }),
  ).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`schedule=${id}`));
  const calendar = page.getByRole("region", { name: "تقویم ماه" });
  await expect(
    calendar.locator('tbody a[data-state="NOT_STARTED"]'),
  ).toHaveCount(30);
  await calendar.getByRole("link", { name: /^شنبه ۲ آبان ۱۴۰۵/ }).click();
  const day = page.getByRole("dialog");
  for (const period of ["M", "E", "N"])
    await expect(day.locator(`[data-live-coverage="${period}"]`)).toContainText(
      /۰\s*\/ لازم/,
    );
});
