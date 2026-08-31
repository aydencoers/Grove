"use client";

import { useState } from "react";

import { Tree3D } from "@/components/tree/tree-3d";
import { healthLabelForUnit } from "@/lib/tree3d";
import { SKIN_LIST, type SkinId } from "@/lib/tree-skins";
import { cn } from "@/lib/utils";

const STAGE_LABELS = [
  "Seed",
  "Sprout",
  "Sapling",
  "Young tree",
  "Mature tree",
  "Elder tree",
];

const TICKERS = ["NVDA", "AAPL", "DE", "KO", "XOM", "JPM", "TSLA", "WMT"];

function Slider({
  id,
  label,
  value,
  display,
  min,
  max,
  step,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <label
          htmlFor={id}
          className="text-[0.7rem] font-medium uppercase tracking-[0.08em] text-muted-foreground"
        >
          {label}
        </label>
        <span className="font-mono text-xs text-foreground/80">{display}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
        style={{ accentColor: "var(--primary)" }}
      />
    </div>
  );
}

export default function DevTreePage() {
  const [ticker, setTicker] = useState("NVDA");
  const [structureStage, setStructureStage] = useState(3);
  const [healthScore, setHealthScore] = useState(0.3);
  const [volatility, setVolatility] = useState(0.35);
  const [skin, setSkin] = useState<SkinId>("default");
  const [shedding, setShedding] = useState(false);
  const [view, setView] = useState<"single" | "all">("single");

  const cleanTicker = ticker.trim() || "NVDA";

  return (
    <main className="mx-auto max-w-6xl space-y-8 px-4 py-8 md:px-8 md:py-12">
      <header className="space-y-1">
        <p className="text-[0.7rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Grove · dev
        </p>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          Tree renderer
        </h1>
        <p className="text-sm text-muted-foreground">
          Live 3D tree — React Three Fiber + @dgreenheck/ez-tree. Seeded from the
          ticker. Structure and volatility rebuild the mesh; health only tints
          the leaves. Drag to orbit.
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-[300px_minmax(0,1fr)]">
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
            <span className="text-[0.7rem] font-medium uppercase tracking-[0.08em] text-muted-foreground">
              View
            </span>
            <div className="flex gap-1.5">
              {(["single", "all"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  className={cn(
                    "rounded-md border px-2.5 py-1 text-xs transition-colors",
                    v === view
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {v === "single" ? "Single" : "All stages"}
                </button>
              ))}
            </div>
          </div>

          <Slider
            id="structureStage"
            label="structureStage"
            value={structureStage}
            display={`${structureStage} · ${STAGE_LABELS[structureStage]}`}
            min={0}
            max={5}
            step={1}
            onChange={setStructureStage}
          />
          <Slider
            id="healthScore"
            label="healthScore"
            value={healthScore}
            display={`${healthScore.toFixed(2)} · ${healthLabelForUnit(healthScore)}`}
            min={-1}
            max={1}
            step={0.05}
            onChange={setHealthScore}
          />
          <Slider
            id="volatility"
            label="volatility"
            value={volatility}
            display={volatility.toFixed(2)}
            min={0}
            max={1}
            step={0.05}
            onChange={setVolatility}
          />

          <div className="space-y-2">
            <span className="text-[0.7rem] font-medium uppercase tracking-[0.08em] text-muted-foreground">
              Leaf skin
            </span>
            <div className="flex flex-wrap gap-1.5">
              {SKIN_LIST.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSkin(s.id)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors",
                    s.id === skin
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <span
                    aria-hidden
                    className="size-3 rounded-full border border-black/10"
                    style={{ background: s.ramp.thriving }}
                  />
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={shedding}
              onChange={(e) => setShedding(e.target.checked)}
              style={{ accentColor: "var(--primary)" }}
            />
            Down day — falling-leaf particles
          </label>

          <p className="text-xs leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground/80">
              healthScore and skin never regenerate the mesh.
            </span>{" "}
            Skin swaps the leaf texture + colour ramp + density on the live
            material; only structureStage, volatility (bucketed), and the skin&rsquo;s
            leaf <em>size</em> call generate().
          </p>
        </div>

        {view === "single" ? (
          <div className="min-h-[520px] overflow-hidden rounded-2xl ring-1 ring-foreground/10">
            <Tree3D
              className="h-[clamp(420px,68vh,720px)] w-full"
              ticker={cleanTicker}
              structureStage={structureStage}
              healthScore={healthScore}
              volatility={volatility}
              skin={skin}
              shedding={shedding}
              interactive
            />
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {STAGE_LABELS.map((label, stage) => (
              <figure
                key={stage}
                className="overflow-hidden rounded-xl ring-1 ring-foreground/10"
              >
                <Tree3D
                  className="h-[clamp(220px,32vh,320px)] w-full"
                  ticker={cleanTicker}
                  structureStage={stage}
                  healthScore={healthScore}
                  volatility={volatility}
                  skin={skin}
                  shedding={shedding}
                />
                <figcaption className="bg-card px-2.5 py-1.5 text-[0.7rem] text-muted-foreground">
                  {stage} · {label}
                </figcaption>
              </figure>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
