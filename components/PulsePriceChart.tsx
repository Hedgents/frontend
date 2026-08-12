"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export interface PulsePricePoint {
  atUnix: number;
  price: number;
}

const PADDING = { top: 10, right: 54, bottom: 20, left: 8 };
const MINUTE = 60;

/**
 * The round's price against its opening price, on real axes.
 *
 * Time is the x axis and it is fixed to the round's own fifteen minute window, not to the span of
 * whatever samples happen to have arrived. That distinction is the whole point: if the domain
 * stretches to fit the data, a round thirty seconds old fills the same width as one that is nearly
 * over, and the picture says nothing about when anything happened. Here the line grows left to
 * right as the round runs and the remaining time stays visibly empty.
 *
 * Price is the y axis, labelled, and centred on the opening price because the bet is a comparison
 * against that one number. The domain is symmetric around it so a two dollar move looks the same
 * size up or down, with a floor so a flat round is not noise amplified to full scale. The labels
 * are what keep that honest: they say how much of a move the height actually represents.
 *
 * Drawn at measured pixel width rather than through a stretched viewBox, because a viewBox with
 * preserveAspectRatio="none" distorts text along with the geometry.
 */
export function PulsePriceChart({
  points,
  openingPrice,
  startsAtUnix,
  endsAtUnix,
  nowUnix,
  height = 200,
}: {
  points: readonly PulsePricePoint[];
  openingPrice: number | null;
  startsAtUnix: number | null;
  endsAtUnix: number | null;
  nowUnix: number | null;
  height?: number;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver(([entry]) => {
      const measured = entry.contentRect.width;
      if (measured > 0) setWidth(measured);
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const model = useMemo(() => {
    if (!openingPrice || !startsAtUnix || !endsAtUnix || endsAtUnix <= startsAtUnix) return null;
    const plot = {
      left: PADDING.left,
      right: width - PADDING.right,
      top: PADDING.top,
      bottom: height - PADDING.bottom,
    };
    if (plot.right <= plot.left) return null;
    const midY = (plot.top + plot.bottom) / 2;

    // Symmetric around the open, wide enough for every point, floored so a flat round stays flat.
    const widest = Math.max(
      ...points.map((point) => Math.abs(point.price - openingPrice)),
      openingPrice * 0.0002,
    );
    const domain = widest * 1.25;

    const x = (atUnix: number) => plot.left
      + ((Math.min(Math.max(atUnix, startsAtUnix), endsAtUnix) - startsAtUnix) / (endsAtUnix - startsAtUnix))
      * (plot.right - plot.left);
    const y = (price: number) => midY - ((price - openingPrice) / domain) * (midY - plot.top);

    const inWindow = points
      .filter((point) => point.atUnix >= startsAtUnix && point.atUnix <= endsAtUnix)
      .sort((left, right) => left.atUnix - right.atUnix);
    if (inWindow.length < 1) return null;

    const line = inWindow.map((point) => `${x(point.atUnix).toFixed(1)},${y(point.price).toFixed(1)}`).join(" ");
    const last = inWindow[inWindow.length - 1];

    // A tick every five minutes, labelled by minutes into the round.
    const timeTicks: Array<{ x: number; label: string }> = [];
    for (let offset = 0; offset <= endsAtUnix - startsAtUnix; offset += 5 * MINUTE) {
      timeTicks.push({ x: x(startsAtUnix + offset), label: `${offset / MINUTE}m` });
    }
    // Price ticks: the open, and the edges of the domain either side of it.
    const priceTicks = [domain, domain / 2, 0, -domain / 2, -domain].map((delta) => ({
      y: y(openingPrice + delta),
      label: (openingPrice + delta).toFixed(2),
      isOpen: delta === 0,
    }));

    return {
      plot,
      midY,
      line,
      area: `${x(inWindow[0].atUnix).toFixed(1)},${midY} ${line} ${x(last.atUnix).toFixed(1)},${midY}`,
      lastX: x(last.atUnix),
      lastY: y(last.price),
      nowX: nowUnix === null ? null : x(nowUnix),
      up: last.price >= openingPrice,
      change: last.price - openingPrice,
      changePct: ((last.price - openingPrice) / openingPrice) * 100,
      timeTicks,
      priceTicks,
      single: inWindow.length === 1,
    };
  }, [points, openingPrice, startsAtUnix, endsAtUnix, nowUnix, width, height]);

  const tone = model?.up === false ? "#e08877" : "#4ea981";

  return (
    <figure style={{ margin: 0 }} ref={hostRef}>
      {!model ? (
        <div style={{ height, display: "grid", placeItems: "center", color: "var(--faint)", fontSize: 11 }}>
          Waiting for the opening price and the first ticks.
        </div>
      ) : (
        <svg
          width={width}
          height={height}
          style={{ display: "block", overflow: "visible" }}
          role="img"
          aria-label={`Gold is ${model.up ? "above" : "below"} the round's opening price by ${Math.abs(model.changePct).toFixed(3)} percent, ${model.timeTicks.length ? "" : ""}plotted over the round's fifteen minute window`}
        >
          <defs>
            <linearGradient id="pulse-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={tone} stopOpacity=".2" />
              <stop offset="1" stopColor={tone} stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Price gridlines, with the opening price emphasised: above it settles YES, below it NO. */}
          {model.priceTicks.map((tick) => (
            <g key={tick.label}>
              <line
                x1={model.plot.left} y1={tick.y} x2={model.plot.right} y2={tick.y}
                stroke={tick.isOpen ? "rgba(230,226,216,.4)" : "rgba(230,226,216,.09)"}
                strokeWidth="1"
                strokeDasharray={tick.isOpen ? "4 4" : undefined}
              />
              <text
                x={model.plot.right + 7} y={tick.y + 3}
                fill={tick.isOpen ? "var(--metal-tone)" : "var(--faint)"}
                style={{ font: `${tick.isOpen ? 600 : 400} 9px var(--font-mono), monospace` }}
              >
                {tick.label}
              </text>
            </g>
          ))}

          {/* Time axis, fixed to the round window so the line advances in real time. */}
          <line
            x1={model.plot.left} y1={model.plot.bottom} x2={model.plot.right} y2={model.plot.bottom}
            stroke="rgba(230,226,216,.14)" strokeWidth="1"
          />
          {model.timeTicks.map((tick) => (
            <g key={tick.label}>
              <line
                x1={tick.x} y1={model.plot.top} x2={tick.x} y2={model.plot.bottom}
                stroke="rgba(230,226,216,.06)" strokeWidth="1"
              />
              <text
                x={tick.x} y={model.plot.bottom + 13}
                fill="var(--faint)" textAnchor="middle"
                style={{ font: "400 9px var(--font-mono), monospace" }}
              >
                {tick.label}
              </text>
            </g>
          ))}

          {!model.single ? <polygon points={model.area} fill="url(#pulse-fill)" /> : null}
          {!model.single ? (
            <polyline
              points={model.line} fill="none" stroke={tone} strokeWidth="1.75"
              strokeLinejoin="round" strokeLinecap="round"
            />
          ) : null}
          <circle cx={model.lastX} cy={model.lastY} r="3" fill={tone} />

          {/* Where the round has reached. Everything to the right of it has not happened yet. */}
          {model.nowX !== null && model.nowX < model.plot.right - 1 ? (
            <line
              x1={model.nowX} y1={model.plot.top} x2={model.nowX} y2={model.plot.bottom}
              stroke={tone} strokeOpacity=".35" strokeWidth="1" strokeDasharray="2 3"
            />
          ) : null}
        </svg>
      )}
      <figcaption
        style={{
          display: "flex", justifyContent: "space-between", alignItems: "baseline",
          gap: 12, marginTop: 8, fontFamily: "var(--font-mono), monospace", fontSize: 11,
        }}
      >
        <span style={{ color: "var(--faint)" }}>
          Opening {openingPrice ? openingPrice.toFixed(2) : "—"} · XAU/USD
        </span>
        {model ? (
          <strong style={{ color: tone, fontSize: 13 }}>
            {model.up ? "▲" : "▼"} {model.change >= 0 ? "+" : "−"}{Math.abs(model.change).toFixed(2)}
            {" "}({model.changePct >= 0 ? "+" : "−"}{Math.abs(model.changePct).toFixed(3)}%)
          </strong>
        ) : null}
      </figcaption>
    </figure>
  );
}
