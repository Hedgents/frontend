import { MetalTerminal, type TerminalView } from "@/components/MetalTerminal";
import type { ScarcityMarket } from "@/components/ScarcityExchange";
import { loadScarcityMarketCatalog } from "@/lib/scarcity-market-store";
import { METAL_MARKET_NAMESPACE_BY_ID } from "@/lib/scarcity";
import { getPublicExecutionControls } from "@/lib/execution-controls";
import { getPublicTerminalFeatures } from "@/lib/terminal-feature-controls";
import { compileCurveMarket } from "@/lib/scarcity-curves";
import { compileLithiumRound, LITHIUM_ROUNDS } from "@/lib/scarcity/lithium-market";
import { loadScarcityDeployment } from "@/lib/scarcity-deployment";

const terminalViews = new Set<TerminalView>(["markets", "scarcity", "portfolio", "orders"]);

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ view?: string | string[] }>;
}) {
  const [catalog, resolvedSearchParams] = await Promise.all([
    loadScarcityMarketCatalog(),
    searchParams,
  ]);
  const scarcityMarkets: ScarcityMarket[] = catalog.map((market) => {
    const curve = compileCurveMarket(market);
    return {
      slug: market.question.slug,
      marketId: market.marketId,
      questionHash: market.questionHash,
      rulesHash: market.rulesHash,
      canonicalQuestion: market.canonicalQuestion,
      canonicalRules: market.canonicalRules,
      title: market.question.title,
      question: market.question.question,
      metal: market.question.metal,
      marketKind: market.question.kind === "event" ? "event" : "data",
      category: market.question.kind === "event"
        ? METAL_MARKET_NAMESPACE_BY_ID[market.question.metal.id]?.primaryCategory ?? "science"
        : "price-data",
      resolutionTarget: market.question.kind === "event"
        ? { kind: "event", ...market.question.event }
        : { kind: "data", ...market.question.observation },
      sources: market.question.sources,
      schedule: market.rules.schedule,
      lifecycle: market.lifecycle,
      publication: market.publication,
      warning: market.warning,
      curve: curve ? {
        slug: curve.slug,
        marketId: curve.marketId,
        metricHash: curve.metricHash,
        rulesHash: curve.rulesHash,
        canonicalMetric: curve.canonicalMetric,
        canonicalRules: curve.canonicalRules,
        title: curve.metric.title,
        metric: curve.metric.metric,
        displayRange: curve.metric.displayRange,
        bucketCount: curve.rules.engine.bucketCount,
        targetJackpotBps: curve.rules.engine.targetJackpotBps,
        jackpotLeverageCap: curve.rules.engine.jackpotLeverageCap,
      } : null,
    };
  });

  // Lithium rounds are not catalog records, so mapping the catalog alone left the one market that
  // is actually deployed out of the list entirely while listing ninety-nine specifications that are
  // not. Append them, then sort deployed markets to the front so the live one leads.
  const deployment = await loadScarcityDeployment().catch(() => null);
  const deployedCurveSlugs = new Set(Object.keys(deployment?.curveMarkets ?? {}));
  for (const round of Object.values(LITHIUM_ROUNDS)) {
    const compiled = compileLithiumRound(round);
    scarcityMarkets.push({
      slug: compiled.slug,
      marketId: compiled.marketId,
      questionHash: compiled.metricHash,
      rulesHash: compiled.rulesHash,
      canonicalQuestion: compiled.canonicalMetric,
      canonicalRules: compiled.canonicalRules,
      title: compiled.metric.title,
      question: `Where will the ${compiled.metric.metric.label} settle on ${round.observedAt.slice(0, 10)}?`,
      metal: compiled.metric.metal,
      marketKind: "data",
      category: "price-data",
      resolutionTarget: {
        kind: "curve",
        metricId: compiled.metric.metric.id,
        metricLabel: compiled.metric.metric.label,
        methodologyVersion: compiled.metric.metric.methodologyVersion,
        unit: compiled.metric.metric.unit,
        observedAt: compiled.metric.metric.observedAt,
        precision: compiled.metric.metric.precision,
      },
      sources: compiled.metric.sources,
      schedule: compiled.rules.schedule,
      lifecycle: "production",
      publication: "verified",
      warning: null,
      curve: {
        slug: compiled.slug,
        marketId: compiled.marketId,
        metricHash: compiled.metricHash,
        rulesHash: compiled.rulesHash,
        canonicalMetric: compiled.canonicalMetric,
        canonicalRules: compiled.canonicalRules,
        title: compiled.metric.title,
        metric: compiled.metric.metric,
        displayRange: compiled.metric.displayRange,
        bucketCount: compiled.rules.engine.bucketCount,
        targetJackpotBps: compiled.rules.engine.targetJackpotBps,
        jackpotLeverageCap: compiled.rules.engine.jackpotLeverageCap,
      },
    });
  }
  scarcityMarkets.sort((left, right) => {
    const leftDeployed = left.curve && deployedCurveSlugs.has(left.curve.slug) ? 0 : 1;
    const rightDeployed = right.curve && deployedCurveSlugs.has(right.curve.slug) ? 0 : 1;
    return leftDeployed - rightDeployed;
  });

  const requestedView = resolvedSearchParams.view;
  const view = typeof requestedView === "string" && terminalViews.has(requestedView as TerminalView)
    ? (requestedView as TerminalView)
    : "markets";
  return (
    <MetalTerminal
      scarcityMarkets={scarcityMarkets}
      initialView={view}
      executionControl={getPublicExecutionControls()}
      terminalFeatures={getPublicTerminalFeatures()}
    />
  );
}
