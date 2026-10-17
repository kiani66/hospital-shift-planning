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

    // Head Nurse, in DRAFT, preferences never opened: finalize is offered
    // (preferences are optional, D125) but blocked by the night-rest
    // finding on 4 Aban.
    await signInAndWait(page, department.headEmail);
    await page.goto(monthUrl(department));
    await expectStatus(page, "پیش‌نویس");
    await expect(
      header(page).getByRole("button", { name: "باز کردن ثبت ترجیحات" }),
    ).toBeVisible();
    const finalize = header(page).getByRole("button", {
      name: "نهایی‌سازی برنامه",
    });
    await expect(finalize).toBeDisabled();
    const blockers = page.locator("#workflow-blockers");
    await expect(blockers).toContainText("نهایی‌سازی فعلاً ممکن نیست");
    // Each category is named on its own, with its days (D104).
    await expect(blockers).toContainText("۱ نقض قانون");
    await expect(blockers).not.toContainText("مغایرت");

    await blockers.getByText("مشاهده موانع و روزهای مرتبط").click();
    // Fix it from the blocker's day link: nurse 1 gets no shift on 4 Aban.
    await blockers.getByRole("link", { name: "۴ آبان" }).click();
    const day = page.getByRole("dialog");
    await expect(day).toHaveAccessibleName("دوشنبه ۴ آبان ۱۴۰۵");
    await day
      .getByRole("group", { name: `شیفت ${nurse1}` })
      .getByRole("button", { name: "استراحت (OFF)" })
      .click();
    await expect(day.getByRole("status").first()).toContainText("ثبت شد");
    await day.getByRole("button", { name: "بستن جزئیات روز" }).click();
    await expect(blockers).toHaveCount(0);

    // Finalize straight from DRAFT, then submit.
    await expect(finalize).toBeEnabled();
    await finalize.click();
    const finalizeDialog = page.getByRole("dialog");
    await expect(finalizeDialog).toContainText(
      "ثبت ترجیحات پرستاران اختیاری است",
    );
    await finalizeDialog
      .getByRole("button", { name: "بله، نهایی شود" })
      .click();
    await expect(finalizeDialog).toBeHidden();
    await expectStatus(page, "نهایی‌شده");
    // Preferences end with planning (D65): no way to open them now.
    await expect(
      header(page).getByRole("button", { name: /ثبت ترجیحات$/ }),
    ).toHaveCount(0);
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

  test("shifts assigned first, preferences opened later: status moves to planning, shifts stay", async ({
    page,
  }) => {
    const department = await provisionApprovalDepartment("draft");
    await signInAndWait(page, department.headEmail);
    await page.goto(`${monthUrl(department)}&day=2026-10-24`);
    await expectStatus(page, "پیش‌نویس");
    const dayDialog = page.getByRole("dialog");
    await expect(dayDialog).toBeVisible();
    // Each nurse's decided shift: the pressed code in their row.
    const decided = () =>
      page
        .getByRole("dialog")
        .getByRole("group", { name: /^شیفت / })
        .locator('button[aria-pressed="true"]')
        .allTextContents();
    const shiftsBefore = await decided();
    expect(shiftsBefore.length).toBeGreaterThan(0);
    await dayDialog.getByRole("button", { name: "بستن جزئیات روز" }).click();
    const summary = page.getByRole("list", {
      name: "خلاصه اعتبارسنجی برنامه",
    });
    const summaryBefore = await summary.innerText();

    await header(page)
      .getByRole("button", { name: "باز کردن ثبت ترجیحات" })
      .click();
    const open = page.getByRole("dialog", { name: "باز کردن ثبت ترجیحات؟" });
    await expect(open).toContainText("شیفت‌های ثبت‌شده تغییری نمی‌کنند");
    await expect(open).toContainText("در حال برنامه‌ریزی");
    await open.getByRole("button", { name: "بله، باز شود" }).click();
    await expect(open).toBeHidden();

    await expectStatus(page, "در حال برنامه‌ریزی");
    await expect(
      header(page).getByRole("button", { name: "بستن ثبت ترجیحات" }),
    ).toBeVisible();
    // Finalize stays where it was: blocked by the same finding, nothing new.
    await expect(
      header(page).getByRole("button", { name: "نهایی‌سازی برنامه" }),
    ).toBeDisabled();
    await expect(page.locator("#workflow-blockers")).not.toContainText(
      "ترجیحات",
    );
    await expect.poll(() => summary.innerText()).toBe(summaryBefore);
    await page.goto(`${monthUrl(department)}&day=2026-10-24`);
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect.poll(decided).toEqual(shiftsBefore);
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
