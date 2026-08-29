"use client";

import { useMemo, useState } from "react";

import { Tree } from "@/components/tree/tree";
import { healthLabelForUnit } from "@/lib/tree";
import { cn } from "@/lib/utils";

const STAGE_LABELS = [
  "Seed",
  "Sprout",
  "Sapling",
  "Young tree",
  "Mature tree",
  "Elder tree",
];

const STAGES = [0, 1, 2, 3, 4, 5];
const HEALTH_SAMPLES = [-1, -0.6, -0.25, 0.1, 0.5, 1];
const TICKERS = ["NVDA", "AAPL", "DE", "KO", "XOM", "JPM", "TSLA", "WMT"];

const stageBg = {
  background: "linear-gradient(180deg, var(--sky-top), var(--sky-bottom) 70%, var(--ground))",
};

export default function DevTreePage() {
  const [ticker, setTicker] = useState("NVDA");
  const [stage, setStage] = useState(3);
  const [health, setHealth] = useState(0.3);

  const cleanTicker = ticker.trim() || "NVDA";

  const bigLabel = useMemo(
    () =>
      `${cleanTicker} · stage ${stage} (${STAGE_LABELS[stage]}) · health ${health.toFixed(
        2,
      )} (${healthLabelForUnit(health)})`,
    [cleanTicker, stage, health],
  );

  return (
    <main className="mx-auto max-w-6xl space-y-10 px-4 py-8 md:px-8 md:py-12">
      <header className="space-y-1">
        <p className="text-[0.7rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Grove · dev
        </p>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          Tree renderer
        </h1>
        <p className="text-sm text-muted-foreground">
          Procedural SVG tree (SPEC §7). Shape is seeded from the ticker — same
          ticker, same tree. Drag the sliders to walk every combination.
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-[300px_minmax(0,1fr)]">
        {/* controls */}
        <div className="space-y-7">
          <div className="space-y-2">
            <label
              htmlFor="ticker"
              className="text-[0.7rem] font-medium uppercase tracking-[0.08em] text-muted-foreground"
            >
              Ticker (seed)
            </label>
            <input
              id="ticker"
              value={ticker}
              onChange={(e) => setTicker(e.target.value.toUpperCase())}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="flex flex-wrap gap-1.5">
              {TICKERS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTicker(t)}
                  className={cn(
                    "rounded-md border px-2 py-1 font-mono text-xs transition-colors",
                    t === cleanTicker
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-baseline justify-between">
              <label
                htmlFor="stage"
                className="text-[0.7rem] font-medium uppercase tracking-[0.08em] text-muted-foreground"
              >
                structureStage
              </label>
              <span className="font-mono text-xs text-foreground/80">
                {stage} · {STAGE_LABELS[stage]}
              </span>
            </div>
            <input
              id="stage"
              type="range"
              min={0}
              max={5}
              step={1}
              value={stage}
              onChange={(e) => setStage(Number(e.target.value))}
              className="w-full"
              style={{ accentColor: "var(--primary)" }}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-baseline justify-between">
              <label
                htmlFor="health"
                className="text-[0.7rem] font-medium uppercase tracking-[0.08em] text-muted-foreground"
              >
                healthScore
              </label>
              <span className="font-mono text-xs text-foreground/80">
                {health.toFixed(2)} · {healthLabelForUnit(health)}
              </span>
            </div>
            <input
              id="health"
              type="range"
              min={-1}
              max={1}
              step={0.05}
              value={health}
              onChange={(e) => setHealth(Number(e.target.value))}
              className="w-full"
              style={{ accentColor: "var(--primary)" }}
            />
          </div>

          <button
            type="button"
            onClick={() => {
              setStage(Math.floor(Math.random() * 6));
              setHealth(Math.round((Math.random() * 2 - 1) * 20) / 20);
              setTicker(TICKERS[Math.floor(Math.random() * TICKERS.length)]);
            }}
            className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            Randomize
          </button>
        </div>

        {/* big preview */}
        <div
          className="flex min-h-[440px] items-end justify-center rounded-2xl p-6 ring-1 ring-foreground/10"
          style={stageBg}
        >
          <Tree
            key={`${cleanTicker}-${stage}-${health}`}
            ticker={cleanTicker}
            structureStage={stage}
            healthScore={health}
            aria-label={bigLabel}
            className="h-[clamp(320px,58vh,520px)] w-full max-w-[560px]"
          />
        </div>
      </div>

      {/* every stage at current health */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium">
          Every stage{" "}
          <span className="text-muted-foreground">
            · healthScore {health.toFixed(2)} ({healthLabelForUnit(health)})
          </span>
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {STAGES.map((s) => (
            <figure
              key={s}
              className="space-y-1.5 rounded-xl p-3 ring-1 ring-foreground/10"
              style={stageBg}
            >
              <Tree
                decorative
                ticker={cleanTicker}
                structureStage={s}
                healthScore={health}
                className="h-36 w-full"
              />
              <figcaption className="text-center text-[0.7rem] text-muted-foreground">
                {s} · {STAGE_LABELS[s]}
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      {/* current stage across health */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium">
          Stage {stage}{" "}
          <span className="text-muted-foreground">
            ({STAGE_LABELS[stage]}) · across healthScore
          </span>
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {HEALTH_SAMPLES.map((h) => (
            <figure
              key={h}
              className="space-y-1.5 rounded-xl p-3 ring-1 ring-foreground/10"
              style={stageBg}
            >
              <Tree
                decorative
                ticker={cleanTicker}
                structureStage={stage}
                healthScore={h}
                className="h-36 w-full"
              />
              <figcaption className="text-center text-[0.7rem] text-muted-foreground">
                {h.toFixed(2)} · {healthLabelForUnit(h)}
              </figcaption>
            </figure>
          ))}
        </div>
      </section>
    </main>
  );
}
