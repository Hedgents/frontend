"use client";

import { useEffect, useMemo, useState } from "react";
import { address } from "@solana/kit";
import {
  useConnect as useSolanaConnect,
  useConnectedWallet,
  useDisconnect as useSolanaDisconnect,
  useWallets,
} from "@solana/kit-plugin-wallet/react";
import { useClient } from "@solana/react";
import type { AppSolanaClient } from "@/app/providers";
import { ScarcityWalletTransaction } from "@/components/ScarcityWalletActions";
import { getCreateMarketInstruction, getInitializeConfigInstruction, getResolveMarketInstruction } from "@/lib/scarcity-exchange/instructions";
import type { ScarcityQuestionDocument, ScarcityRulesDocument } from "@/lib/scarcity-markets";
import styles from "./admin.module.css";

type AdminMarket = {
  slug: string;
  title: string;
  metal: { symbol: string; name: string };
  marketId: string;
  questionHash: string;
  rulesHash: string;
  question: ScarcityQuestionDocument;
  rules: ScarcityRulesDocument;
};

type PreparedResult = {
  prepared?: boolean;
  persisted?: boolean;
  submitted?: boolean;
  warning?: string;
  addresses?: { market: string; yesMint: string; noMint: string; vault: string };
  error?: string;
};

type OperatorConfig = {
  cluster: "devnet" | "mainnet-beta";
  programAddress: string;
  admin: string;
  collateralMint: string;
  feeRecipient: string;
  resolver: string;
  tradingFeeBps: number;
  governance?: {
    authorityModel: "multisig";
    minimumApprovals: number;
    manualChallengeWindowHours: number;
    auditReportUrl: string;
    disputePolicyUrl: string;
    incidentResponseUrl: string;
  };
};

type PublishedResolution = {
  marketId: string;
  outcome: "yes" | "no" | "invalid";
  resolutionReportHash: string;
  evidencePath: string;
  persisted: boolean;
};

function short(value: string) {
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

function assertReviewedSigner(actual: string, expected: string, role: string) {
  if (actual !== expected) throw new Error(`Connected wallet is not the reviewed ${role}.`);
}

function operatorDate(value: string) {
  const date = new Date(value);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[date.getUTCMonth()]} ${String(date.getUTCDate()).padStart(2, "0")}, ${date.getUTCFullYear()} · ${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")} UTC`;
}

function operatorQuestion(value: string) {
  return value.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z/g, (date) => operatorDate(date));
}

function hexToBytes(value: string) {
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error("Expected a 32-byte hexadecimal value.");
  return Uint8Array.from({ length: 32 }, (_, index) => Number.parseInt(value.slice(index * 2, index * 2 + 2), 16));
}

async function readApiPayload<T extends { error?: string }>(response: Response, fallback: string): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new Error(response.status === 404
      ? `${fallback} endpoint is unavailable. Restart the terminal server and try again.`
      : `${fallback} returned HTTP ${response.status}.`);
  }
  return await response.json() as T;
}

