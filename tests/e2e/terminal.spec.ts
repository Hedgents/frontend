import { expect, test, type Page } from "@playwright/test";
import { grantLocalBetaSession } from "./session";

async function stubReadOnlyApis(page: Page) {
  await page.route("**/api/quotes", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      asOf: new Date().toISOString(),
      refreshAfterMs: 60_000,
      markets: {},
      products: {},
      providerState: "online",
    }),
  }));
  await page.route("**/api/registry**", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ error: "Stubbed registry" }),
    status: 503,
  }));
  await page.route("**/api/execution/compare", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ error: "Stubbed route monitor" }),
    status: 503,
  }));
}

test.beforeEach(async ({ context, page }) => {
  await grantLocalBetaSession(context);
  await stubReadOnlyApis(page);
  await page.goto("/");
});

test("exposes discovery, two-way order controls, and all settlement assets", async ({ page }) => {
  await expect(page.getByRole("heading", { name: /Choose the metal/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Buy Gold" })).toBeVisible();
  await expect(page.getByLabel("Spend")).toHaveValue("100");
  await page.getByRole("button", { name: /sell metal/i }).click();
  await expect(page.getByRole("heading", { name: /Sell PAXG/i })).toBeVisible();
  for (const stable of ["USDC", "USDT", "USDG"]) {
    await expect(page.getByRole("button", { name: new RegExp(stable, "i") })).toBeVisible();
  }
});

test("keeps new Rail funding off while preserving the terminal EVM wallet connector", async ({ page }) => {
  const funding = page.getByRole("group", { name: "Purchase funding chain" });
  await expect(funding.getByRole("button", { name: /Solana/i })).toBeVisible();
  await expect(funding.getByRole("button", { name: /Ethereum/i })).toHaveCount(0);
  await expect(funding.getByRole("button", { name: /Base/i })).toHaveCount(0);

  await page.getByRole("button", { name: "Connect wallets" }).click();
  await expect(page.getByRole("heading", { name: "Connect wallets" })).toBeVisible();
  await expect(page.getByText("EVM source wallet")).toBeVisible();
  await expect(page.getByText(/terminal currently pauses new Rail funding/i)).toBeVisible();
});

test("sell to buy resets the cap, settlement, and debounced comparison scope", async ({ page }) => {
  const comparisonBodies: Array<Record<string, unknown>> = [];
  page.on("request", (request) => {
    if (!request.url().endsWith("/api/execution/compare")) return;
    comparisonBodies.push(request.postDataJSON() as Record<string, unknown>);
  });

  await page.getByRole("button", { name: /sell metal/i }).click();
  await page.getByRole("button", { name: /USDT Tether/i }).click();
  await page.getByLabel("Sell").fill("0.123");
  await page.waitForTimeout(650);
  comparisonBodies.length = 0;

  await page.getByRole("button", { name: /buy stable/i }).click();
  await expect(page.getByLabel("Spend")).toHaveValue("100");
  await expect.poll(
    () => comparisonBodies.filter((body) => body.side === "buy").length,
  ).toBeGreaterThan(0);

  for (const body of comparisonBodies.filter((candidate) => candidate.side === "buy")) {
    expect(body.amountUsd).toBe("100");
    expect(body).not.toHaveProperty("amountToken");
    expect(body.settlementAssetIds).toEqual(["usdc"]);
  }
});

test("keeps portfolio and order recovery surfaces reachable without a wallet", async ({ page }) => {
  await page.getByRole("button", { name: "portfolio" }).click();
  await expect(page.getByRole("heading", { name: /Connect the Solana wallet/i })).toBeVisible();
  await page.getByRole("button", { name: "orders" }).click();
  await expect(page.getByText("No submitted orders yet.")).toBeVisible();
  await expect(page.getByText("Import receipt")).toBeVisible();
});

test("does not overflow the viewport", async ({ page }) => {
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    offenders: Array.from(document.querySelectorAll("body *"))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return { tag: element.tagName, className: element.className, left: rect.left, right: rect.right, width: rect.width };
      })
      .filter((rect) => rect.right > document.documentElement.clientWidth + 1 || rect.left < -1)
      .slice(0, 12),
  }));
  expect(
    dimensions.scrollWidth,
    `Horizontal overflow: ${JSON.stringify(dimensions.offenders)}`,
  ).toBeLessThanOrEqual(dimensions.clientWidth + 1);
});

test("keeps the product passport directly below its comparison", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "Desktop two-column layout");

  const comparison = page.locator("#selected-product");
  const passport = page.locator('[aria-label$="product passport"]');
  await expect(comparison).toBeVisible();
  await expect(passport).toBeAttached();

  const gap = await page.evaluate(() => {
    const comparisonNode = document.querySelector<HTMLElement>("#selected-product")!;
    const passportNode = document.querySelector<HTMLElement>('[aria-label$="product passport"]')!;
    return passportNode.offsetTop - comparisonNode.offsetTop - comparisonNode.offsetHeight;
  });

  expect(gap).toBeGreaterThanOrEqual(0);
  expect(gap).toBeLessThanOrEqual(20);
});

