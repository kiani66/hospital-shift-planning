import { expect, test } from "@playwright/test";
import { loadEnvConfig } from "@next/env";

import { addDays } from "../../src/domain/shared/dates";
import { todayIn } from "../../src/infrastructure/auth/actor";
import { createDatabase } from "../../src/infrastructure/db/database";
import { findDepartmentByCode } from "../../src/infrastructure/repositories/departments";
import { endMembership } from "../../src/infrastructure/repositories/memberships";
import { findUserByEmail } from "../../src/infrastructure/repositories/users";
import { signInAndWait } from "./support/auth";
import { provisionApprovalDepartment } from "./support/approval";
import { provisionDepartment } from "./support/workspace";

const sizes = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
  { width: 320, height: 700 },
];

test("overview uses the schedule page selection and verified ready days", async ({
  page,
}) => {
  const department = await provisionApprovalDepartment("planning");
  await signInAndWait(page, department.headEmail);
  const card = page.getByRole("article", {
    name: `برنامه‌ریزی ${department.name}`,
  });
  await expect(card).toContainText("در حال برنامه‌ریزی");
  await expect(card.getByRole("progressbar")).toHaveAttribute("value", "29");
  await expect(card.getByRole("progressbar")).toHaveAttribute("max", "30");
  const continuePlanning = card.getByRole("link", {
    name: "ادامه برنامه‌ریزی",
  });
  await expect(continuePlanning).toHaveAttribute(
    "href",
    `/departments/${department.code}/schedule?schedule=${department.abanId}`,
  );
  await continuePlanning.click();
  const summary = page.locator("[data-validation]");
  await expect(summary.locator("#workflow-blockers")).toBeVisible();
  await expect(summary).toContainText("۱ نقض قانون");
  await expect(
    page.getByRole("button", { name: "نهایی‌سازی برنامه", exact: true }),
  ).toBeDisabled();
  await summary.getByText("مشاهده موانع و روزهای مرتبط").click();
  await expect(
    summary.getByRole("link", { name: "۴ آبان", exact: true }),
  ).toBeVisible();
  for (const size of sizes) {
    await page.setViewportSize(size);
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);
  }
});

test("no schedule and a missing month stay explicit and responsive", async ({
  page,
}) => {
  const department = await provisionDepartment();
  await signInAndWait(page, department.headEmail);
  await expect(page.getByRole("article")).toContainText(
    "هنوز برنامه‌ای برای این بخش ایجاد نشده است",
  );
  await page
    .getByRole("link", { name: "ایجاد برنامه ماهانه", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "هنوز برنامه‌ای برای این بخش ایجاد نشده است",
    }),
  ).toBeVisible();
  await page.goto(`/departments/${department.code}/schedule?month=1405-10`);
  await expect(
    page.getByText("برای این ماه هنوز برنامه‌ای ایجاد نشده است.", {
      exact: true,
    }),
  ).toBeVisible();
  for (const size of sizes) {
    await page.setViewportSize(size);
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBe(0);
  }
});

test("a retained roster is distinct from today's effective members", async ({
  page,
}) => {
  const department = await provisionApprovalDepartment("planning");
  loadEnvConfig(process.cwd());
  const { db, pool } = createDatabase(process.env.DATABASE_URL!, { max: 1 });
  try {
    const d = (await findDepartmentByCode(db, department.code))!;
    const nurse = (await findUserByEmail(
      db,
      department.nurseEmail.replace("nurse1.", "nurse3."),
    ))!;
    await endMembership(db, {
      userId: nurse.id,
      departmentId: d.id,
      endedOn: addDays(todayIn("Asia/Tehran"), -1),
    });
  } finally {
    await pool.end();
  }
  await signInAndWait(page, department.headEmail);
  await page.goto(`/departments/${department.code}/schedule?month=1405-08`);
  const roster = page.getByRole("region", { name: "پرسنل برنامه" });
  await expect(roster).toContainText(`پرسنل ثبت‌شده در این برنامه`);
  await expect(roster.locator("dd").first()).toHaveText("۵ نفر");
  await expect(roster).toContainText("به‌طور خودکار تغییر نمی‌کند");
  await page.goto(`/departments/${department.code}/people`);
  const members = page.getByRole("region", { name: "اعضای جاری بخش" });
  await expect(members.getByRole("listitem")).toHaveCount(4);
  await expect(
    page.getByText(/ممکن است با اعضای فعلی بخش متفاوت باشد/),
  ).toBeVisible();
});

test("daily edits save before continuing and a range draft needs confirmation", async ({
  page,
}) => {
  const department = await provisionApprovalDepartment("planning");
  await signInAndWait(page, department.headEmail);
  await page.goto(`/departments/${department.code}/schedule?month=1405-08`);
  await page.locator("#day-2026-10-28").click();
  const day = page.getByRole("dialog");
  await expect(day).toHaveAccessibleName("چهارشنبه ۶ آبان ۱۴۰۵");
  const controls = day.getByRole("group", {
    name: `شیفت ${department.nurseNames[0]}`,
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/departments/**/schedule?**", async (route) => {
    if (route.request().method() === "POST") await gate;
    await route.continue();
  });
  try {
    await controls
      .getByRole("button", { name: "عصر (E)", exact: true })
      .click();
    await expect(day.locator("[data-pending]")).not.toHaveCount(0);
    await day.getByRole("link", { name: /^روز بعد/ }).click();
    await expect(day).toHaveAccessibleName("چهارشنبه ۶ آبان ۱۴۰۵");
    await expect(
      day.getByText("تا پایان ثبت تغییرات، در همین روز بمانید."),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(day).toBeVisible();
  } finally {
    release();
  }
  await expect(day.locator("[data-pending]")).toHaveCount(0);
  await page.unroute("**/departments/**/schedule?**");
  await expect(day.getByRole("status").first()).toContainText("ثبت شد");
  await day.getByRole("link", { name: /^روز بعد/ }).click();
  await expect(day).toHaveAccessibleName("پنجشنبه ۷ آبان ۱۴۰۵");
  await controls.getByRole("button", { name: /^چند روز/ }).click();
  page.once("dialog", (dialog) => dialog.dismiss());
  await day.getByRole("link", { name: /^روز بعد/ }).click();
  await expect(day).toHaveAccessibleName("پنجشنبه ۷ آبان ۱۴۰۵");
  await expect(
    day.getByRole("form", { name: /^اعمال برای چند روز/ }),
  ).toBeVisible();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.keyboard.press("Escape");
  await expect(day).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await day.getByRole("link", { name: /^روز بعد/ }).click();
  await expect(day).toHaveAccessibleName("جمعه ۸ آبان ۱۴۰۵");
  for (const size of sizes) {
    await page.setViewportSize(size);
    expect(await day.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
  }
});
