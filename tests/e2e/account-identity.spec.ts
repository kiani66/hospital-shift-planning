import { expect, test, type Page } from "@playwright/test";

import {
  DEMO_PASSWORD,
  accountMenuButton,
  accountPanel,
  isDesktop,
  openAccountMenu,
  signIn,
  signInAndWait,
  signOut,
} from "./support/auth";
import { provisionPersonnel } from "./support/personnel";

/**
 * Who is signed in is visible from every authenticated page through the
 * shell's account menu (a shared ward device must answer «با حساب چه کسی
 * وارد شده‌ام؟»). Everything shown comes from the signed-in actor.
 */
let fixture: Awaited<ReturnType<typeof provisionPersonnel>>;
test.beforeEach(async () => {
  fixture = await provisionPersonnel();
});

type Person = "nurse" | "head" | "supervisor" | "admin";

function expectedRoles(person: Person): string[] {
  const department = fixture.own.name;
  return {
    nurse: [`پرستار · ${department}`],
    head: [`سرپرستار · ${department}`],
    supervisor: [`سوپروایزر · ${department}`],
    admin: ["مدیر بیمارستان"],
  }[person];
}

function routesOf(person: Person): string[] {
  const department = `/departments/${fixture.own.code}`;
  return {
    nurse: [
      "/home",
      "/my-shifts",
      "/preferences",
      "/requests",
      "/notifications",
    ],
    head: ["/home", "/my-shifts", "/preferences", `${department}/schedule`],
    supervisor: ["/home", "/review", "/notifications"],
    admin: ["/home", "/admin/personnel", "/notifications"],
  }[person];
}

async function expectHeaderFits(page: Page, step: string) {
  const { page: overflow, header } = await page.evaluate(() => {
    const bar = document.querySelector("header")!;
    return {
      page:
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
      header: bar.scrollWidth - bar.clientWidth,
    };
  });
  expect(overflow, `${step}: page overflow`).toBeLessThanOrEqual(0);
  expect(header, `${step}: header overflow`).toBeLessThanOrEqual(0);
  const box = (await accountMenuButton(page).boundingBox())!;
  expect(box.height, `${step}: touch target`).toBeGreaterThanOrEqual(44);
  expect(box.x, step).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, step).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );
}

async function expectIdentityEverywhere(page: Page, person: Person) {
  const user = fixture.people[person];
  const roles = expectedRoles(person);
  for (const path of routesOf(person)) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(200);
    // The name is readable in the header itself, without opening anything.
    const button = accountMenuButton(page);
    await expect(button, path).toBeVisible();
    await expect(button, path).toHaveAttribute("aria-expanded", "false");
    await expect(button, path).toContainText(user.displayName);
    // Desktop also shows the roles beside the name.
    if (isDesktop(page))
      await expect(button, path).toContainText(roles.join("، "));
    await expectHeaderFits(page, path);

    const panel = await openAccountMenu(page);
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await expect(panel.locator('[data-account="name"]')).toHaveText(
      user.displayName,
    );
    await expect(panel.locator('[data-account="personnel-number"]')).toHaveText(
      user.personnelNumber!,
    );
    await expect(panel.locator('[data-account="role"]')).toHaveText(roles);
    // Only the user's own relations (the exact list above): never another
    // department's name, nor a role inferred from the page.
    await expect(panel).not.toContainText(fixture.other.name);
    await expect(button).not.toContainText(fixture.other.name);
    await expect(
      panel.getByRole("link", { name: "تغییر رمز عبور" }),
    ).toBeVisible();
    await expect(panel.getByRole("button", { name: "خروج" })).toBeVisible();
    await expectHeaderFits(page, `${path} (open)`);

    // Escape closes and returns focus to the button.
    await page.keyboard.press("Escape");
    await expect(accountPanel(page)).toBeHidden();
    await expect(button).toBeFocused();
  }
}

test.describe("signed-in identity in the shell", () => {
  for (const person of ["nurse", "head", "supervisor", "admin"] as const)
    test(`${person}: name, personnel number, roles and department on every page`, async ({
      page,
    }) => {
      await signInAndWait(page, fixture.people[person].email);
      await expectIdentityEverywhere(page, person);
    });

  test("closes on a click outside and on navigation", async ({ page }) => {
    await signInAndWait(page, fixture.people.nurse.email);
    await page.goto("/my-shifts");
    await openAccountMenu(page);
    // The heading's start edge (right in RTL), clear of the panel.
    const heading = (await page
      .getByRole("heading", { level: 1 })
      .boundingBox())!;
    await page.mouse.click(
      heading.x + heading.width - 4,
      heading.y + heading.height / 2,
    );
    await expect(accountPanel(page)).toBeHidden();

    await openAccountMenu(page);
    await accountPanel(page)
      .getByRole("link", { name: "تغییر رمز عبور" })
      .click();
    await expect(page).toHaveURL(/\/account\/password$/);
    await page.getByRole("link", { name: "بازگشت" }).click();
    await expect(accountMenuButton(page)).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  test("desktop keeps direct actions; mobile moves them into the menu", async ({
    page,
  }) => {
    await signInAndWait(page, fixture.people.head.email);
    // The account panel is closed (hidden), so these are the top-bar ones.
    await expect(accountPanel(page)).toBeHidden();
    const banner = page.getByRole("banner");
    const directLogout = banner.getByRole("button", { name: "خروج" });
    const directPassword = banner.getByRole("link", { name: "تغییر رمز عبور" });
    if (isDesktop(page)) {
      await expect(directLogout).toBeVisible();
      await expect(directPassword).toBeVisible();
    } else {
      await expect(directLogout).toBeHidden();
      await expect(directPassword).toBeHidden();
    }
  });

  test("change password from the account menu, then sign out from it", async ({
    page,
  }) => {
    const nurse = fixture.people.nurse;
    const NEW_PASSWORD = "Account-menu-changed-9";
    await signInAndWait(page, nurse.email);
    await page.goto("/preferences");
    await (
      await openAccountMenu(page)
    )
      .getByRole("link", { name: "تغییر رمز عبور" })
      .click();
    await expect(page).toHaveURL(/\/account\/password$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "تغییر رمز عبور",
    );
    await page.getByLabel("رمز عبور فعلی").fill(DEMO_PASSWORD);
    await page.getByLabel("رمز عبور جدید", { exact: true }).fill(NEW_PASSWORD);
    await page.getByLabel("تکرار رمز عبور جدید").fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "ذخیره رمز عبور جدید" }).click();
    await expect(page).toHaveURL(/\/(my-shifts|home)$/);
    await expect(accountMenuButton(page)).toContainText(nurse.displayName);

    // Sign out through the account menu itself (on every layout).
    await (
      await openAccountMenu(page)
    )
      .getByRole("button", { name: "خروج" })
      .click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto("/my-shifts");
    await expect(page).toHaveURL(/\/login/);

    await signIn(page, nurse.email, NEW_PASSWORD);
    await expect(page).toHaveURL(/\/(my-shifts|home)$/);
    await expect(accountMenuButton(page)).toContainText(nurse.displayName);
    await signOut(page);
  });
});
