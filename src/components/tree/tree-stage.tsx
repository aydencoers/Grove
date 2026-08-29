import type { CSSProperties } from "react";

import { Tree } from "@/components/tree/tree";
import { formatSignedPct } from "@/lib/format";
import { cn } from "@/lib/utils";

interface TreeStageProps {
  ticker: string;
  stage: number;
  stageLabel: string;
  healthLabel: string;
  /** Tree healthScore in [-1, 1]. */
  healthUnit: number;
  peakReturnPct: number;
  totalReturnPct: number;
  return30dPct: number;
}

const TOTAL_STAGES = 5;

/**
 * The framed "stage" the tree stands on: sky, ground plane, ambient light,
 * plus the structure/health readouts that convey the same state in text
 * (SPEC §10 accessibility). The tree itself is the procedural <Tree>.
 */
export function TreeStage({
  ticker,
  stage,
  stageLabel,
  healthLabel,
  healthUnit,
  peakReturnPct,
  totalReturnPct,
  return30dPct,
}: TreeStageProps) {
  const label =
    `${stageLabel}, structure stage ${stage} of ${TOTAL_STAGES}. ` +
    `Health: ${healthLabel}. Total return since planting ${formatSignedPct(totalReturnPct)}, ` +
    `with a peak of ${formatSignedPct(peakReturnPct)}. ` +
    `Recent 30-day trend ${formatSignedPct(return30dPct)}.`;

  return (
    <div className="flex flex-col gap-5">
      <figure
        role="img"
        aria-label={label}
        className="relative h-[clamp(320px,50vh,480px)] overflow-hidden rounded-2xl ring-1 ring-foreground/10"
        style={
          {
            background:
              "linear-gradient(180deg, var(--sky-top) 0%, var(--sky-bottom) 72%, var(--ground) 100%)",
          } as CSSProperties
        }
      >
        {/* morning sun */}
        <div
          aria-hidden
          className="grove-glow pointer-events-none absolute -right-10 -top-10 h-56 w-56 rounded-full blur-2xl"
          style={{
            background:
              "radial-gradient(circle, var(--sunlight) 0%, transparent 70%)",
          }}
        />

        {/* ground plane */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[34%]"
          style={{
            background:
              "linear-gradient(180deg, transparent 0%, color-mix(in oklch, var(--ground), transparent 30%) 45%, var(--ground) 100%)",
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-[34%] h-px bg-foreground/10"
        />

        {/* the tree, rooted on the ground line */}
        <div className="absolute inset-x-0 bottom-[calc(34%-0.5rem)] flex justify-center">
          <div
            className="relative"
            style={{
              width: "clamp(240px, 46vw, 380px)",
              height: "clamp(240px, 42vh, 380px)",
            }}
          >
            {/* soft canopy light */}
            <div
              aria-hidden
              className="grove-glow absolute left-1/2 top-[38%] -z-10 h-[62%] w-[78%] -translate-x-1/2 -translate-y-1/2 rounded-full blur-2xl"
              style={{
                background:
                  "radial-gradient(circle, color-mix(in oklch, var(--foliage), transparent 55%) 0%, transparent 70%)",
              }}
            />

            <Tree
              decorative
              ticker={ticker}
              structureStage={stage}
              healthScore={healthUnit}
              className="grove-breathe h-full w-full origin-bottom"
            />

            {/* contact shadow */}
            <div
              aria-hidden
              className="absolute bottom-0 left-1/2 h-3.5 w-[66%] -translate-x-1/2 translate-y-1/2 rounded-[100%] bg-foreground/25 blur-md"
            />
          </div>
        </div>

        <figcaption className="absolute bottom-3 left-4 right-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span className="font-medium text-foreground/80">{stageLabel}</span>
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
              Stage {stage} of {TOTAL_STAGES}
            </span>
          </div>
          <div className="flex gap-1.5" aria-hidden>
            {Array.from({ length: TOTAL_STAGES }).map((_, i) => (
              <span
                key={i}
                className={cn(
                  "h-1.5 flex-1 rounded-full transition-colors",
                  i < stage ? "bg-foliage" : "bg-foliage/15"
                )}
              />
            ))}
          </div>
          <p className="text-sm text-foreground/80">
            <span className="font-medium">{stageLabel}.</span> Holds your peak
            return of{" "}
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
            <span className="text-xs text-muted-foreground">last 30 days</span>
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
              {formatSignedPct(return30dPct, 1)} trend
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
