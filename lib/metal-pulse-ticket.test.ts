import assert from "node:assert/strict";
import test from "node:test";
import {
  formatPulseAmount,
  formatPulseExact,
  priceMetalPulseTicket,
  pulseFee,
  pulseQuote,
  PULSE_TOKEN_SCALE,
  type PulseOffer,
} from "./metal-pulse-ticket";

const FRESH: PulseOffer = {
  maker: "HBvV7YqSRSPW4YEBsDvpvF2PrUWFubqVbTNYafkddTsy",
  orderId: "a".repeat(64),
  priceMicroUsdc: "500000",
  remainingQuantity: String(50n * PULSE_TOKEN_SCALE),
  originalQuantity: String(50n * PULSE_TOKEN_SCALE),
  quoteFilled: "0",
  feePaid: "0",
  feeBps: 100,
};

test("a five unit stake at half a unit buys ten contracts that pay ten", () => {
  const ticket = priceMetalPulseTicket({ offer: FRESH, stake: 5n * PULSE_TOKEN_SCALE });
  assert.ok(ticket);
  assert.equal(ticket.quantity, 10n * PULSE_TOKEN_SCALE);
  assert.equal(ticket.gross, 5n * PULSE_TOKEN_SCALE);
  assert.equal(ticket.fee, 50_000n); // 1% of 5.00
  assert.equal(ticket.cost, 5_050_000n);
  assert.equal(ticket.payout, 10n * PULSE_TOKEN_SCALE);
  assert.equal(ticket.profit, 4_950_000n);
  assert.equal(ticket.capped, false);
});

test("the quote and the fee round up exactly as the program does", () => {
  // 1 base unit of contracts at 500000 micro is half a base unit of quote, which the program ceils.
  assert.equal(pulseQuote(1n, 500_000n), 1n);
  assert.equal(pulseQuote(2n, 500_000n), 1n);
  assert.equal(pulseQuote(3n, 500_000n), 2n);
  // A one base unit quote at 1% is a hundredth of a unit, also ceiled.
  assert.equal(pulseFee(1n, 100), 1n);
  assert.equal(pulseFee(0n, 100), 0n);
  assert.equal(pulseFee(1_000n, 0), 0n);
});

test("a stake larger than the offer is cut to what can actually be filled", () => {
  // A small untouched order. `originalQuantity` has to move with `remainingQuantity`, or the offer
  // describes an order that filled 47 contracts and collected nothing for them.
  const thin: PulseOffer = {
    ...FRESH,
    originalQuantity: String(3n * PULSE_TOKEN_SCALE),
    remainingQuantity: String(3n * PULSE_TOKEN_SCALE),
  };
  const ticket = priceMetalPulseTicket({ offer: thin, stake: 25n * PULSE_TOKEN_SCALE });
  assert.ok(ticket);
  assert.equal(ticket.capped, true);
  assert.equal(ticket.quantity, 3n * PULSE_TOKEN_SCALE);
  // Cost follows the cut quantity, so the bettor is never quoted more than the book can deliver.
  assert.equal(ticket.gross, 1_500_000n);
  assert.equal(ticket.cost, 1_515_000n);
});

test("cost never exceeds the stake the bettor chose", () => {
  // An awkward price where the stake does not divide evenly into contracts.
  const odd: PulseOffer = { ...FRESH, priceMicroUsdc: "333333", feeBps: 0 };
  for (const units of [1n, 5n, 10n, 25n]) {
    const ticket = priceMetalPulseTicket({ offer: odd, stake: units * PULSE_TOKEN_SCALE });
    assert.ok(ticket);
    assert.ok(
      ticket.gross <= units * PULSE_TOKEN_SCALE,
      `gross ${ticket.gross} exceeded the ${units} unit stake`,
    );
  }
});

test("a partially filled order is priced on the program's delta, not on this fill alone", () => {
  // Half the order is gone: 25 contracts filled, 12.50 quote and 0.125 fee already taken.
  const partial: PulseOffer = {
    ...FRESH,
    remainingQuantity: String(25n * PULSE_TOKEN_SCALE),
    quoteFilled: "12500000",
    feePaid: "125000",
  };
  const ticket = priceMetalPulseTicket({ offer: partial, stake: 5n * PULSE_TOKEN_SCALE });
  assert.ok(ticket);
  assert.equal(ticket.quantity, 10n * PULSE_TOKEN_SCALE);
  // quote_after(35 contracts) = 17.50, less 12.50 already collected.
  assert.equal(ticket.gross, 5n * PULSE_TOKEN_SCALE);
  assert.equal(ticket.fee, 50_000n);
});

