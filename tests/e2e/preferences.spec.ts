import { expect, test, type Locator, type Page } from "@playwright/test";

import { DEMO_USERS, mainNav, signInAndWait } from "./support/auth";
import { provisionNotifiedDepartment } from "./support/notifications";
import {
  closePreferences,
  schedulesOf,
  storedPreferencesOf,
  userIdOf,
} from "./support/preferences";

// Aban 1405 = 2026-10-23 .. 2026-11-21 (the first schedule provisioned).
const SAT_2_ABAN = "شنبه ۲ آبان ۱۴۰۵";
const SUN_3_ABAN = "یکشنبه ۳ آبان ۱۴۰۵";
const MON_4_ABAN = "دوشنبه ۴ آبان ۱۴۰۵";

const main = (page: Page) => page.locator("main");
const day = (page: Page, label: string) =>
  main(page).getByRole("listitem", { name: label, exact: true });
/** "M" must not match "ME": the accessible name is "<code> — <label>". */
const option = (dayCard: Locator, code: string) =>
  dayCard
    .getByRole("group", { name: /^ترجیح شیفت/ })
    .getByRole("button", { name: new RegExp(`^${code} —`) });

async function choose(page: Page, label: string, code: string) {
  const card = day(page, label);
  await option(card, code).click();
  await expect(option(card, code)).toHaveAttribute("aria-pressed", "true");
  await expect(card.getByRole("status")).toContainText("ذخیره شد");
}

const expectNoHorizontalOverflow = async (page: Page, step: string) => {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow, step).toBeLessThanOrEqual(0);
};

