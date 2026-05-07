export function colorForMsgType(msg_type: string): {
  bg: string;
  fg: string;
  label: string;
} {
  const families: Record<string, { bg: string; fg: string }> = {
    "Beacon": { bg: "bg-slate-100 dark:bg-slate-800", fg: "text-slate-600 dark:text-slate-400" },
    "Assign": { bg: "bg-purple-50 dark:bg-purple-950/40", fg: "text-purple-700 dark:text-purple-300" },
    "Approve": { bg: "bg-purple-50 dark:bg-purple-950/40", fg: "text-purple-700 dark:text-purple-300" },
    "Withdraw": { bg: "bg-purple-50 dark:bg-purple-950/40", fg: "text-purple-700 dark:text-purple-300" },
    "Report": { bg: "bg-emerald-50 dark:bg-emerald-950/40", fg: "text-emerald-700 dark:text-emerald-300" },
    "Escalate": { bg: "bg-amber-50 dark:bg-amber-950/40", fg: "text-amber-700 dark:text-amber-300" },
    "MarketSignal": { bg: "bg-cyan-50 dark:bg-cyan-950/40", fg: "text-cyan-700 dark:text-cyan-300" },
    "Internal": { bg: "bg-slate-50 dark:bg-slate-900", fg: "text-slate-500 dark:text-slate-500" },
  };
  return { ...(families[msg_type] ?? families["Internal"]), label: msg_type };
}

export function formatTime(ts_ms: number): string {
  const d = new Date(ts_ms);
  return d.toLocaleTimeString("en-US", { hour12: false });
}

export function formatUsdc(amount: number): string {
  return amount.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

export function shortConv(conv: string | null): string | null {
  if (!conv) return null;
  return conv.replace(/[^0-9a-f]/gi, "").slice(0, 8);
}

export function solscanTxUrl(sig: string): string {
  return `https://solscan.io/tx/${sig}`;
}
