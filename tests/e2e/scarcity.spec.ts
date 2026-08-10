import { expect, test } from "@playwright/test";
import { grantLocalBetaSession } from "./session";

test.beforeEach(async ({ context, page }) => {
  await grantLocalBetaSession(context);
  await page.goto("/scarcity");
});

test("renders the Metal State Oracle and keeps markets downstream", async ({ page }, testInfo) => {
  await page.getByRole("button", { name: "Intelligence", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Every metal has/i })).toBeVisible();
  await expect(page.getByText("Periodic registry", { exact: true })).toBeVisible();
  await expect(page.getByText(/USGS 2026 annual physical baseline/i)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Copper", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /92 U Uranium/i }).click();
  await expect(page.getByRole("heading", { name: "Uranium", exact: true })).toBeVisible();
  await expect(page.getByText("Market compiler", { exact: true })).toBeVisible();
  await page.getByLabel("Scarcity Exchange navigation").getByRole("button", { name: "Trade", exact: true }).click();
  await page.getByRole("tab", { name: "Event markets", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Copper tightness above 70/i })).toBeVisible();
  await expect(page.getByText("No live YES bids or asks")).toBeVisible();
  await page.getByLabel("Search and select a scarcity market").getByRole("button", { name: /Au.*Gold/i }).click();
  await expect(page.getByRole("heading", { name: /Gold tightness above 62/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Trading has not opened." })).toBeVisible();
  await expect(page.getByText("No wallet connection or value-moving action is available", { exact: false })).toBeVisible();
  if (testInfo.project.name === "desktop-chrome") {
    await page.getByRole("button", { name: "Intelligence", exact: true }).click();
    await page.screenshot({ path: "/private/tmp/hedgents-metal-state-oracle.png", fullPage: true });
  }
});

test("keeps the scarcity workspace inside the viewport", async ({ page }) => {
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
});

test("teaches the curve payout before asking for a forecast", async ({ page }, testInfo) => {
  await expect(page.getByRole("heading", { name: "Predict Copper's final scarcity score." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Closer to the final score earns a larger share." })).toBeVisible();
  await expect(page.getByText("Your maximum loss is your stake.", { exact: true })).toBeVisible();

  const ticket = page.locator("#curve-forecast-ticket");
  await expect(ticket.getByText("Closer earns more.", { exact: true })).toBeVisible();
  await expect(ticket.getByRole("spinbutton", { name: /1\. Your forecast score/i })).toBeVisible();
  await expect(ticket.getByRole("textbox", { name: /2\. USDC at risk/i })).toBeVisible();
  await expect(ticket.getByText("Total P/L if exact", { exact: true })).toBeVisible();

  const stakeInput = ticket.getByRole("textbox", { name: /2\. USDC at risk/i });
  await stakeInput.fill("50");
  await expect(ticket.getByText("50 USDC", { exact: true }).first()).toBeVisible();

  await page.getByText("See exactly how the pool pays", { exact: true }).click();
  await expect(page.getByText("Interactive learning example", { exact: true })).toBeVisible();
  await expect(page.getByText("If you put 50 USDC at 50.00", { exact: true })).toBeVisible();
  await expect(page.getByText("Exact result", { exact: true })).toBeVisible();
  await expect(page.getByText("1 bucket away", { exact: true })).toBeVisible();
  await expect(page.getByText("10 buckets away", { exact: true })).toBeVisible();

  await ticket.getByText("Payout assumptions + pool safety", { exact: true }).click();
  await expect(ticket.getByText("Learning example only—not a quote.", { exact: false })).toBeVisible();

  if (testInfo.project.name.startsWith("mobile")) {
    const order = await page.evaluate(() => {
      const forecastTicket = document.querySelector("#curve-forecast-ticket");
      const payoutChart = document.querySelector('[aria-label^="Payout weight and USDC pool distribution"]');
      return {
        ticketTop: forecastTicket?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY,
        chartTop: payoutChart?.getBoundingClientRect().top ?? Number.NEGATIVE_INFINITY,
      };
    });
    expect(order.ticketTop).toBeLessThan(order.chartTop);
  }

  if (testInfo.project.name === "desktop-chrome" || testInfo.project.name === "mobile-webkit") {
    const screenshotTarget = testInfo.project.name === "mobile-webkit"
      ? ticket
      : page.getByRole("heading", { name: "Closer to the final score earns a larger share." });
    await screenshotTarget.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `/private/tmp/hedgents-curve-activation-${testInfo.project.name}.png`,
      fullPage: false,
    });
  }
});

test("pins the side rails while only the middle workspace scrolls", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "Desktop workspace behavior");
  await expect(page.getByTestId("curve-shell")).toBeVisible();
  await page.getByTestId("curve-ticket").getByText("Payout assumptions + pool safety", { exact: true }).click();

  const layout = await page.evaluate(() => {
    const shell = document.querySelector<HTMLElement>('[data-testid="curve-shell"]')!;
    const catalog = document.querySelector<HTMLElement>('[data-testid="curve-catalog"]')!;
    const middle = document.querySelector<HTMLElement>('[data-testid="curve-middle-scroll"]')!;
    const ticket = document.querySelector<HTMLElement>('[data-testid="curve-ticket"]')!;
    const before = {
      catalogTop: catalog.getBoundingClientRect().top,
      ticketTop: ticket.getBoundingClientRect().top,
    };
    middle.scrollTop = Math.min(400, middle.scrollHeight - middle.clientHeight);
    const after = {
      catalogTop: catalog.getBoundingClientRect().top,
      ticketTop: ticket.getBoundingClientRect().top,
    };
    const middleScrollBeforeTicket = middle.scrollTop;
    ticket.scrollTop = Math.min(300, ticket.scrollHeight - ticket.clientHeight);
    return {
      documentClientHeight: document.documentElement.clientHeight,
      bodyScrollHeight: document.body.scrollHeight,
      terminal: (() => {
        const node = document.querySelector<HTMLElement>('[class*="terminalScarcity"]');
        return node ? { position: getComputedStyle(node).position, top: node.getBoundingClientRect().top, bottom: node.getBoundingClientRect().bottom } : null;
      })(),
      shellBottom: shell.getBoundingClientRect().bottom,
      catalogBottom: catalog.getBoundingClientRect().bottom,
      ticketBottom: ticket.getBoundingClientRect().bottom,
      viewportHeight: window.innerHeight,
      middleScrollable: middle.scrollHeight > middle.clientHeight,
      middleScrollTop: middle.scrollTop,
      ticketOverflowY: getComputedStyle(ticket).overflowY,
      ticketScrollable: ticket.scrollHeight > ticket.clientHeight,
      ticketScrollTop: ticket.scrollTop,
      middleScrollStableWhileTicketScrolls: middle.scrollTop === middleScrollBeforeTicket,
      before,
      after,
    };
  });

  expect(layout.bodyScrollHeight).toBeLessThanOrEqual(layout.documentClientHeight + 1);
  expect(layout.terminal?.position).toBe("fixed");
  expect(layout.shellBottom).toBeLessThanOrEqual(layout.viewportHeight + 1);
  expect(layout.catalogBottom).toBeLessThanOrEqual(layout.viewportHeight + 1);
  expect(layout.ticketBottom).toBeLessThanOrEqual(layout.viewportHeight + 1);
  expect(layout.middleScrollable).toBe(true);
  expect(layout.middleScrollTop).toBeGreaterThan(0);
  expect(layout.ticketOverflowY).toBe("auto");
  expect(layout.ticketScrollable).toBe(true);
  expect(layout.ticketScrollTop).toBeGreaterThan(0);
  expect(layout.middleScrollStableWhileTicketScrolls).toBe(true);
  expect(layout.after.catalogTop).toBeCloseTo(layout.before.catalogTop, 1);
  expect(layout.after.ticketTop).toBeCloseTo(layout.before.ticketTop, 1);
});

test("uses one consistent Curve and Event market switch", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "Desktop tab geometry");

  const curveTabs = page.getByTestId("scarcity-instrument-tabs");
  await expect(curveTabs.getByText("Predict the final number", { exact: true })).toBeVisible();
  await expect(curveTabs.getByText("Predict whether it happens", { exact: true })).toBeVisible();
  await expect(curveTabs.getByRole("tab", { name: "Curve forecasts", exact: true })).toHaveAttribute("aria-selected", "true");
  const curveHeight = (await curveTabs.boundingBox())?.height ?? 0;

  await curveTabs.getByRole("tab", { name: "Event markets", exact: true }).click();
  const eventTabs = page.getByTestId("scarcity-instrument-tabs");
  await expect(eventTabs.getByText("Predict the final number", { exact: true })).toBeVisible();
  await expect(eventTabs.getByText("Predict whether it happens", { exact: true })).toBeVisible();
  await expect(eventTabs.getByRole("tab", { name: "Event markets", exact: true })).toHaveAttribute("aria-selected", "true");
  const eventHeight = (await eventTabs.boundingBox())?.height ?? 0;

  expect(curveHeight).toBeGreaterThan(0);
  expect(eventHeight).toBeCloseTo(curveHeight, 1);
});

