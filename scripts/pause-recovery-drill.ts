/**
 * G7: rehearse the emergency pause, and prove recovery survives it.
 *
 *   npx tsx --conditions=react-server scripts/pause-recovery-drill.ts
 *
 * Two properties, and the second is the one that matters. Pausing has to stop new orders, obviously.
 * But it must NOT strand anyone already mid-flight: a taker whose transaction was submitted and
 * whose outcome is unknown still needs to learn what happened to their money. If the pause took
 * recovery down with it, the safest-looking action an operator can take would be the one that
 * abandons whoever is holding an unresolved position.
 *
 * The drill uses a real settled mainnet transaction rather than a fixture, so it exercises the
 * actual RPC path, the real claim shape, and a signature that genuinely landed.
 *
 * HEDGENTS_DRILL_BASE_URL points at the server under test. The server must be started with the
 * same HEDGENTS_AUTH_SECRET and HEDGENTS_ORDER_SIGNING_SECRET as this script, since the drill
 * mints its own session cookie and its own recovery receipt.
 */
import { createAccessSession, ADMIN_COOKIE } from "@/lib/access-auth";
import { createRecoveryAuthorization } from "@/lib/execution-authorization";
import { getSolanaExecutionProduct, getSolanaSettlementAsset } from "@/lib/product-registry";

const BASE = process.env.HEDGENTS_DRILL_BASE_URL?.trim() || "http://127.0.0.1:3111";

/** G6's buy: 10.00 USDC into PAXG, settled on mainnet at slot 439037345. */
const SIGNATURE =
  "2Y9kfgRhdmfnSGmPtGDT43XCao7dW4PPstW3cZPPkc42aB5yhG8AnGm4eFfH8q4SiYEvLFAC4jP8Hm82VbWqMCjw";
const TAKER = "7RTAnEokPmzycm5q3cwWZV9VXGv6KV3g8LEsfgeyJ7RK";
const MINIMUM_OUTPUT = "2259";

// Read the mints from the registry rather than transcribing them. Hand-copied base58 is exactly
// how this session already lost an hour twice.
const product = getSolanaExecutionProduct("gold-paxg");
const settlementAsset = getSolanaSettlementAsset("usdc");
if (!product || !settlementAsset) throw new Error("gold-paxg / usdc are not registered.");

const CLAIMS = {
  requestId: "g7-drill",
  productId: product.productId,
  side: "buy" as const,
  settlementAssetId: settlementAsset.id,
  taker: TAKER,
  inputMint: settlementAsset.mint,
  outputMint: product.mint,
  inputAmount: "10000000",
  minimumOutputAmount: MINIMUM_OUTPUT,
  transactionMessageDigest: "0".repeat(64),
  lastValidBlockHeight: null,
  eligibilityCountryCode: "XX",
  eligibilityPolicyId: product.eligibilityPolicyId,
  expiresAt: Date.now() + 60_000,
};

interface Step {
  name: string;
  expected: string;
  actual: string;
  pass: boolean;
}
const steps: Step[] = [];

function record(name: string, expected: string, actual: string, pass: boolean) {
  steps.push({ name, expected, actual, pass });
  process.stderr.write(
    `  ${pass ? "PASS" : "FAIL"}  ${name}\n        want ${expected}\n        got  ${actual}\n`,
  );
}

const session = createAccessSession("admin", 3_600);

async function post(path: string, body: unknown) {
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `${ADMIN_COOKIE}=${session}`,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(text) as Record<string, unknown>;
  } catch {
    payload = { error: text.slice(0, 200) };
  }
  return { status: response.status, payload };
}

async function main() {
  const paused = process.env.HEDGENTS_EXECUTION_ENABLED?.trim().toLowerCase() === "false";
  process.stderr.write(
    `\nG7 drill against ${BASE}\n  execution enabled: ${process.env.HEDGENTS_EXECUTION_ENABLED ?? "(unset)"}\n\n`,
  );

  // 1. New orders stop while paused, and are reachable when not.
  const order = await post("/api/execution/order", {
    productId: "gold-paxg",
    side: "buy",
    amountUsd: "10",
    taker: TAKER,
    settlementAssetId: "usdc",
    eligibility: { legalAge: true, acceptsIssuerTerms: true, notRestrictedPerson: true },
  });
  const orderMessage = String(order.payload.error ?? "");
  const refusedForPause = /paused by the operator/i.test(orderMessage);
  if (paused) {
    record(
      "new orders refused while paused",
      "503, refused for the operator pause",
      `${order.status} ${orderMessage.slice(0, 80)}`,
      order.status === 503 && refusedForPause,
    );
  } else {
    record(
      "orders are not pause-refused when live",
      "anything but the pause message",
      `${order.status} ${orderMessage.slice(0, 80) || "(quote returned)"}`,
      !refusedForPause,
    );
  }

  // 2. Recovery answers regardless. This is the property the pause must not break.
  const recoveryAuthorization = createRecoveryAuthorization(CLAIMS as never);
  const recovery = await post("/api/execution/status", {
    signature: SIGNATURE,
    recoveryAuthorization,
  });
  const settlement = recovery.payload.settlement as Record<string, unknown> | undefined;
  const received = String(settlement?.receivedAmount ?? "0");
  record(
    "a real settled receipt still recovers",
    `200 Success, verified, received >= ${MINIMUM_OUTPUT}`,
    `${recovery.status} ${String(recovery.payload.status ?? recovery.payload.error ?? "")}`
      + ` settlement=${String(settlement?.status ?? "-")} received=${received}`,
    recovery.status === 200
      && recovery.payload.status === "Success"
      && settlement?.status === "verified"
      && /^\d+$/.test(received)
      && BigInt(received) >= BigInt(MINIMUM_OUTPUT),
  );

  // 3. A tampered receipt is refused, or the route is an open settlement oracle for any signature.
  const forged = await post("/api/execution/status", {
    signature: SIGNATURE,
    recoveryAuthorization: `${recoveryAuthorization.slice(0, -6)}AAAAAA`,
  });
  record(
    "a tampered recovery receipt is refused",
    "4xx",
    `${forged.status} ${String(forged.payload.error ?? "").slice(0, 70)}`,
    forged.status >= 400 && forged.status < 500,
  );

  const failed = steps.filter((step) => !step.pass);
  process.stderr.write(`\n  ${steps.length - failed.length}/${steps.length} passed\n\n`);
  console.log(
    JSON.stringify(
      { baseUrl: BASE, paused, steps, verdict: failed.length === 0 ? "passed" : "FAILED" },
      null,
      2,
    ),
  );
  if (failed.length) process.exitCode = 1;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
