import { expect, test, type Page } from "@playwright/test";

import { DEMO_USERS, signInAndWait } from "./support/auth";
import {
  provisionApprovalDepartment,
  type ApprovalDepartment,
} from "./support/approval";

const monthUrl = (d: ApprovalDepartment) =>
  `/departments/${d.code}/schedule?month=1405-08`;
const reviewUrl = (d: ApprovalDepartment) => `/review/${d.abanId}`;

/** The schedule page header (department, month, status strip, next action). */
const header = (page: Page) =>
  page.locator('section[aria-labelledby="schedule-month-heading"]');

async function switchUser(page: Page, email: string) {
  await page.context().clearCookies();
  await signInAndWait(page, email);
}

/** Opens a confirmation from the header and confirms it. */
async function confirm(page: Page, trigger: string, confirmLabel: string) {
  await header(page).getByRole("button", { name: trigger }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: confirmLabel }).click();
  await expect(dialog).toBeHidden();
}

async function expectStatus(page: Page, status: string) {
  await expect(header(page).getByText(status, { exact: true })).toBeVisible();
}

test.describe("approval workflow", () => {
  test("finalize, submit, return with a comment, resubmit and approve", async ({
    page,
  }) => {
    test.slow();
    const department = await provisionApprovalDepartment();
    const [nurse1] = department.nurseNames as [string];

    // Head Nurse: finalize is blocked by the night-rest finding on 4 Aban.
    await signInAndWait(page, department.headEmail);
    await page.goto(monthUrl(department));
    await expectStatus(page, "در حال برنامه‌ریزی");
    const finalize = header(page).getByRole("button", {
      name: "نهایی‌سازی برنامه",
    });
    await expect(finalize).toBeDisabled();
    const blockers = page.locator("#workflow-blockers");
    await expect(blockers).toContainText("نهایی‌سازی فعلاً ممکن نیست");
    await expect(blockers).toContainText("۱ مغایرت مسدودکننده در ۴ آبان");

    // Fix it from the blocker's day link: nurse 1 gets no shift on 4 Aban.
    await blockers.getByRole("link", { name: "۴ آبان" }).click();
    const day = page.getByRole("dialog");
    await expect(day).toHaveAccessibleName("دوشنبه ۴ آبان ۱۴۰۵");
    await day
      .getByRole("group", { name: `شیفت ${nurse1}` })
      .getByRole("button", { name: "بدون شیفت" })
      .click();
    await expect(day.getByRole("status").first()).toContainText("پاک شد");
    await day.getByRole("button", { name: "بستن جزئیات روز" }).click();
    await expect(blockers).toHaveCount(0);

    // Finalize, then submit.
    await expect(finalize).toBeEnabled();
    await confirm(page, "نهایی‌سازی برنامه", "بله، نهایی شود");
    await expectStatus(page, "نهایی‌شده");
    await confirm(page, "ارسال برای تأیید", "بله، ارسال شود");
    await expectStatus(page, "ارسال‌شده برای تأیید");
    await expect(page.getByText(/در انتظار بررسی سوپروایزر/)).toBeVisible();
    await expect(
      header(page).getByRole("button", { name: "پس گرفتن ارسال" }),
    ).toBeVisible();
    await expect(header(page).getByText("فقط مشاهده")).toBeVisible();

    // Supervisor: the submission is in the queue; the review is read-only.
    await switchUser(page, department.supervisorEmail);
    await expect(page).toHaveURL(/\/review$/);
    const row = page
      .locator(`li[data-schedule="${department.abanId}"]`)
      .first();
    await expect(row).toContainText(department.name);
    await expect(row).toContainText("سرپرستار آزمایشی");
    await row.getByRole("link", { name: "بررسی برنامه" }).click();
    await expect(page).toHaveURL(new RegExp(`/review/${department.abanId}$`));
    await expectStatus(page, "ارسال‌شده برای تأیید");
    await expect(header(page).getByText("فقط مشاهده")).toBeVisible();

    // A day opens read-only: no shift controls.
    await page.goto(`${reviewUrl(department)}?day=2026-10-24`);
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(
      page.getByRole("dialog").getByRole("group", { name: /^شیفت / }),
    ).toHaveCount(0);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "بستن جزئیات روز" })
      .click();

    // Return: a blank comment is refused by the server, then a real one.
    await header(page)
      .getByRole("button", { name: "برگشت برای اصلاح" })
      .click();
    const giveBack = page.getByRole("dialog");
    const comment = giveBack.getByLabel("توضیح برای سرپرستار (الزامی)");
    await comment.fill("    ");
    await giveBack.getByRole("button", { name: "برگشت داده شود" }).click();
    await expect(giveBack.getByRole("alert")).toContainText("توضیح برگشت");
    await comment.fill("پوشش شب ۱۲ آبان کافی نیست؛ لطفاً اصلاح کنید.");
    await giveBack.getByRole("button", { name: "برگشت داده شود" }).click();
    await expect(giveBack).toBeHidden();
    await expectStatus(page, "برگشت‌خورده");

    // Head Nurse: sees the comment, resubmits.
    await switchUser(page, department.headEmail);
    await page.goto(monthUrl(department));
    await expectStatus(page, "برگشت‌خورده");
    const note = page.getByRole("region", {
      name: "برنامه برای اصلاح برگشت داده شد",
    });
    await expect(note).toContainText(
      "پوشش شب ۱۲ آبان کافی نیست؛ لطفاً اصلاح کنید.",
    );
    await expect(note).toContainText("سوپروایزر آزمایشی");
    await confirm(page, "ارسال دوباره برای تأیید", "بله، ارسال شود");
    await expectStatus(page, "ارسال‌شده برای تأیید");

    // Supervisor approves.
    await switchUser(page, department.supervisorEmail);
    await page.goto(reviewUrl(department));
    await confirm(page, "تأیید برنامه", "بله، تأیید شود");
    await expectStatus(page, "تأییدشده");
    await expect(
      header(page).getByRole("button", { name: "تأیید برنامه" }),
    ).toHaveCount(0);

    // Head Nurse: approved, no further action in this phase.
    await switchUser(page, department.headEmail);
    await page.goto(monthUrl(department));
    await expectStatus(page, "تأییدشده");
    await expect(page.getByText(/برنامه تأیید شده است/)).toBeVisible();
    for (const name of [
      "نهایی‌سازی برنامه",
      "ارسال برای تأیید",
      "پس گرفتن ارسال",
    ])
      await expect(header(page).getByRole("button", { name })).toHaveCount(0);
  });

  test("the Head Nurse withdraws a submission before the Supervisor acts", async ({
    page,
  }) => {
    const department = await provisionApprovalDepartment("submitted");
    await signInAndWait(page, department.headEmail);
    await page.goto(monthUrl(department));
    await expectStatus(page, "ارسال‌شده برای تأیید");
    await confirm(page, "پس گرفتن ارسال", "بله، پس گرفته شود");
    await expectStatus(page, "نهایی‌شده");
    await expect(page.getByText(/ارسال قبلی در .* پس گرفته شد/)).toBeVisible();
    await expect(
      header(page).getByRole("button", { name: "ارسال برای تأیید" }),
    ).toBeEnabled();

    // The Supervisor sees it finalized, with nothing to decide.
    await switchUser(page, department.supervisorEmail);
    await page.goto(reviewUrl(department));
    await expectStatus(page, "نهایی‌شده");
    await expect(
      header(page).getByRole("button", { name: "تأیید برنامه" }),
    ).toHaveCount(0);
  });

  test("a stale page cannot approve after the Head Nurse withdrew", async ({
    page,
  }) => {
    const department = await provisionApprovalDepartment("submitted");
    await signInAndWait(page, department.supervisorEmail);
    await page.goto(reviewUrl(department));
    await expectStatus(page, "ارسال‌شده برای تأیید");

    // Meanwhile the Head Nurse withdraws (another browser).
    const other = await page.context().browser()!.newContext();
    const headPage = await other.newPage();
    await signInAndWait(headPage, department.headEmail);
    await headPage.goto(monthUrl(department));
    await confirm(headPage, "پس گرفتن ارسال", "بله، پس گرفته شود");
    await expectStatus(headPage, "نهایی‌شده");
    await other.close();

    await header(page).getByRole("button", { name: "تأیید برنامه" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "بله، تأیید شود" })
      .click();
    // Refused; the page now shows the current state.
    await expectStatus(page, "نهایی‌شده");
    await expect(
      header(page).getByRole("button", { name: "تأیید برنامه" }),
    ).toHaveCount(0);
  });
});

test.describe("approval workflow access", () => {
  test("the review is only for the department's Supervisor", async ({
    page,
  }) => {
    const department = await provisionApprovalDepartment("finalized");
    // A nurse, the Head Nurse and a Supervisor of other departments: 404.
    for (const email of [
      department.nurseEmail,
      department.headEmail,
      DEMO_USERS.supervisor.email,
    ]) {
      await switchUser(page, email);
      const response = await page.goto(reviewUrl(department));
      expect(response?.status()).toBe(404);
    }
    // The Supervisor cannot open the Head Nurse's editing page.
    await switchUser(page, department.supervisorEmail);
    const response = await page.goto(monthUrl(department));
    expect(response?.status()).toBe(404);
  });
});