test("serves the terminal and evidence APIs with hardened browser headers", async ({ page }) => {
  const documentResponse = await page.request.get("/");
  expect(documentResponse.ok()).toBeTruthy();
  const documentHeaders = documentResponse.headers();
  const scriptPolicy = documentHeaders["content-security-policy"]
    .split(";")
    .find((directive) => directive.trim().startsWith("script-src"));
  expect(scriptPolicy).toContain("script-src 'self' 'nonce-");
  expect(scriptPolicy).not.toContain("'unsafe-inline'");
  expect(documentHeaders["x-content-type-options"]).toBe("nosniff");
  expect(documentHeaders["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(documentHeaders["cross-origin-opener-policy"]).toBe("same-origin-allow-popups");

  const artifactResponse = await page.request.get("/api/scarcity/artifacts/not-a-real-artifact");
  const artifactHeaders = artifactResponse.headers();
  expect(artifactHeaders["content-security-policy"]).toContain("default-src 'none'");
  expect(artifactHeaders["x-content-type-options"]).toBe("nosniff");
});

test("accepts the administrator code at the normal terminal gate", async ({ context, page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  await context.clearCookies();
  await page.goto("/access");
  await page.getByLabel("Private beta invite").fill("hedgents-admin");
  await page.getByRole("button", { name: "Enter terminal" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: /Choose the metal/i })).toBeVisible();

  const adminResponse = await page.request.get("/api/admin/invites");
  expect(adminResponse.status()).not.toBe(401);
  expect(pageErrors.join("\n")).not.toMatch(/DisposableStack|Hydration failed|Minified React error #418/);
});

test("keeps operator analytics behind a separate admin session", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login$/);
  await page.getByLabel("Administrator code").fill("hedgents-admin");
  await page.getByRole("button", { name: "Open console" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "Execution funnel" })).toBeVisible();
  await expect(page.getByText("Wallet addresses", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Scarcity exchange" })).toBeVisible();
  await page.getByRole("button", { name: "Validate + derive accounts" }).click();
  await expect(page.getByText("Specification reproduced")).toBeVisible();
  await expect(page.getByRole("button", { name: "Operator manifest required" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Evidence required before resolution" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Resolve market" })).toBeDisabled();
  await expect(page.getByRole("heading", { name: "Scarcity data publication" })).toBeVisible();
  await expect(page.getByLabel("Scarcity data publication").getByText("Storage not ready")).toBeVisible();
  await expect(page.getByRole("button", { name: "Guided publication" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Expert JSON" })).toBeVisible();
  const marketResponse = await page.request.get("/api/scarcity/markets");
  expect(marketResponse.ok()).toBeTruthy();
  const marketPayload = await marketResponse.json();
  const resolutionMarket = marketPayload.markets[0];
  await page.getByLabel("Resolution report JSON").fill(JSON.stringify({
    schemaVersion: "1.0.0",
    marketId: resolutionMarket.marketId,
    questionHash: resolutionMarket.questionHash,
    rulesHash: resolutionMarket.rulesHash,
    outcome: "yes",
    evaluatedValue: resolutionMarket.question.observation.threshold,
    evaluation: "The committed methodology produced a value equal to the published market threshold.",
    observations: [{
      sourceId: resolutionMarket.question.sources[0].id,
      value: resolutionMarket.question.observation.threshold,
      unit: resolutionMarket.question.observation.unit,
      observedAt: resolutionMarket.question.observation.observedAt,
      publishedAt: "2027-01-01T12:00:00.000Z",
      retrievedAt: "2027-01-01T12:05:00.000Z",
      artifactHash: "ab".repeat(32),
      artifactUrl: "https://hedgents.com/evidence/e2e.json",
    }],
    generatedAt: "2027-01-03T00:00:00.000Z",
  }));
  await page.getByRole("button", { name: "Validate + publish evidence" }).click();
  await expect(page.getByText(/Resolution artifact URL does not match its committed content hash/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Resolve market" })).toBeDisabled();
  await page.getByRole("button", { name: "Generate invite" }).click();
  const generated = page.getByTestId("generated-invite-code");
  await expect(generated).toHaveText(/^HG-BETA-[A-F0-9]{16}$/);
  const generatedCode = (await generated.textContent()) ?? "";
  const logout = await page.request.post("/api/auth/logout", { data: {} });
  expect(logout.ok()).toBeTruthy();
  await page.goto("/access");
  await page.getByLabel("Private beta invite").fill(generatedCode);
  await page.getByRole("button", { name: "Enter terminal" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: /Choose the metal/i })).toBeVisible();
  expect(pageErrors.join("\n")).not.toMatch(/DisposableStack|Hydration failed|Minified React error #418/);
});
