"use client";

import { useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { API_BASE } from "@/lib/api";

const AUTOPLAY_KEY = "hedgents:briefing_autoplay";
const TICK_MS = 60 * 60 * 1000;

interface PaperStrategy {
  name: string;
  net_apr_bps: number;
}
interface PaperResponse {
  strategies: PaperStrategy[];
  portfolio: { annualised_apy_pct: number };
}

async function fetchScript(): Promise<string> {
  const r = await fetch(`${API_BASE}/paper`);
  if (!r.ok) throw new Error(`paper ${r.status}`);
  const d: PaperResponse = await r.json();
  const portfolio = d.portfolio.annualised_apy_pct.toFixed(1);
  const sy  = d.strategies.find((s) => s.name === "Stable Yield")?.net_apr_bps;
  const m   = d.strategies.find((s) => s.name === "Multiply")?.net_apr_bps;
  const hjl = d.strategies.find((s) => s.name === "Hedged JLP")?.net_apr_bps;
  const fmt = (bps: number | undefined) => bps !== undefined ? (bps / 100).toFixed(1) : "—";
  return (
    `Hour briefing. Portfolio at ${portfolio} percent blended APY. ` +
    `Stable yield ${fmt(sy)}, multiply ${fmt(m)}, hedged JLP ${fmt(hjl)}. ` +
    `All five daemons operating normally on Solana mainnet.`
  );
}

export function HourlyBriefing() {
  const [autoplay, setAutoplay] = useState<boolean>(false);
  const [script, setScript] = useState<string>("Loading current portfolio state…");
  const [lastPlayed, setLastPlayed] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "playing" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const stored = typeof window !== "undefined" ? localStorage.getItem(AUTOPLAY_KEY) : null;
    if (stored === "1") setAutoplay(true);
    fetchScript().then(setScript).catch(() => {});
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(AUTOPLAY_KEY, autoplay ? "1" : "0");
    }
  }, [autoplay]);

  const playNow = async () => {
    setStatus("loading");
    setError(null);
    try {
      const text = await fetchScript();
      setScript(text);
      const url = `${API_BASE}/tts?text=${encodeURIComponent(text)}`;
      if (audioRef.current) {
        audioRef.current.src = url;
        await audioRef.current.play();
        setStatus("playing");
        setLastPlayed(new Date().toLocaleTimeString());
      }
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : "voice generation failed");
    }
  };

  useEffect(() => {
    if (!autoplay) return;
    const id = setInterval(() => {
      playNow().catch(() => {});
    }, TICK_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoplay]);

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-wide opacity-60">Hourly Briefing</div>
            <div className="text-[10px] opacity-40 mt-0.5">Voice powered by ElevenLabs</div>
          </div>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={autoplay}
              onChange={(e) => setAutoplay(e.target.checked)}
              className="accent-cyan-500"
            />
            Auto-play hourly
          </label>
        </div>

        <div className="mt-3 text-sm opacity-80 italic leading-relaxed">{script}</div>

        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={playNow}
            disabled={status === "loading"}
            className="text-xs px-3 py-1.5 rounded border border-current opacity-80 hover:opacity-100 disabled:opacity-40"
          >
            {status === "loading" ? "Generating…" : status === "playing" ? "▶ Playing" : "Play now"}
          </button>
          {lastPlayed ? (
            <span className="text-[10px] opacity-50">Last played at {lastPlayed}</span>
          ) : (
            <span className="text-[10px] opacity-40">Not played yet</span>
          )}
          {status === "error" ? (
            <span className="text-[10px] text-amber-500">
              {error ?? "voice unavailable — set ELEVENLABS_API_KEY"}
            </span>
          ) : null}
        </div>

        <audio
          ref={audioRef}
          onEnded={() => setStatus("idle")}
          onError={() => setStatus("error")}
          className="hidden"
        />
      </CardContent>
    </Card>
  );
}
