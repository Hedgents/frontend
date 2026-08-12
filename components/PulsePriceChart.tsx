"use client";

import { useMemo } from "react";

export interface PulsePricePoint {
  atUnix: number;
  price: number;
}

/**
 * The round's price against its opening price.
 *
 * The whole bet is one comparison, so the chart is built around the opening line rather than around
 * the price scale. The line sits dead centre, the area fills toward it, and the fill takes its
 * colour from which side the price is currently on. Someone should be able to answer "am I winning"
 * without reading an axis.
 *
 * Drawn as inline SVG with a symmetric domain around the open, so a two dollar move looks the same
 * size whether it is up or down. An auto-fitted domain would make a tiny move look dramatic and a
 * large one look flat, which is exactly the wrong instinct to give someone about to take a side.
 */
export function PulsePriceChart({
  points,
  openingPrice,
  height = 180,
}: {
  points: readonly PulsePricePoint[];
  openingPrice: number | null;
  height?: number;
}) {
  const model = useMemo(() => {
    if (!openingPrice || points.length < 2) return null;
    const prices = points.map((point) => point.price);
    const widest = Math.max(
      ...prices.map((price) => Math.abs(price - openingPrice)),
      openingPrice * 0.0002, // a floor, so a flat round does not render as noise amplified to full scale
    );
    const domain = widest * 1.25;
    const firstAt = points[0].atUnix;
    const span = Math.max(1, points[points.length - 1].atUnix - firstAt);
    const x = (point: PulsePricePoint) => ((point.atUnix - firstAt) / span) * 1000;
    const y = (price: number) => height / 2 - ((price - openingPrice) / domain) * (height / 2 - 8);
    const line = points.map((point) => `${x(point).toFixed(2)},${y(point.price).toFixed(2)}`).join(" ");
    const last = points[points.length - 1];
    return {
      line,
      area: `0,${height / 2} ${line} ${x(last).toFixed(2)},${height / 2}`,
      lastX: x(last),
      lastY: y(last.price),
      up: last.price >= openingPrice,
      change: last.price - openingPrice,
      changePct: ((last.price - openingPrice) / openingPrice) * 100,
    };
  }, [points, openingPrice, height]);

  if (!model) {
    return (
      <div style={{ height, display: "grid", placeItems: "center", color: "var(--faint)", fontSize: 11 }}>
        Waiting for the opening price and the first ticks.
      </div>
    );
  }

  const tone = model.up ? "#4ea981" : "#e08877";
  return (
    <figure style={{ margin: 0 }}>
      <svg
        viewBox={`0 0 1000 ${height}`}
        preserveAspectRatio="none"
        style={{ width: "100%", height, display: "block" }}
        role="img"
        aria-label={`Gold is ${model.up ? "above" : "below"} the round's opening price by ${Math.abs(model.changePct).toFixed(3)} percent`}
      >
        <defs>
          <linearGradient id="pulse-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={tone} stopOpacity=".22" />
            <stop offset="1" stopColor={tone} stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* The opening price. Everything above it settles YES, everything below settles NO. */}
        <line
          x1="0" y1={height / 2} x2="1000" y2={height / 2}
          stroke="rgba(230,226,216,.35)" strokeWidth="1" strokeDasharray="4 4"
          vectorEffect="non-scaling-stroke"
        />
        <polygon points={model.area} fill="url(#pulse-fill)" />
        <polyline
          points={model.line} fill="none" stroke={tone} strokeWidth="2"
          vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round"
        />
        <circle cx={model.lastX} cy={model.lastY} r="3.5" fill={tone} vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption
        style={{
          display: "flex", justifyContent: "space-between", alignItems: "baseline",
          gap: 12, marginTop: 8, fontFamily: "var(--font-mono), monospace", fontSize: 11,
        }}
      >
        <span style={{ color: "var(--faint)" }}>Opening {openingPrice?.toFixed(2)}</span>
        <strong style={{ color: tone, fontSize: 13 }}>
          {model.up ? "▲" : "▼"} {model.change >= 0 ? "+" : "−"}{Math.abs(model.change).toFixed(2)}
          {" "}({model.changePct >= 0 ? "+" : "−"}{Math.abs(model.changePct).toFixed(3)}%)
        </strong>
      </figcaption>
    </figure>
  );
}
