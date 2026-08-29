import type { CSSProperties } from "react";

import type { HealthState } from "@/lib/tree-fixtures";
import { formatSignedPct } from "@/lib/format";
import { cn } from "@/lib/utils";

interface TreePlaceholderProps {
  stage: number;
  stageLabel: string;
  health: HealthState;
  healthLabel: string;
  peakReturnPct: number;
  totalReturnPct: number;
  return30dPct: number;
}

const TOTAL_STAGES = 5;

/**
 * Stand-in for the procedural SVG tree (SPEC §7), which is not built yet.
 * A plain foliage-green disc on a ground plane, sized to read as the primary
 * object on the page. Every state it represents is also written out in text.
 */
export function TreePlaceholder({
  stage,
  stageLabel,
  health,
  healthLabel,
  peakReturnPct,
  totalReturnPct,
  return30dPct,
}: TreePlaceholderProps) {
  const showNewGrowth = health === "thriving" || health === "healthy";

  const label =
    `${stageLabel}, structure stage ${stage} of ${TOTAL_STAGES}. ` +
    `Health: ${healthLabel}. Total return since planting ${formatSignedPct(totalReturnPct)}, ` +
    `with a peak of ${formatSignedPct(peakReturnPct)}. ` +
    `Recent 30-day trend ${formatSignedPct(return30dPct)}. ` +
    `Shown as a placeholder disc until the procedural tree renderer is built.`;

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
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[36%]"
          style={{
            background:
              "linear-gradient(180deg, transparent 0%, color-mix(in oklch, var(--ground), transparent 30%) 45%, var(--ground) 100%)",
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-[36%] h-px bg-foreground/10"
        />

        {/* the tree */}
        <div className="absolute inset-x-0 bottom-[calc(36%-1.75rem)] flex flex-col items-center">
          <div className="relative">
            {/* soft canopy glow */}
            <div
              aria-hidden
              className="grove-glow absolute left-1/2 top-1/2 -z-10 -translate-x-1/2 -translate-y-1/2 rounded-full blur-2xl"
              style={{
                width: "clamp(200px, 34vw, 300px)",
                height: "clamp(200px, 34vw, 300px)",
                background:
                  "radial-gradient(circle, color-mix(in oklch, var(--foliage), transparent 45%) 0%, transparent 70%)",
              }}
            />

            <div className="grove-breathe">
              {/* new-growth tips (only when the tree is doing well) */}
              {showNewGrowth && (
                <>
                  {[
                    { top: "6%", left: "28%" },
                    { top: "-1%", left: "54%" },
                    { top: "13%", left: "78%" },
                  ].map((pos, i) => (
                    <span
                      key={i}
                      aria-hidden
                      className="grove-glow absolute z-10 h-2.5 w-2.5 rounded-full"
                      style={{
                        ...pos,
                        background: "var(--foliage-tip)",
                        boxShadow:
                          "0 0 8px color-mix(in oklch, var(--foliage-tip), transparent 40%)",
                        animationDelay: `${i * 0.9}s`,
                      }}
                    />
                  ))}
                </>
              )}

              {/* canopy disc — placeholder for the tree */}
              <div
                className="rounded-full"
                style={{
                  width: "clamp(168px, 30vw, 264px)",
                  height: "clamp(168px, 30vw, 264px)",
                  background:
                    "radial-gradient(circle at 36% 30%, var(--foliage-tip) 0%, var(--foliage) 46%, var(--foliage-deep) 100%)",
                  boxShadow:
                    "inset 0 2px 10px rgba(255,255,255,0.35), inset 0 -22px 44px color-mix(in oklch, var(--foliage-deep), transparent 25%), 0 26px 50px -18px color-mix(in oklch, var(--foliage-deep), transparent 20%)",
                }}
              />
            </div>

            {/* contact shadow on the ground */}
            <div
              aria-hidden
              className="absolute left-1/2 top-full h-4 w-[78%] -translate-x-1/2 rounded-[100%] bg-foreground/25 blur-md"
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
            <span
              className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground"
            >
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
