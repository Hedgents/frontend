import { DaemonHealth } from "@/lib/api";
import { cn } from "@/lib/utils";

const STATUS_BG: Record<string, string> = {
  green: "bg-emerald-500",
  yellow: "bg-amber-500",
  red: "bg-red-500",
  unknown: "bg-slate-400",
};

function formatAge(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / 3_600_000)}h`;
}

export function DaemonPill({ daemon }: { daemon: DaemonHealth }) {
  return (
    <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-xs">
      <div className={cn("w-2 h-2 rounded-full", STATUS_BG[daemon.status] ?? STATUS_BG.unknown)} />
      <span className="font-medium">{daemon.role.replace("_", "-")}</span>
      {daemon.last_heartbeat_ms_ago !== null && (
        <span className="opacity-50">{formatAge(daemon.last_heartbeat_ms_ago)}</span>
      )}
    </div>
  );
}
