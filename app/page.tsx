import { MeshFeed } from "@/components/MeshFeed";
import { NumbersPanel } from "@/components/NumbersPanel";
import { BehaviorTimeline } from "@/components/BehaviorTimeline";
import { PaperTradingCard } from "@/components/PaperTradingCard";

export default function Page() {
  return (
    <main className="min-h-screen p-6 max-w-7xl mx-auto space-y-4 w-full">
      <header className="flex items-baseline justify-between mb-4">
        <h1 className="text-2xl font-semibold">Hedgents</h1>
        <div className="text-xs opacity-60">Local operator dashboard · localhost:7700</div>
      </header>
      <NumbersPanel />
      <PaperTradingCard />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <MeshFeed />
        </div>
        <div>
          <BehaviorTimeline />
        </div>
      </div>
    </main>
  );
}