export function ScarcityMarketManager({ markets, operator, durableStorage }: { markets: AdminMarket[]; operator: OperatorConfig | null; durableStorage: boolean }) {
  const solanaClient = useClient<AppSolanaClient>();
  const wallets = useWallets(solanaClient);
  const connected = useConnectedWallet(solanaClient);
  const connect = useSolanaConnect(solanaClient);
  const disconnect = useSolanaDisconnect(solanaClient);
  const [selectedSlug, setSelectedSlug] = useState(markets[0]?.slug ?? "");
  const [hydrated, setHydrated] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [result, setResult] = useState<PreparedResult | null>(null);
  const [walletsOpen, setWalletsOpen] = useState(false);
  const [operatorNotice, setOperatorNotice] = useState<string | null>(null);
  const [resolutionText, setResolutionText] = useState("");
  const [publishingResolution, setPublishingResolution] = useState(false);
  const [resolutionError, setResolutionError] = useState<string | null>(null);
  const [publishedResolution, setPublishedResolution] = useState<PublishedResolution | null>(null);
  const [marketSearch, setMarketSearch] = useState("");
  const selected = markets.find((market) => market.slug === selectedSlug) ?? markets[0];
  const filteredMarkets = useMemo(() => {
    const query = marketSearch.trim().toLocaleLowerCase();
    if (!query) return markets;
    return markets.filter((market) => [
      market.metal.symbol,
      market.metal.name,
      market.title,
      market.question.question,
    ].some((value) => value.toLocaleLowerCase().includes(query)));
  }, [marketSearch, markets]);
  const visibleMarkets = filteredMarkets.slice(0, 12);

  useEffect(() => setHydrated(true), []);

  async function prepare() {
    if (!selected) return;
    setPreparing(true);
    setResult(null);
    try {
      const response = await fetch("/api/admin/scarcity/markets/prepare", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: selected.question, rules: selected.rules }),
      });
      const payload = await readApiPayload<PreparedResult>(response, "Market preparation");
      if (!response.ok) throw new Error(payload.error ?? "Market preparation failed.");
      setResult(payload);
    } catch (error) {
      setResult({ error: error instanceof Error ? error.message : "Market preparation failed." });
    } finally {
      setPreparing(false);
    }
  }

  async function publishResolution() {
    setPublishingResolution(true);
    setResolutionError(null);
    setPublishedResolution(null);
    try {
      const report = JSON.parse(resolutionText) as unknown;
      const response = await fetch("/api/admin/scarcity/markets/resolve/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ report }),
      });
      const payload = await readApiPayload<PublishedResolution & { error?: string }>(response, "Resolution evidence publication");
      if (!response.ok) throw new Error(payload.error ?? "Resolution evidence could not be published.");
      if (payload.marketId !== selected.marketId) throw new Error("Published report belongs to a different selected market.");
      setPublishedResolution(payload);
    } catch (error) {
      setResolutionError(error instanceof Error ? error.message : "Resolution evidence could not be published.");
    } finally {
      setPublishingResolution(false);
    }
  }

  if (!selected) return null;
  return (
    <section className={styles.scarcityPanel} aria-labelledby="scarcity-manager-title" id="scarcity-markets">
      <div className={styles.scarcityHeader}>
        <div>
          <p className={styles.kicker}>SCX / market control</p>
          <h2 id="scarcity-manager-title">Scarcity exchange</h2>
          <p>Compile immutable contracts, derive Solana accounts, publish resolution evidence, and submit wallet-signed operator transactions.</p>
        </div>
        <a href="/scarcity">Open exchange</a>
      </div>
      <div className={styles.readinessChecklist} aria-label="Operator readiness checklist">
        <div className={styles.readinessReady}><i /> <span>Catalog compiled</span><strong>{markets.length} contracts</strong></div>
        <div className={durableStorage ? styles.readinessReady : styles.readinessBlocked}><i /> <span>Evidence storage</span><strong>{durableStorage ? "Ready" : "Required"}</strong></div>
        <div className={operator ? styles.readinessReady : styles.readinessBlocked}><i /> <span>Operator manifest</span><strong>{operator ? "Configured" : "Required"}</strong></div>
        <div className={operator?.cluster === "mainnet-beta" && !operator.governance ? styles.readinessBlocked : operator?.governance ? styles.readinessReady : styles.readinessPending}><i /> <span>Authority safeguards</span><strong>{operator?.governance ? `${operator.governance.minimumApprovals} approvals · ${operator.governance.manualChallengeWindowHours}h` : operator?.cluster === "mainnet-beta" ? "Required" : "Mainnet gate"}</strong></div>
        <div className={connected ? styles.readinessReady : styles.readinessPending}><i /> <span>Signing wallet</span><strong>{connected ? "Connected" : operator ? "Not connected" : "Locked"}</strong></div>
      </div>
      <div className={styles.operatorBar}>
        <div>
          <span>Operator signing</span>
          <strong>{operator ? `${operator.cluster} · ${short(operator.programAddress)}` : "Not configured"}</strong>
          <small>{operator ? `Collateral ${short(operator.collateralMint)} · fee ${(operator.tradingFeeBps / 100).toFixed(2)}%` : "Add HEDGENTS_SCARCITY_OPERATOR_JSON before any onchain action can be prepared."}</small>
        </div>
        {operator && connected ? <div className={styles.operatorWallet}>
          <span>{connected.wallet.name} · {short(connected.account.address)}</span>
          <button type="button" onClick={() => disconnect.dispatch()}>Disconnect</button>
        </div> : operator ? <button type="button" onClick={() => setWalletsOpen((value) => !value)}>Connect Solana wallet</button> : <span className={styles.operatorBlocked}>Configure manifest before connecting</span>}
      </div>
      {operator && walletsOpen && !connected ? <div className={styles.operatorWalletList}>
        {wallets.length ? wallets.map((wallet) => <button type="button" key={wallet.name} onClick={() => { connect.dispatch(wallet); setWalletsOpen(false); }}>{wallet.name}</button>) : <span>No Wallet Standard wallet found.</span>}
      </div> : null}
      {operator ? <div className={styles.protocolInitialization}>
        <div><strong>One-time protocol configuration</strong><span>Only use this if the config PDA does not exist. The connected wallet becomes protocol admin; resolver and fee settings come from the reviewed operator manifest.</span></div>
        <ScarcityWalletTransaction
          cluster={operator.cluster}
          label="Initialize protocol"
          onConnect={() => setWalletsOpen(true)}
          onConfirmed={(signature) => setOperatorNotice(`Protocol configuration confirmed: ${signature}`)}
          build={async (admin) => {
            assertReviewedSigner(String(admin), operator.admin, "protocol admin");
            return [await getInitializeConfigInstruction({
              admin,
              resolver: address(operator.resolver),
              collateralMint: address(operator.collateralMint),
              feeRecipient: address(operator.feeRecipient),
              tradingFeeBps: operator.tradingFeeBps,
            })];
          }}
        />
      </div> : null}
      {operatorNotice ? <p className={styles.operatorNotice} role="status">{operatorNotice}</p> : null}
      <div className={styles.scarcityControl}>
        <aside className={styles.marketCatalog} aria-label="Scarcity contract catalog">
          <header><span>Contract catalog</span><strong>{markets.length}</strong></header>
          <label className={styles.marketSearch}>
            <span>Find by metal or question</span>
            <input
              type="search"
              value={marketSearch}
              onChange={(event) => setMarketSearch(event.target.value)}
              placeholder="Gold, Au, supply…"
              autoComplete="off"
            />
          </label>
          <div className={styles.selectedMarketSummary}>
            <i>{selected.metal.symbol}</i>
            <span><small>Selected contract</small><strong>{selected.metal.name}</strong><em>{selected.title}</em></span>
            <a href="#selected-market-review">Review →</a>
          </div>
          <div className={styles.marketSelector} aria-label="Filtered market contracts">
            {visibleMarkets.map((market) => (
              <button
                type="button"
                key={market.slug}
                aria-pressed={selected.slug === market.slug}
                className={selected.slug === market.slug ? styles.marketSelected : undefined}
                onClick={() => { setSelectedSlug(market.slug); setResult(null); setPublishedResolution(null); setResolutionError(null); }}
              >
                <i>{market.metal.symbol}</i>
                <span><strong>{market.metal.name}</strong><small>{market.title}</small></span>
              </button>
            ))}
            {!visibleMarkets.length ? <p className={styles.marketSelectorEmpty}>No contract matches “{marketSearch.trim()}”.</p> : null}
          </div>
          <footer aria-live="polite">Showing {visibleMarkets.length} of {filteredMarkets.length} matches{filteredMarkets.length > visibleMarkets.length ? " · refine the search to reach the rest" : ""}</footer>
        </aside>
        <div className={styles.marketPreparation} id="selected-market-review">
          <header><span>Research contract</span><em>Not deployed</em></header>
          <h3>{selected.title}</h3>
          <p className={styles.marketQuestion}>{operatorQuestion(selected.question.question)}</p>
          <dl>
            <div><dt>Market ID</dt><dd>{short(selected.marketId)}</dd></div>
            <div><dt>Question hash</dt><dd>{short(selected.questionHash)}</dd></div>
            <div><dt>Rules hash</dt><dd>{short(selected.rulesHash)}</dd></div>
            <div><dt>Resolve after</dt><dd><time dateTime={selected.rules.schedule.resolveAfter} title={selected.rules.schedule.resolveAfter}>{operatorDate(selected.rules.schedule.resolveAfter)}</time></dd></div>
          </dl>
          <div className={styles.preparationActions}>
            <button type="button" onClick={() => void prepare()} disabled={preparing || !hydrated}>
              {preparing ? "Checking…" : "Validate + derive accounts"}
            </button>
            {operator ? <ScarcityWalletTransaction
              cluster={operator.cluster}
              label="Create market"
              onConnect={() => setWalletsOpen(true)}
              onConfirmed={(signature) => setOperatorNotice(`Market creation confirmed. Add this signature to the deployment manifest: ${signature}`)}
              build={async (admin) => {
                assertReviewedSigner(String(admin), operator.admin, "protocol admin");
                return [await getCreateMarketInstruction({
                  admin,
                  collateralMint: address(operator.collateralMint),
                  marketId: hexToBytes(selected.marketId),
                  questionHash: hexToBytes(selected.questionHash),
                  rulesHash: hexToBytes(selected.rulesHash),
                  opensAt: BigInt(Math.floor(Date.parse(selected.rules.schedule.opensAt) / 1_000)),
                  closesAt: BigInt(Math.floor(Date.parse(selected.rules.schedule.closesAt) / 1_000)),
                  resolveAfter: BigInt(Math.floor(Date.parse(selected.rules.schedule.resolveAfter) / 1_000)),
                })];
              }}
            /> : <button type="button" disabled>Operator manifest required</button>}
            <button type="button" disabled>Evidence required before resolution</button>
          </div>
          {result?.error ? <p className={styles.inviteError} role="alert">{result.error}</p> : null}
          {result?.prepared && result.addresses ? (
            <div className={styles.preparedResult} role="status">
              <strong>Specification reproduced</strong>
              <span>Market PDA <code>{short(result.addresses.market)}</code></span>
              <span>YES mint <code>{short(result.addresses.yesMint)}</code></span>
              <span>NO mint <code>{short(result.addresses.noMint)}</code></span>
              <span>Vault <code>{short(result.addresses.vault)}</code></span>
              <small>{result.warning}</small>
            </div>
          ) : null}
          <div className={styles.resolutionPanel}>
            <header><span>Resolution evidence</span><em>Publish before signing</em></header>
            <p>Paste the complete canonical report candidate. Hedgents verifies its market commitments, threshold outcome, timestamps, artifact hashes, and source URLs, then stores it by content hash. The resolver transaction is unavailable until persistence succeeds.</p>
            <textarea
              value={resolutionText}
              onChange={(event) => { setResolutionText(event.target.value); setPublishedResolution(null); }}
              placeholder='{"schemaVersion":"1.0.0","marketId":"…","questionHash":"…","rulesHash":"…","outcome":"yes","evaluatedValue":72.4,"evaluation":"…","observations":[…],"generatedAt":"…"}'
              aria-label="Resolution report JSON"
              spellCheck={false}
            />
            <div className={styles.resolutionActions}>
              <button type="button" onClick={() => void publishResolution()} disabled={publishingResolution || resolutionText.trim().length === 0}>
                {publishingResolution ? "Publishing…" : "Validate + publish evidence"}
              </button>
              {operator && publishedResolution?.persisted ? <ScarcityWalletTransaction
                cluster={operator.cluster}
                label={`Resolve ${publishedResolution.outcome.toUpperCase()}`}
                onConnect={() => setWalletsOpen(true)}
                onConfirmed={(signature) => setOperatorNotice(`Resolution confirmed: ${signature}`)}
                build={async (resolver) => {
                  assertReviewedSigner(String(resolver), operator.resolver, "market resolver");
                  return [await getResolveMarketInstruction({
                    resolver,
                    marketId: hexToBytes(selected.marketId),
                    outcome: publishedResolution.outcome,
                    resolutionReportHash: hexToBytes(publishedResolution.resolutionReportHash),
                  })];
                }}
              /> : <button type="button" disabled>Resolve market</button>}
            </div>
            {resolutionError ? <p className={styles.inviteError} role="alert">{resolutionError}</p> : null}
            {publishedResolution ? <div className={styles.publishedResolution} role="status">
              <strong>Evidence persisted</strong>
              <code>{publishedResolution.resolutionReportHash}</code>
              <a href={publishedResolution.evidencePath} target="_blank" rel="noreferrer">Open canonical report</a>
            </div> : null}
          </div>
        </div>
      </div>
    </section>
  );
}
