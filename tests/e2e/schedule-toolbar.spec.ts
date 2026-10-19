import { expect, test, type Page } from "@playwright/test";

import {
  installToolbarTemplate,
  openScheduleActions,
} from "./support/schedule-toolbar";

import { signInAndWait } from "./support/auth";
import { provisionApprovalDepartment } from "./support/approval";

const widths = [320, 375, 768, 1024, 1280, 1440, 1920, 2560];
const toolbar = (page: Page) => page.locator("[data-schedule-toolbar]");
const more = (page: Page) =>
  toolbar(page).getByRole("button", { name: "عملیات بیشتر", exact: true });

async function checkGeometry(page: Page) {
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);
  expect(
    await toolbar(page).evaluate((root) => getComputedStyle(root).direction),
  ).toBe("rtl");
  const controls = toolbar(page).locator("button:visible, a:visible");
  const boxes = await controls.evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        x: rect.x,
        y: rect.y,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
        clipped: element.scrollWidth > element.clientWidth + 1,
      };
    }),
  );
  for (const box of boxes) {
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(page.viewportSize()!.width);
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.clipped).toBe(false);
  }
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!,
        b = boxes[j]!;
      expect(
        Math.min(a.right, b.right) - Math.max(a.x, b.x) > 1 &&
          Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) > 1,
        "toolbar controls must not overlap",
      ).toBe(false);
    }
}

for (const state of [
  "draft",
  "planning",
  "finalized",
  "submitted",
  "approved",
  "revising",
] as const) {
  test(`${state}: toolbar groups at all requested widths`, async ({
    page,
  }, testInfo) => {
    test.slow();
    const department = await provisionApprovalDepartment(
      state === "revising" ? "approved" : state,
    );
    if (state === "revising") await installToolbarTemplate(department);
    await signInAndWait(page, department.headEmail);
    await page.goto(`/departments/${department.code}/schedule?month=1405-08`);
    if (state === "revising") {
      await toolbar(page).getByRole("button", { name: "شروع بازنگری" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("دلیل بازنگری").fill("بررسی چیدمان واکنش‌گرا");
      await dialog
        .getByRole("button", { name: "بله، بازنگری آغاز شود" })
        .click();
      await expect(dialog).toBeHidden();
    }
    const action = toolbar(page).getByRole("button", {
      name:
        state === "draft" || state === "planning"
          ? "نهایی‌سازی برنامه"
          : state === "submitted"
            ? "پس گرفتن ارسال"
            : state === "approved"
              ? "شروع بازنگری"
              : "ارسال برای تأیید",
      exact: true,
    });
    await expect(action).toBeVisible();
    if (state === "draft" || state === "planning") {
      await expect(action).toBeDisabled();
      await expect(action).toHaveAttribute(
        "aria-describedby",
        "workflow-blockers",
      );
    }
    for (const width of widths) {
      await page.setViewportSize({ width, height: 1000 });
      await expect(action).toBeVisible();
      await checkGeometry(page);
      const height = (await toolbar(page).boundingBox())!.height;
      const compact = await more(page).isVisible();
      await openScheduleActions(page);
      if (compact)
        await expect(more(page)).toHaveAttribute("aria-expanded", "true");
      await expect(
        toolbar(page).getByRole("button", { name: "برنامه ماهانه جدید" }),
      ).toBeVisible();
      const exportButton = toolbar(page).getByRole("button", {
        name: "خروجی اکسل",
        exact: true,
      });
      if (state === "revising") await expect(exportButton).toBeEnabled();
      else await expect(exportButton).toBeDisabled();
      await expect(
        toolbar(page).getByText(
          "برای خروجی اکسل ابتدا باید قالب Excel بخش بارگذاری شود",
          { exact: false },
        ),
      ).toHaveCount(state === "revising" ? 0 : 1);
      if (state === "revising")
        await expect(
          toolbar(page).getByRole("button", {
            name: "خروجی پیش‌نویس بازبینی (تأییدنشده)",
            exact: true,
          }),
        ).toBeVisible();
      await expect(
        toolbar(page).getByRole("button", {
          name: "بازنشانی چیدمان",
          exact: true,
        }),
      ).toHaveCount(state === "draft" || state === "planning" ? 1 : 0);
      await expect(
        toolbar(page).getByRole("button", { name: "کپی برنامه", exact: true }),
      ).toHaveCount(state === "submitted" || state === "approved" ? 0 : 1);
      await checkGeometry(page);
      if (compact) {
        // Tab reaches the original controls; Escape restores focus to the disclosure.
        await more(page).focus();
        await page.keyboard.press("Tab");
        await expect(more(page)).not.toBeFocused();
        await page.keyboard.press("Escape");
        await expect(more(page)).toBeFocused();
        await expect(more(page)).toHaveAttribute("aria-expanded", "false");
      }
      expect((await toolbar(page).boundingBox())!.height).toBe(height);
      if (state === "draft" && [375, 768, 1440].includes(width)) {
        const file = testInfo.outputPath(`toolbar-${width}.png`);
        await page.screenshot({ path: file });
        await testInfo.attach(`toolbar-${width}`, {
          path: file,
          contentType: "image/png",
        });
      }
    }
    // A secondary action still opens its original dialog from the disclosure.
    await openScheduleActions(page);
    await toolbar(page)
      .getByRole("button", { name: "برنامه ماهانه جدید" })
      .click();
    await expect(
      page.getByRole("dialog", { name: "ایجاد برنامه ماهانه" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(
      toolbar(page).getByRole("button", { name: "برنامه ماهانه جدید" }),
    ).toBeFocused();
  });
}

test("nurses cannot acquire toolbar actions through the department URL", async ({
  page,
}) => {
  const department = await provisionApprovalDepartment();
  await signInAndWait(page, department.nurseEmail);
  await page.goto(`/departments/${department.code}/schedule?month=1405-08`);
  await expect(toolbar(page)).toHaveCount(0);
});