test("an exhausted or free offer prices to nothing rather than to a zero contract ticket", () => {
  assert.equal(priceMetalPulseTicket({ offer: { ...FRESH, remainingQuantity: "0" }, stake: PULSE_TOKEN_SCALE }), null);
  assert.equal(priceMetalPulseTicket({ offer: { ...FRESH, priceMicroUsdc: "0" }, stake: PULSE_TOKEN_SCALE }), null);
  assert.equal(priceMetalPulseTicket({ offer: FRESH, stake: 0n }), null);
  // A stake too small to buy even one base unit of contracts.
  assert.equal(priceMetalPulseTicket({ offer: { ...FRESH, priceMicroUsdc: "999999" }, stake: 0n }), null);
});

test("a winning ticket is always worth more than it cost", () => {
  // The maker quotes both sides at 0.50, so any fee short of 100% leaves a profit. This is the
  // property that has to hold for the screen's "profit if right" to never be a lie.
  for (const price of [100_000n, 250_000n, 500_000n, 750_000n, 900_000n]) {
    for (const feeBps of [0, 30, 100, 250]) {
      const ticket = priceMetalPulseTicket({
        offer: { ...FRESH, priceMicroUsdc: String(price), feeBps },
        stake: 10n * PULSE_TOKEN_SCALE,
      });
      assert.ok(ticket);
      assert.ok(ticket.profit > 0n, `price ${price} at ${feeBps}bps produced profit ${ticket.profit}`);
      assert.equal(ticket.cost, ticket.gross + ticket.fee);
      assert.equal(ticket.profit, ticket.payout - ticket.cost);
    }
  }
});

test("amounts format without a float round trip", () => {
  assert.equal(formatPulseAmount(5_050_000n), "5.05");
  assert.equal(formatPulseAmount(10n * PULSE_TOKEN_SCALE), "10.00");
  assert.equal(formatPulseAmount(1n), "0.00");
  assert.equal(formatPulseAmount(-2_500_000n), "−2.50");
  assert.equal(formatPulseAmount(999_999_999_999n), "999999.99");
});

test("a displayed cost never understates the real debit", () => {
  // The live exchange charges 25bps, so a five unit bet costs 5.0125. Rounding that down to 5.01
  // would have the screen quote less than the wallet is about to be asked for.
  const ticket = priceMetalPulseTicket({
    offer: { ...FRESH, feeBps: 25 },
    stake: 5n * PULSE_TOKEN_SCALE,
  });
  assert.ok(ticket);
  assert.equal(ticket.fee, 12_500n);
  assert.equal(ticket.cost, 5_012_500n);
  assert.equal(formatPulseAmount(ticket.cost, 2, "up"), "5.02");
  assert.equal(formatPulseExact(ticket.cost), "5.0125");
  // An amount already on the boundary must not be nudged to the next cent.
  assert.equal(formatPulseAmount(5_010_000n, 2, "up"), "5.01");
  assert.equal(formatPulseAmount(0n, 2, "up"), "0.00");
});

test("rounding up is never below, and rounding down never above, the true amount", () => {
  for (const value of [1n, 9_999n, 10_000n, 10_001n, 5_012_500n, 999_999n, 1_000_001n]) {
    const up = Number(formatPulseAmount(value, 2, "up"));
    const down = Number(formatPulseAmount(value, 2, "down"));
    const exact = Number(value) / 1_000_000;
    assert.ok(up >= exact, `${value} rounded up to ${up}, below ${exact}`);
    assert.ok(down <= exact, `${value} rounded down to ${down}, above ${exact}`);
  }
});

test("exact formatting trims trailing zeros but keeps every significant base unit", () => {
  assert.equal(formatPulseExact(5_012_500n), "5.0125");
  assert.equal(formatPulseExact(10n * PULSE_TOKEN_SCALE), "10");
  assert.equal(formatPulseExact(1n), "0.000001");
  assert.equal(formatPulseExact(0n), "0");
  assert.equal(formatPulseExact(-12_500n), "−0.0125");
});
