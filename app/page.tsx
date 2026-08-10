import { MetalTerminal, type TerminalView } from "@/components/MetalTerminal";
import type { ScarcityMarket } from "@/components/ScarcityExchange";
import { loadScarcityMarketCatalog } from "@/lib/scarcity-market-store";
import { METAL_MARKET_NAMESPACE_BY_ID } from "@/lib/scarcity";
import { getPublicExecutionControls } from "@/lib/execution-controls";
import { compileCurveMarket } from "@/lib/scarcity-curves";

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
  const requestedView = resolvedSearchParams.view;
  const view = typeof requestedView === "string" && terminalViews.has(requestedView as TerminalView)
    ? (requestedView as TerminalView)
    : "markets";
  return (
    <MetalTerminal
      scarcityMarkets={scarcityMarkets}
      initialView={view}
      executionControl={getPublicExecutionControls()}
    />
  );
}