test("keeps event markets independently scrollable on desktop", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "Desktop fixed-shell behavior");
  await page.getByRole("tab", { name: "Event markets", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Copper tightness above 70/i })).toBeVisible();

  const scrolling = await page.getByLabel("Scarcity workspace").evaluate((workspace) => {
    const node = workspace as HTMLElement;
    const before = node.scrollTop;
    node.scrollTop = Math.min(500, node.scrollHeight - node.clientHeight);
    return {
      before,
      after: node.scrollTop,
      clientHeight: node.clientHeight,
      scrollHeight: node.scrollHeight,
      overflowY: getComputedStyle(node).overflowY,
    };
  });

  expect(scrolling.scrollHeight).toBeGreaterThan(scrolling.clientHeight);
  expect(scrolling.overflowY).toBe("auto");
  expect(scrolling.after).toBeGreaterThan(scrolling.before);
});

test("keeps trading navigation focused and the Trust Center reachable", async ({ page }, testInfo) => {
  const navigation = page.getByLabel("Scarcity Exchange navigation");
  await expect(navigation.getByRole("button")).toHaveCount(3);
  await expect(navigation.getByRole("button", { name: "Intelligence", exact: true })).toBeVisible();
  await expect(navigation.getByRole("button", { name: "Trade", exact: true })).toBeVisible();
  await expect(navigation.getByRole("button", { name: "Gold 15", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Intelligence", exact: true }).click();
  await expect(page.getByText("Market compiler", { exact: true })).toBeVisible();
  await expect(page.getByText("Data and event paths stay distinct until their rules are frozen", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Trust center", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Rules before risk." })).toBeVisible();
  if (testInfo.project.name === "desktop-chrome") {
    await page.screenshot({ path: "/private/tmp/hedgents-trust-center-top.png", fullPage: false });
  }
  await expect(page.getByRole("heading", { name: "Rules & Evidence", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "You can lose the full amount at risk." })).toBeVisible();
  await expect(page.getByText("Formal public Terms of Use · pending reviewed publication", { exact: true })).toBeVisible();
  await expect(page.getByText("Metric SHA-256")).toBeVisible();
  const width = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(width.scrollWidth).toBeLessThanOrEqual(width.clientWidth + 1);
});

test("reproduces canonical contract commitments in the browser", async ({ page }, testInfo) => {
  await page.getByRole("button", { name: "Trust center", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Copper Hedgents Market Tightness Score curve/i })).toBeVisible();
  await page.getByRole("button", { name: "Reproduce hashes" }).click();
  await expect(page.getByText("Metric and rules commitments reproduced locally.")).toBeVisible();
  await expect(page.getByText("Frozen resolution inputs")).toBeVisible();
  await expect(page.getByText("Canonical documents", { exact: true })).toBeVisible();
  if (testInfo.project.name === "desktop-chrome") {
    await page.screenshot({ path: "/private/tmp/hedgents-trust-center.png", fullPage: true });
  }
});

test("preserves Trust Center deep links and returns to the selected market", async ({ page }) => {
  await page.goto("/?view=scarcity&scx=evidence&instrument=curve");
  await expect(page.getByTestId("trust-center")).toBeVisible();
  await expect(page.getByRole("button", { name: "Trust center", exact: true })).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "Back to trade", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Predict Copper's final scarcity score." })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Rules before risk." })).toBeVisible();
});
