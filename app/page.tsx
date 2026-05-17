import { MeshFeed } from "@/components/MeshFeed";
import { NumbersPanel } from "@/components/NumbersPanel";
import { AprHistoryChart } from "@/components/AprHistoryChart";
import { StrategyCardsRow } from "@/components/StrategyCardsRow";
import { BenchmarkComparisonBar } from "@/components/BenchmarkComparisonBar";
import { OnchainActivityRail } from "@/components/OnchainActivityRail";
import { RecentShipsCard } from "@/components/RecentShipsCard";
import { OrchestratorCard } from "@/components/OrchestratorCard";

export default function Page() {
  return (
    <main className="min-h-screen p-6 max-w-7xl mx-auto space-y-4 w-full">
      <NumbersPanel />
      <StrategyCardsRow />
      <BenchmarkComparisonBar />
      <OrchestratorCard />
      <RecentShipsCard />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <MeshFeed />
        </div>
        <div>
          <OnchainActivityRail />
        </div>
      </div>
      <AprHistoryChart />
    </main>
  );
}
