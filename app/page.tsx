import { MeshFeed } from "@/components/MeshFeed";
import { NumbersPanel } from "@/components/NumbersPanel";
import { AprHistoryChart } from "@/components/AprHistoryChart";
import { StrategyCardsRow } from "@/components/StrategyCardsRow";
import { BenchmarkComparisonBar } from "@/components/BenchmarkComparisonBar";
import { OnchainActivityRail } from "@/components/OnchainActivityRail";
import { RecentShipsCard } from "@/components/RecentShipsCard";
import { OrchestratorCard } from "@/components/OrchestratorCard";
import { LifetimeBanner } from "@/components/LifetimeBanner";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 pt-2">
      <span className="text-[10px] uppercase tracking-[0.2em] font-medium opacity-50">
        {children}
      </span>
      <div className="flex-1 h-px bg-gradient-to-r from-current/10 to-transparent opacity-30" />
    </div>
  );
}

export default function Page() {
  return (
    <main className="min-h-screen p-6 max-w-7xl mx-auto space-y-5 w-full">
      <LifetimeBanner />

      <SectionLabel>Treasury</SectionLabel>
      <NumbersPanel />

      <SectionLabel>Strategies</SectionLabel>
      <StrategyCardsRow />
      <BenchmarkComparisonBar />

      <SectionLabel>Allocator</SectionLabel>
      <OrchestratorCard />

      <SectionLabel>Activity</SectionLabel>
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
