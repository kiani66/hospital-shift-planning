import { expect, type Page } from "@playwright/test";
import { accountMenuButton, signIn } from "./auth";

/** Reset journeys require the authenticated UI, not idle background prefetch streams. */
export async function signInForReset(page: Page, identifier: string) {
  await signIn(page, identifier);
  await expect(page).toHaveURL(/\/(my-shifts|home|review)$/);
  await expect(accountMenuButton(page)).toBeVisible();
}
