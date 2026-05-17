import { Card, CardContent } from "@/components/ui/card";
import { SHIPS } from "@/lib/ships";

export const metadata = {
  title: "Devlog · Hedgents",
  description: "Hedgents fleet shipping log — chronological, newest first.",
};

export default function DevlogPage() {
  return (
    <main className="min-h-screen p-6 max-w-4xl mx-auto space-y-4 w-full">
      <div className="space-y-1 mb-6">
        <h1 className="text-2xl font-semibold">Devlog</h1>
        <p className="text-sm opacity-60">
          What has shipped, newest first. Each entry is a tagged release on
          mainnet — the full source-level history lives in{" "}
          <a
            href="https://github.com/Hedgents/fleet/blob/main/DEVLOG.md"
            target="_blank"
            rel="noreferrer"
            className="underline hover:opacity-100 opacity-80"
          >
            DEVLOG.md
          </a>
          .
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <ol className="space-y-4">
            {SHIPS.map((s, idx) => (
              <li
                key={s.version}
                className={`pb-4 ${
                  idx < SHIPS.length - 1
                    ? "border-b border-white/5"
                    : ""
                }`}
              >
                <div className="flex items-baseline gap-3 mb-1">
                  <span className="font-mono tabular-nums text-emerald-600 dark:text-emerald-400 text-sm font-medium">
                    {s.version}
                  </span>
                  <span className="opacity-40 tabular-nums text-[11px]">
                    {s.date}
                  </span>
                </div>
                <div className="text-sm font-medium">{s.headline}</div>
                <div className="text-sm opacity-60 mt-1 leading-relaxed">
                  {s.detail}
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </main>
  );
}
