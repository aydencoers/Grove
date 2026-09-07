"use client";

import { useState } from "react";

import { Tree3D } from "@/components/tree/tree-3d";
import type { TreeState } from "@/lib/derive";
import { formatSignedPct } from "@/lib/format";
import { SKIN_LIST, skinSwatch, type SkinId } from "@/lib/tree-skins";
import { cn } from "@/lib/utils";

const TOTAL_STAGES = 5;

/**
 * The framed view of a single tree: the live 3D scene, a leaf-skin picker, and
 * the structure / health readouts that convey the same state in text
 * (SPEC §10 accessibility).
 */
export function TreeStage({ state }: { state: TreeState }) {
  const {
    ticker,
    structureStage,
    structureStageLabel,
    healthLabel,
    healthScore,
    volatility,
    totalReturnPct,
    peakReturnPct,
    skin: initialSkin,
  } = state;

  // Would PATCH the planting record; no backend yet, so it's local for now.
  const [skin, setSkin] = useState<SkinId>(initialSkin);

  const label =
    `${structureStageLabel}, structure stage ${structureStage} of ${TOTAL_STAGES}. ` +
    `Health: ${healthLabel}. Total return since planting ${formatSignedPct(totalReturnPct)}, ` +
    `with a peak of ${formatSignedPct(peakReturnPct)}. ` +
    `Recent trend ${formatSignedPct(healthScore)}.`;

  return (
    <div className="flex flex-col gap-5">
      <figure
        role="img"
        aria-label={label}
        className="relative h-[clamp(340px,52vh,520px)] overflow-hidden rounded-2xl ring-1 ring-foreground/10"
      >
        <Tree3D
          className="absolute inset-0"
          ticker={ticker}
          structureStage={structureStage}
          healthScore={healthScore}
          volatility={volatility}
          skin={skin}
        />

        {/* leaf-skin picker */}
        <div
          role="group"
          aria-label="Leaf skin"
          className="absolute right-3 top-3 flex gap-1 rounded-full bg-black/35 p-1 backdrop-blur-sm"
        >
          {SKIN_LIST.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSkin(s.id)}
              aria-pressed={s.id === skin}
              title={s.label}
              className={cn(
                "size-6 rounded-full border transition",
                s.id === skin
                  ? "border-white ring-2 ring-white/60"
                  : "border-white/40 hover:border-white/80",
              )}
              style={{ background: skinSwatch(s) }}
            >
              <span className="sr-only">{s.label}</span>
            </button>
          ))}
        </div>

        <figcaption className="pointer-events-none absolute bottom-3 left-4 right-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-white/90 [text-shadow:0_1px_3px_rgb(0_0_0/0.55)]">
          <span className="font-medium">{structureStageLabel}</span>
          <span aria-hidden>·</span>
          <span>{healthLabel} right now</span>
          <span aria-hidden>·</span>
          <span className="tabular-nums">
            peak {formatSignedPct(peakReturnPct, 1)}
          </span>
        </figcaption>
      </figure>

      {/* text + meter conveying the same state non-visually */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[0.7rem] font-medium uppercase tracking-[0.08em] text-muted-foreground">
              Structure
            </span>
            <span className="text-xs text-muted-foreground tabular-nums">
              Stage {structureStage} of {TOTAL_STAGES}
            </span>
          </div>
          <div className="flex gap-1.5" aria-hidden>
            {Array.from({ length: TOTAL_STAGES }).map((_, i) => (
              <span
                key={i}
                className={cn(
                  "h-1.5 flex-1 rounded-full transition-colors",
                  i < structureStage ? "bg-foliage" : "bg-foliage/15",
                )}
              />
            ))}
          </div>
          <p className="text-sm text-foreground/80">
            <span className="font-medium">{structureStageLabel}.</span> Holds your
            peak return of{" "}
            <span className="tabular-nums">
              {formatSignedPct(peakReturnPct, 1)}
            </span>{" "}
            — structure only grows.
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[0.7rem] font-medium uppercase tracking-[0.08em] text-muted-foreground">
              Health
            </span>
            <span className="text-xs text-muted-foreground">recent trend</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground">
              <span
                aria-hidden
                className="h-2 w-2 rounded-full"
                style={{ background: "var(--foliage)" }}
              />
              {healthLabel}
            </span>
            <span className="text-sm text-muted-foreground tabular-nums">
              {formatSignedPct(healthScore, 1)} trend
            </span>
          </div>
          <p className="text-sm text-foreground/80">
            Leaf colour and fullness track recent performance. A good week nudges
            it; it doesn&rsquo;t rewrite the tree.
          </p>
        </div>
      </div>
    </div>
  );
}
