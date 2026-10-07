import { expect, test, type Page } from "@playwright/test";

import { isDesktop, signInAndWait, signOut } from "./support/auth";
import {
  provisionRulesDepartment,
  type RulesDepartment,
} from "./support/staffing-rules";

/**
 * Versioned staffing rules end to end (D105–D110): a Hospital Admin
 * publishes a Department Override; existing schedules keep their pin; a
 * Supervisor previews and explicitly applies it; the Head Nurse then sees
 * the new rules (summary, live coverage) and can only read them.
 */

const scheduleUrl = (d: RulesDepartment, query = "") =>
  `/departments/${d.code}/schedule?schedule=${d.abanId}${query}`;
const rulesUrl = (d: RulesDepartment) =>
  `/departments/${d.code}/coverage-rules`;
const summary = (page: Page) =>
  page.locator("main").locator("section[data-validation]");

/**
 * Signs the current user out and the next one in on a fresh page of the same
 * (now signed-out) context. Sign-out and sign-in are client-side navigations
 * of one document, so nav-link prefetches cut short by the sign-out could stay
 * "in flight" for that document forever and `networkidle` would never come.
 */
async function switchUser(page: Page, email: string): Promise<Page> {
  await signOut(page);
  const next = await page.context().newPage();
  await page.close();
  await signInAndWait(next, email);
  return next;
}

test("Admin publishes a department override; Supervisor previews and applies it; Head Nurse reads it", async ({
  page: first,
}) => {
  test.skip(!isDesktop(first), "multi-role desktop journey");
  let page = first;
  // Four sign-ins and the admin page (which lists every department) under a
  // parallel suite: only the whole-test budget grows, assertions keep theirs.
  test.setTimeout(240_000);
  const department = await provisionRulesDepartment();

  // 1. Hospital Admin: a NICU-like override 3–6, published immediately.
  await signInAndWait(page, department.adminEmail);
  await page.goto("/admin/staffing-rules");
  const scope = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", {
        level: 2,
        name: new RegExp(department.name),
      }),
    })
    .first();
  await scope
    .getByRole("button", { name: "تعریف قوانین ویژه این بخش" })
    .click();
  const draft = scope.locator('article[data-state="DRAFT"]');
  await expect(draft).toBeVisible();
  for (const p of ["M", "E", "N"]) {
    await draft.locator(`input[name="normal.${p}.min"]`).fill("3");
    await draft.locator(`input[name="normal.${p}.max"]`).fill("6");
  }
  await draft.getByRole("button", { name: "ذخیره پیش‌نویس" }).click();
  await expect(draft.getByText("پیش‌نویس ذخیره شد.")).toBeVisible();
  await draft.getByRole("button", { name: "انتشار…" }).click();
  const publish = page.getByRole("dialog");
  await publish.getByRole("button", { name: "بررسی تداخل" }).click();
  await expect(publish).toContainText(
    "تداخلی با نسخه‌های زمان‌بندی‌شده وجود ندارد",
  );
  await publish.getByRole("button", { name: "انتشار نسخه" }).click();
  await expect(scope.locator('article[data-state="EFFECTIVE"]')).toContainText(
    "صبح ۳ تا ۶ نفر",
  );

  // 2. Head Nurse: publishing did not move the existing schedule's pin.
  page = await switchUser(page, department.headEmail);
  await page.goto(scheduleUrl(department));
  await expect(summary(page)).toContainText("پیش‌فرض بیمارستان · نسخه ۱");
  // Read-only rules page: no Apply controls.
  await page.goto(rulesUrl(department));
  await expect(page.getByRole("button", { name: "پیش‌نمایش" })).toHaveCount(0);

  // 3. Supervisor: preview (nothing changes), then explicit confirmation.
  page = await switchUser(page, department.supervisorEmail);
  await page.goto(rulesUrl(department));
  const row = page.locator(`li[data-schedule-rules="${department.abanId}"]`);
  await row.getByRole("button", { name: "پیش‌نمایش" }).click();
  const preview = page.locator("[data-apply-preview]");
  await expect(preview).toBeVisible();
  await expect(preview).toContainText("شیفت‌های تغییرکرده");
  await expect(preview).toContainText("مشکلات پوشش تازه یا بدترشده");
  for (const name of department.nurseNames)
    await expect(preview).not.toContainText(name);
  const apply = preview.getByRole("button", {
    name: "اعمال نسخه بر این برنامه",
  });
  await expect(apply).toBeDisabled();
  await preview.getByRole("checkbox").check();
  await apply.click();
  await expect(page).toHaveURL(/applied=/);
  await expect(page.getByRole("status").first()).toContainText(
    "نسخه انتخابی بر برنامه اعمال شد",
  );
  await expect(page.locator("[data-history-entry]").first()).toContainText(
    "شیفت‌های تغییرکرده: ۰",
  );

  // 4. Head Nurse: the schedule is now validated with the override.
  page = await switchUser(page, department.headEmail);
  await page.goto(scheduleUrl(department));
  await expect(summary(page)).toContainText("قوانین ویژه بخش · نسخه ۱");
  await expect(summary(page)).toContainText("کمبود نیرو");
  await expect(summary(page)).not.toContainText("مغایرت");
  // Live coverage in the editor uses the pinned 3–6 bounds.
  await page.goto(scheduleUrl(department, "&day=2026-10-24"));
  const live = page.getByRole("dialog").locator('[data-live-coverage="M"]');
  await expect(live).toContainText("لازم ۳–۶");
  await expect(live).toHaveAttribute("data-staffing", "BELOW_MINIMUM");
});
