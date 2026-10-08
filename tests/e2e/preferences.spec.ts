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
// 1 Aban is a Friday, so the date groups are «۱ آبان», «۲ تا ۸ آبان», …
const SAT_2_ABAN = "شنبه ۲ آبان ۱۴۰۵";
const SUN_3_ABAN = "یکشنبه ۳ آبان ۱۴۰۵";
const MON_4_ABAN = "دوشنبه ۴ آبان ۱۴۰۵";
const WEEK_2_8 = "۲ تا ۸ آبان";
const CLOSED_HEADLINE = "مهلت ثبت ترجیحات این ماه به پایان رسیده است";

const main = (page: Page) => page.locator("main");
const day = (page: Page, label: string) =>
  main(page).getByRole("listitem", { name: label, exact: true });
/** "M" must not match "ME": the accessible name is "<code> — <label>". */
const option = (dayCard: Locator, code: string) =>
  dayCard
    .getByRole("group", { name: /^ترجیح شیفت/ })
    .getByRole("button", { name: new RegExp(`^${code} —`) });
const groupToggle = (page: Page, label: string) =>
  main(page).getByRole("button", { name: new RegExp(`^${label}`) });
const monthHeading = (page: Page) =>
  main(page).getByRole("heading", { level: 2 }).first();
const summary = (page: Page) =>
  main(page).getByRole("region", { name: "خلاصه ترجیحات این ماه" });
const summaryCount = (page: Page, key: string) =>
  summary(page).locator(`[data-summary="${key}"]`);