test.describe("nurse preferences", () => {
  test("choose, change and clear preferences; they survive a reload", async ({
    page,
  }) => {
    const department = await provisionNotifiedDepartment(1);
    await signInAndWait(page, department.nurseEmail);
    await mainNav(page).getByRole("link", { name: "ترجیحات" }).click();
    await expect(page).toHaveURL(/\/preferences$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("ترجیحات");

    // Schedule context: department, Jalali month, open state and range.
    const context = main(page).getByRole("region", {
      name: "آبان ۱۴۰۵",
      exact: true,
    });
    await expect(context).toContainText(department.name);
    await expect(context).toContainText("باز — قابل ویرایش");
    await expect(context).toContainText("۱ تا ۳۰ آبان ۱۴۰۵ (۳۰ روز)");
    await expect(context).toContainText("نه شیفت قطعی");
    await expectNoHorizontalOverflow(page, "initial");

    // Saturday-first weeks; every day starts without a preference.
    await expect(
      main(page).getByRole("heading", { name: /^هفته ۲: ۲ تا ۸ آبان ۱۴۰۵$/ }),
    ).toBeVisible();
    await expect(day(page, SAT_2_ABAN)).toContainText("بدون ترجیح");

    await choose(page, SAT_2_ABAN, "M");
    await choose(page, SUN_3_ABAN, "N");
    await choose(page, SAT_2_ABAN, "E");
    await expect(option(day(page, SAT_2_ABAN), "M")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await expect(day(page, SAT_2_ABAN)).toContainText("ترجیح من: E — عصر");
    await choose(page, MON_4_ABAN, "ME");

    // Clear one: back to "no preference".
    await day(page, SUN_3_ABAN)
      .getByRole("button", { name: `پاک کردن ترجیح ${SUN_3_ABAN}` })
      .click();
    await expect(day(page, SUN_3_ABAN)).toContainText("بدون ترجیح");
    await expect(
      day(page, SUN_3_ABAN).getByRole("button", { pressed: true }),
    ).toHaveCount(0);

    const summary = main(page).getByRole("region", {
      name: "خلاصه ترجیحات من",
    });
    await expect(summary).toContainText("۲ از ۳۰ روز");
    await expectNoHorizontalOverflow(page, "after edits");

    await page.reload();
    await expect(option(day(page, SAT_2_ABAN), "E")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(option(day(page, MON_4_ABAN), "ME")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(day(page, SUN_3_ABAN)).toContainText("بدون ترجیح");
    expect(await storedPreferencesOf(department.nurseEmail)).toEqual({
      "2026-10-24": "E",
      "2026-10-26": "ME",
    });
    // Personal: nobody else's preferences changed.
    expect(await storedPreferencesOf(department.nurse2Email)).toEqual({});
  });

  test("keyboard: one tab stop per day, arrows move, Enter selects", async ({
    page,
  }) => {
    const department = await provisionNotifiedDepartment(1);
    await signInAndWait(page, department.nurseEmail);
    await page.goto("/preferences");
    const card = day(page, SAT_2_ABAN);
    await option(card, "M").focus();
    await expect(option(card, "E")).toHaveAttribute("tabindex", "-1");
    // RTL: ArrowLeft moves to the next option.
    await page.keyboard.press("ArrowLeft");
    await expect(option(card, "E")).toBeFocused();
    await page.keyboard.press("End");
    await expect(option(card, "OFF")).toBeFocused();
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await expect(option(card, "N")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(option(card, "N")).toHaveAttribute("aria-pressed", "true");
    await expect(card.getByRole("status")).toContainText("ذخیره شد");
    expect(await storedPreferencesOf(department.nurseEmail)).toEqual({
      "2026-10-24": "N",
    });
  });

  test("a PREFERENCES_OPENED notification opens its schedule", async ({
    page,
  }) => {
    const department = await provisionNotifiedDepartment(2);
    const [, newer] = await schedulesOf(department);
    await signInAndWait(page, department.nurseEmail);
    await page.goto("/notifications");
    await main(page)
      .getByRole("listitem")
      .filter({ hasText: "آذر ۱۴۰۵" })
      .getByRole("button", { name: /^ثبت ترجیحات باز شد/ })
      .click();
    await expect(page).toHaveURL(`/preferences?schedule=${newer!.id}`);
    await expect(
      main(page).getByRole("region", { name: "آذر ۱۴۰۵", exact: true }),
    ).toBeVisible();
    // Both visible schedules can be switched between.
    const switcher = main(page).getByRole("navigation", {
      name: "برنامه‌های قابل انتخاب",
    });
    await expect(switcher.getByRole("link")).toHaveCount(2);
    await expect(
      switcher.getByRole("link", { name: /آذر ۱۴۰۵/ }),
    ).toHaveAttribute("aria-current", "page");
    await expectNoHorizontalOverflow(page, "deep link");
  });

  test("a schedule of another department is not shown from the link", async ({
    page,
  }) => {
    const [mine, theirs] = await Promise.all([
      provisionNotifiedDepartment(1),
      provisionNotifiedDepartment(1),
    ]);
    const [foreign] = await schedulesOf(theirs);
    await signInAndWait(page, mine.nurseEmail);
    await page.goto(`/preferences?schedule=${foreign!.id}`);
    await expect(main(page).getByRole("alert")).toContainText(
      "پیدا نشد یا برای شما در دسترس نیست",
    );
    await expect(main(page)).not.toContainText(theirs.name);
    // Falls back to the nurse's own schedule.
    await expect(
      main(page).getByRole("region", { name: "آبان ۱۴۰۵", exact: true }),
    ).toContainText(mine.name);
  });

  test("closing the window locks editing and keeps saved preferences visible", async ({
    page,
  }) => {
    const department = await provisionNotifiedDepartment(1);
    await signInAndWait(page, department.nurseEmail);
    await page.goto("/preferences");
    await choose(page, SAT_2_ABAN, "M");

    // The Head Nurse closes collection while this tab still shows it open.
    await closePreferences(department);
    await option(day(page, SUN_3_ABAN), "N").click();
    await expect(day(page, SUN_3_ABAN).getByRole("alert")).toHaveText(
      "ثبت ترجیحات همین حالا بسته شد؛ تغییر شما ذخیره نشد.",
    );
    // The stale save was rejected on the server and rolled back in the UI.
    await expect(day(page, SUN_3_ABAN)).toContainText("بدون ترجیح");
    expect(await storedPreferencesOf(department.nurseEmail)).toEqual({
      "2026-10-24": "M",
    });

    await page.reload();
    await expect(main(page).getByRole("note")).toContainText(
      "ثبت ترجیحات بسته شده است",
    );
    await expect(
      main(page).getByRole("region", { name: "آبان ۱۴۰۵", exact: true }),
    ).toContainText("بسته — فقط مشاهده");
    await expect(day(page, SAT_2_ABAN)).toContainText("ترجیح من: M — صبح");
    await expect(day(page, SAT_2_ABAN)).toContainText(
      "مهلت ثبت ترجیح برای این روز تمام شده است.",
    );
    await expect(
      main(page).getByRole("group", { name: /^ترجیح شیفت/ }),
    ).toHaveCount(0);
    await expect(
      main(page).getByRole("button", { name: /^پاک کردن ترجیح/ }),
    ).toHaveCount(0);
    await expectNoHorizontalOverflow(page, "closed");
  });

  test("a tampered request cannot write another nurse's preference", async ({
    page,
  }) => {
    const department = await provisionNotifiedDepartment(1);
    const victim = await userIdOf(department.nurse2Email);
    await signInAndWait(page, department.nurseEmail);
    await page.goto("/preferences");

    // Inject the other nurse's id into the Server Action payload.
    let tampered = false;
    await page.route("**/preferences*", async (route) => {
      const request = route.request();
      const body = request.postData();
      if (request.method() !== "POST" || !body?.includes('"value":"N"'))
        return route.continue();
      tampered = true;
      await route.continue({
        postData: body.replace(
          '"value":"N"',
          `"value":"N","userId":"${victim}","nurseId":"${victim}"`,
        ),
      });
    });
    await choose(page, SAT_2_ABAN, "N");
    expect(tampered).toBe(true);

    expect(await storedPreferencesOf(department.nurse2Email)).toEqual({});
    expect(await storedPreferencesOf(department.nurseEmail)).toEqual({
      "2026-10-24": "N",
    });
  });

  test("a Head Nurse enters their own preference on the same page", async ({
    page,
  }) => {
    const department = await provisionNotifiedDepartment(1);
    await signInAndWait(page, department.headEmail);
    await page.goto("/preferences");
    await choose(page, SAT_2_ABAN, "ME");
    expect(await storedPreferencesOf(department.headEmail)).toEqual({
      "2026-10-24": "ME",
    });
    expect(await storedPreferencesOf(department.nurseEmail)).toEqual({});
    await expectNoHorizontalOverflow(page, "head nurse");
  });

  test("a supervisor without roster membership has nothing to enter", async ({
    page,
  }) => {
    await signInAndWait(page, DEMO_USERS.supervisor.email);
    await page.goto("/preferences");
    await expect(
      main(page).getByRole("heading", {
        name: "در حال حاضر ثبت ترجیحات برای شما باز نیست",
      }),
    ).toBeVisible();
    await expect(main(page).getByRole("group")).toHaveCount(0);
  });
});
