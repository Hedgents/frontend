import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/access?next=%2Frelics");
  await page.getByLabel("Private beta invite").fill("hedgents-admin");
  await page.getByRole("button", { name: "Enter terminal" }).click();
  await expect(page).toHaveURL(/\/relics$/);
});

test("opens as a terminal tab between metal tokens and scarcity markets", async ({ page }) => {
  await page.goto("/");

  const tabs = page.getByRole("navigation", { name: "Terminal navigation" }).getByRole("button");
  await expect(tabs.nth(0)).toHaveText("Metal tokens");
  await expect(tabs.nth(1)).toHaveText("Relics");
  await expect(tabs.nth(2)).toHaveText("Scarcity markets");

  await tabs.nth(1).click();
  await expect(page).toHaveURL(/\?view=relics/);
  await expect(tabs.nth(1)).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "Gold, cast into chance." })).toBeVisible();
  await expect(page.getByRole("banner").getByRole("button", { name: "Hedgents Metal Terminal home" })).toBeVisible();
});

test("discloses the fixed-deck economy and keeps real payments disabled", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "Gold, cast into chance." })).toBeVisible();
  await expect(page.getByText("$35.00", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("85% RTP", { exact: true })).toBeVisible();
  await expect(page.getByText("Payments and minting are disabled", { exact: false })).toBeVisible();
  await expect(page.locator("article")).toHaveCount(5);
  const artwork = page.locator("article img");
  await expect(artwork).toHaveCount(5);
  for (let index = 0; index < 5; index += 1) {
    const image = artwork.nth(index);
    await image.scrollIntoViewIfNeeded();
    await expect.poll(() => image.evaluate(
      (element) => element instanceof HTMLImageElement && element.complete && element.naturalWidth > 0,
    )).toBe(true);
  }
  await expect(page.getByText("55%", { exact: true })).toBeVisible();
  await expect(page.getByText("1%", { exact: true })).toBeVisible();
});

test("runs a local reveal without creating a payment or mint action", async ({ page }) => {
  await page.getByRole("button", { name: "Simulate $35 pull" }).click();
  await expect(page.getByText("Shuffling fixed deck…", { exact: true })).toBeVisible();
  await expect(page.getByText("Relic revealed", { exact: true })).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText("Gold extraction value", { exact: true })).toBeVisible();
  await expect(page.getByText(/#[0-9]{3}/)).toBeVisible();
  await expect(page.locator('[data-reveal-artwork="true"] img')).toHaveAttribute("src", /genesis-v2%2Ffinal|genesis-v2\/final/);
  await expect(page.getByRole("button", { name: "Simulate another" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reset reveal simulation" })).toBeVisible();
  await expect(page.getByRole("button", { name: /buy|mint|purchase/i })).toHaveCount(0);
});