async function openGroup(page: Page, label: string) {
  const toggle = groupToggle(page, label);
  if ((await toggle.getAttribute("aria-expanded")) !== "true")
    await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
}

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

    // The earliest open month, its state, department and range.
    await expect(monthHeading(page)).toHaveText("آبان ۱۴۰۵");
    const header = main(page).getByRole("region", { name: "آبان ۱۴۰۵" });
    await expect(header).toContainText("باز برای ثبت");
    await expect(header).toContainText(department.name);
    await expect(header).toContainText("۱ تا ۳۰ آبان ۱۴۰۵ (۳۰ روز)");
    await expectNoHorizontalOverflow(page, "initial");

    // Real date ranges, never numbered weeks; only the first group is open
    // (today is before Aban).
    await expect(main(page)).not.toContainText("هفته");
    await expect(groupToggle(page, "۱ آبان")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(groupToggle(page, WEEK_2_8)).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await expect(day(page, SAT_2_ABAN)).toBeHidden();
    await openGroup(page, WEEK_2_8);
    await expect(day(page, SAT_2_ABAN)).toContainText("بدون ترجیح");

    await choose(page, SAT_2_ABAN, "M");
    await choose(page, SUN_3_ABAN, "N");
    await choose(page, SAT_2_ABAN, "E");
    await expect(option(day(page, SAT_2_ABAN), "M")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await expect(day(page, SAT_2_ABAN)).toContainText("ترجیح من: عصر");
    await choose(page, MON_4_ABAN, "ME");
    await expect(day(page, MON_4_ABAN)).toContainText("ترجیح من: طولانی");

    // Clear one: back to "no preference".
    await day(page, SUN_3_ABAN)
      .getByRole("button", { name: `پاک کردن ترجیح ${SUN_3_ABAN}` })
      .click();
    await expect(day(page, SUN_3_ABAN)).toContainText("بدون ترجیح");
    await expect(
      day(page, SUN_3_ABAN).getByRole("button", { pressed: true }),
    ).toHaveCount(0);

    // The summary follows the saves; "no preference" is neutral information.
    await expect(summaryCount(page, "E")).toContainText("۱");
    await expect(summaryCount(page, "ME")).toContainText("۱");
    await expect(summaryCount(page, "N")).toContainText("۰");
    await expect(summaryCount(page, "NONE")).toContainText("۲۸");
    await expect(summary(page).getByRole("alert")).toHaveCount(0);
    await expect(groupToggle(page, WEEK_2_8)).toContainText("۲ ترجیح");
    await expectNoHorizontalOverflow(page, "after edits");

    // Collapse hides the days again.
    await groupToggle(page, WEEK_2_8).click();
    await expect(groupToggle(page, WEEK_2_8)).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await expect(day(page, SAT_2_ABAN)).toBeHidden();

    await page.reload();
    await openGroup(page, WEEK_2_8);
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

  test("keyboard: group toggles, one tab stop per day, arrows move, Enter selects", async ({
    page,
  }) => {
    const department = await provisionNotifiedDepartment(1);
    await signInAndWait(page, department.nurseEmail);
    await page.goto("/preferences");
    const toggle = groupToggle(page, WEEK_2_8);
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");

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

  test("rapid taps on one day: the last choice is shown and stored", async ({
    page,
  }) => {
    const department = await provisionNotifiedDepartment(1);
    await signInAndWait(page, department.nurseEmail);
    await page.goto("/preferences");
    await openGroup(page, WEEK_2_8);
    const card = day(page, SAT_2_ABAN);
    for (const code of ["M", "E", "N", "OFF", "ME"])
      await option(card, code).click();
    await expect(option(card, "ME")).toHaveAttribute("aria-pressed", "true");
    await expect(card.getByRole("status")).toContainText("ذخیره شد");
    await expect(card.getByRole("button", { pressed: true })).toHaveCount(1);
    await expect
      .poll(() => storedPreferencesOf(department.nurseEmail))
      .toEqual({ "2026-10-24": "ME" });
    await page.reload();
    await openGroup(page, WEEK_2_8);
    await expect(option(day(page, SAT_2_ABAN), "ME")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("a failed save is never shown as saved, and can be retried", async ({
    page,
  }) => {
    const department = await provisionNotifiedDepartment(1);
    await signInAndWait(page, department.nurseEmail);
    await page.goto("/preferences");
    await openGroup(page, WEEK_2_8);

    // The network drops the first save.
    await page.route("**/preferences*", (route) =>
      route.request().method() === "POST" ? route.abort() : route.continue(),
    );
    const card = day(page, SAT_2_ABAN);
    await option(card, "N").click();
    await expect(card.getByRole("alert")).toContainText("«شب» ذخیره نشد");
    await expect(option(card, "N")).toHaveAttribute("aria-pressed", "false");
    await expect(card).toContainText("بدون ترجیح");
    await expect(summaryCount(page, "N")).toContainText("۰");
    expect(await storedPreferencesOf(department.nurseEmail)).toEqual({});

    await page.unroute("**/preferences*");
    await card.getByRole("button", { name: "تلاش مجدد" }).click();
    await expect(option(card, "N")).toHaveAttribute("aria-pressed", "true");
    await expect(card.getByRole("status")).toContainText("ذخیره شد");
    await expect(card.getByRole("alert")).toHaveCount(0);
    await expect(summaryCount(page, "N")).toContainText("۱");
    expect(await storedPreferencesOf(department.nurseEmail)).toEqual({
      "2026-10-24": "N",
    });
  });

  test("a PREFERENCES_OPENED notification opens its schedule's month", async ({
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
    await expect(monthHeading(page)).toHaveText("آذر ۱۴۰۵");
    // The other open month is one tap away.
    const others = main(page).getByRole("navigation", {
      name: "ماه‌های دیگر با ثبت ترجیحات",
    });
    await expect(others.getByRole("link")).toHaveCount(1);
    await others.getByRole("link", { name: /آبان ۱۴۰۵/ }).click();
    await expect(page).toHaveURL(/\/preferences\?month=1405-08$/);
    await expect(monthHeading(page)).toHaveText("آبان ۱۴۰۵");
    await expectNoHorizontalOverflow(page, "deep link");
  });

  test("defaults to the earliest open month; closed months stay reachable", async ({
    page,
  }) => {
    const department = await provisionNotifiedDepartment(2);
    await closePreferences(department, 0);
    await signInAndWait(page, department.nurseEmail);
    await page.goto("/preferences");

    // Aban is closed, Azar open: Azar is shown and editable.
    await expect(monthHeading(page)).toHaveText("آذر ۱۴۰۵");
    await expect(
      main(page).getByRole("region", { name: "آذر ۱۴۰۵" }),
    ).toContainText("باز برای ثبت");
    await expect(summary(page)).toBeVisible();

    // Back one month: Aban, closed, read-only.
    await main(page)
      .getByRole("link", { name: /^ماه قبل/ })
      .click();
    await expect(page).toHaveURL(/\/preferences\?month=1405-08$/);
    await expect(monthHeading(page)).toHaveText("آبان ۱۴۰۵");
    await expect(
      main(page).getByRole("region", { name: "آبان ۱۴۰۵" }),
    ).toContainText("بسته");
    await expect(
      main(page).getByRole("heading", { name: CLOSED_HEADLINE }),
    ).toBeVisible();
    await expect(
      main(page).getByRole("group", { name: /^ترجیح شیفت/ }),
    ).toHaveCount(0);

    // Further back: a month without collection is still a month.
    await main(page)
      .getByRole("link", { name: /^ماه قبل/ })
      .click();
    await expect(monthHeading(page)).toHaveText("مهر ۱۴۰۵");
    await expect(main(page)).toContainText("ثبت ترجیحات ندارید");

    // Browser history works like any link.
    await page.goBack();
    await expect(monthHeading(page)).toHaveText("آبان ۱۴۰۵");
    await main(page)
      .getByRole("link", { name: /^ماه بعد/ })
      .click();
    await expect(page).toHaveURL(/\/preferences\?month=1405-09$/);
    await expect(main(page).getByRole("group").first()).toBeVisible();
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
      main(page).getByRole("region", { name: "آبان ۱۴۰۵" }),
    ).toContainText(mine.name);
  });

  test("closing the window: a stale save is rejected, then a read-only summary", async ({
    page,
  }) => {
    const department = await provisionNotifiedDepartment(1);
    await signInAndWait(page, department.nurseEmail);
    await page.goto("/preferences");
    await openGroup(page, WEEK_2_8);
    await choose(page, SAT_2_ABAN, "M");

    // The Head Nurse closes collection while this tab still shows it open.
    await closePreferences(department);
    await option(day(page, SUN_3_ABAN), "N").click();
    await expect(day(page, SUN_3_ABAN).getByRole("alert")).toContainText(
      "ثبت ترجیحات همین حالا بسته شد؛ تغییر شما ذخیره نشد.",
    );
    // Rejected on the server, rolled back in the UI, and no pointless retry.
    await expect(day(page, SUN_3_ABAN)).toContainText("بدون ترجیح");
    await expect(
      day(page, SUN_3_ABAN).getByRole("button", { name: "تلاش مجدد" }),
    ).toHaveCount(0);
    expect(await storedPreferencesOf(department.nurseEmail)).toEqual({
      "2026-10-24": "M",
    });

    // No month is open any more: the page opens on the current month, and
    // the closed one is a shortcut away.
    await page.reload();
    await expect(monthHeading(page)).toHaveText("مهر ۱۴۰۵");
    await main(page)
      .getByRole("navigation", { name: "ماه‌های دیگر با ثبت ترجیحات" })
      .getByRole("link", { name: /آبان ۱۴۰۵\s*\(بسته\)/ })
      .click();
    await expect(page).toHaveURL(/\/preferences\?month=1405-08$/);
    await expect(
      main(page).getByRole("region", { name: "آبان ۱۴۰۵" }),
    ).toContainText("بسته");
    await expect(
      main(page).getByRole("heading", { name: CLOSED_HEADLINE }),
    ).toBeVisible();
    // No editing controls, no thirty disabled cards: the saved preferences.
    await expect(
      main(page).getByRole("group", { name: /^ترجیح شیفت/ }),
    ).toHaveCount(0);
    await expect(
      main(page).getByRole("button", { name: /^پاک کردن ترجیح/ }),
    ).toHaveCount(0);
    const submitted = main(page).getByRole("region", {
      name: "ترجیحات ثبت‌شده من",
    });
    await expect(submitted.getByRole("listitem")).toHaveCount(1);
    // «ترجیح من:» then the shared chip (code + label, e.g. «OFF استراحت»).
    await expect(day(page, SAT_2_ABAN)).toContainText("ترجیح من:");
    await expect(day(page, SAT_2_ABAN)).toContainText("Mصبح");
    await expect(summaryCount(page, "M")).toContainText("۱");
    await expect(summaryCount(page, "NONE")).toContainText("۲۹");
    await expectNoHorizontalOverflow(page, "closed");

    await main(page).getByRole("link", { name: "مشاهده شیفت‌های من" }).click();
    await expect(page).toHaveURL(/\/my-shifts\?month=1405-08$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "شیفت‌های من",
    );
  });

  test("a tampered request cannot write another nurse's preference", async ({
    page,
  }) => {
    const department = await provisionNotifiedDepartment(1);
    const victim = await userIdOf(department.nurse2Email);
    await signInAndWait(page, department.nurseEmail);
    await page.goto("/preferences");
    await openGroup(page, WEEK_2_8);

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
    await openGroup(page, WEEK_2_8);
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

test.describe("nurse preferences on narrow phones", () => {
  for (const width of [360, 390]) {
    test(`${width}px: no horizontal overflow, comfortable touch targets`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      const department = await provisionNotifiedDepartment(1);
      await signInAndWait(page, department.nurseEmail);
      await page.goto("/preferences");
      await openGroup(page, WEEK_2_8);
      await choose(page, SAT_2_ABAN, "OFF");
      await expectNoHorizontalOverflow(page, `${width}px editable`);

      const card = day(page, SAT_2_ABAN);
      for (const code of ["M", "E", "N", "ME", "OFF"]) {
        const box = (await option(card, code).boundingBox())!;
        expect(box.height, `${code} height`).toBeGreaterThanOrEqual(44);
        expect(box.width, `${code} width`).toBeGreaterThanOrEqual(40);
        // Not clipped by the viewport.
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
      }
      const toggle = (await groupToggle(page, WEEK_2_8).boundingBox())!;
      expect(toggle.height).toBeGreaterThanOrEqual(44);
      const clear = card.getByRole("button", {
        name: `پاک کردن ترجیح ${SAT_2_ABAN}`,
      });
      await expect(clear).toBeVisible();
      expect(
        (await clear.boundingBox())!.x + (await clear.boundingBox())!.width,
      ).toBeLessThanOrEqual(width);

      await closePreferences(department);
      await page.goto("/preferences?month=1405-08");
      await expect(
        main(page).getByRole("link", { name: "مشاهده شیفت‌های من" }),
      ).toBeVisible();
      await expectNoHorizontalOverflow(page, `${width}px closed`);
    });
  }
});

test.describe("nurse preferences: one day per row at every width", () => {
  // Phones, both sides of the sidebar breakpoint (768px), the range where the
  // summary sits above the days, and desktop with the summary beside them.
  const WIDTHS = [360, 390, 767, 768, 900, 1024, 1279, 1280, 1536];

  test("days never share a row, fill it, and stay usable", async ({ page }) => {
    test.setTimeout(120_000);
    const department = await provisionNotifiedDepartment(1);
    await signInAndWait(page, department.nurseEmail);
    await page.goto("/preferences");
    await openGroup(page, WEEK_2_8);
    const panelId = await groupToggle(page, WEEK_2_8).getAttribute(
      "aria-controls",
    );
    const panel = page.locator(`[id="${panelId}"]`);
    const cards = panel.getByRole("listitem");
    await expect(cards).toHaveCount(7);

    const saved: Record<string, string> = {};
    const codes = ["M", "E", "N", "ME", "OFF"];
    for (const [i, width] of WIDTHS.entries()) {
      await page.setViewportSize({ width, height: 900 });
      await expectNoHorizontalOverflow(page, `${width}px`);

      const list = (await panel.getByRole("list").boundingBox())!;
      const boxes = await cards.evaluateAll((els) =>
        els.map((e) => {
          const r = e.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, bottom: r.bottom };
        }),
      );
      for (const [n, box] of boxes.entries()) {
        // The full width of the list: one column, never a half-width card.
        expect(box.width, `${width}px day ${n}`).toBeCloseTo(list.width, 0);
        expect(box.x, `${width}px day ${n}`).toBeCloseTo(list.x, 0);
        // Each day starts below the previous one: never side by side.
        if (n > 0)
          expect(box.y, `${width}px day ${n}`).toBeGreaterThanOrEqual(
            boxes[n - 1]!.bottom,
          );
      }

      const card = day(page, SAT_2_ABAN);
      for (const code of codes) {
        const box = (await option(card, code).boundingBox())!;
        expect(box.height, `${width}px ${code} height`).toBeGreaterThanOrEqual(
          44,
        );
        expect(box.width, `${width}px ${code} width`).toBeGreaterThanOrEqual(
          40,
        );
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
        // The code and its Persian name are shown in full (not truncated).
        const clipped = await option(card, code).evaluate((button) =>
          [...button.querySelectorAll("span")].some(
            (s) => s.scrollWidth > s.clientWidth + 1,
          ),
        );
        expect(clipped, `${width}px ${code} label clipped`).toBe(false);
      }
      // «ترجیح من: …» is readable beside or above the choices.
      const status = card.getByText(/^(ترجیح من: |بدون ترجیح)/);
      expect(
        await status.evaluate((s) => s.scrollWidth <= s.clientWidth + 1),
        `${width}px current preference clipped`,
      ).toBe(true);

      // Auto-save still works at this width (a different day each time).
      if (i % 3 === 0) {
        const label = [SAT_2_ABAN, SUN_3_ABAN, MON_4_ABAN][i / 3]!;
        const code = codes[i / 3]!;
        await choose(page, label, code);
        saved[label] = code;
      }
    }
    expect(await storedPreferencesOf(department.nurseEmail)).toEqual({
      "2026-10-24": saved[SAT_2_ABAN],
      "2026-10-25": saved[SUN_3_ABAN],
      "2026-10-26": saved[MON_4_ABAN],
    });

    // The accordion still collapses and reopens.
    await groupToggle(page, WEEK_2_8).click();
    await expect(day(page, SAT_2_ABAN)).toBeHidden();
    await openGroup(page, WEEK_2_8);
    await expect(
      option(day(page, SAT_2_ABAN), saved[SAT_2_ABAN]!),
    ).toHaveAttribute("aria-pressed", "true");
  });
});
