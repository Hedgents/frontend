"use client";

import styles from "./scarcity-instrument-tabs.module.css";

type ScarcityInstrument = "curve" | "event";

interface ScarcityInstrumentTabsProps {
  active: ScarcityInstrument;
  onCurve: () => void;
  onEvent: () => void;
}

const instruments = [
  {
    id: "curve" as const,
    label: "Curve forecasts",
    description: "Forecast the settled score",
  },
  {
    id: "event" as const,
    label: "Event markets",
    description: "Trade the named outcome",
  },
];

export function ScarcityInstrumentTabs({
  active,
  onCurve,
  onEvent,
}: ScarcityInstrumentTabsProps) {
  return (
    <div
      className={styles.tabs}
      role="tablist"
      aria-label="Scarcity market instrument"
      data-testid="scarcity-instrument-tabs"
    >
      {instruments.map((instrument) => {
        const selected = active === instrument.id;
        return (
          <button
            key={instrument.id}
            type="button"
            role="tab"
            className={selected ? styles.active : undefined}
            aria-label={instrument.label}
            aria-selected={selected}
            aria-pressed={selected}
            onClick={instrument.id === "curve" ? onCurve : onEvent}
          >
            <span>{instrument.label}</span>
            <small>{instrument.description}</small>
          </button>
        );
      })}
    </div>
  );
}
