import Link from "next/link";
import { ArrowUpRight, Flame, Moon, Sun } from "lucide-react";

import { deriveTreeState, type TreeState } from "@/lib/derive";
import { fetchQuotes } from "@/lib/finnhub";
import { formatSignedPct } from "@/lib/format";
import { marketClock } from "@/lib/market";
import { getPositions } from "@/lib/positions";
import { getSkin, healthRamp } from "@/lib/tree-skins";
import { cn } from "@/lib/utils";

// Re-render at most once a minute; the Finnhub fetch underneath has its own
// 60s (open) / 15min (closed) cache, so this just bounds page staleness.
export const revalidate = 60;

const TOTAL_STAGES = 5;

function TreeCard({ id, state }: { id: string; state: TreeState }) {
  const ramp = healthRamp(getSkin(state.skin), state.healthScore);
  const gainTone =
    state.totalReturnAbs >= 0
      ? "text-[color:var(--gain)]"
      : "text-[color:var(--loss)]";

  return (
    <Link
      href={`/tree/${id}`}
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card transition-colors hover:border-foreground/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {/* health-tinted crown strip */}
      <div
        aria-hidden
        className="h-16 w-full opacity-90"
        style={{
          background: `radial-gradient(120% 150% at 50% 100%, ${ramp.color} 0%, color-mix(in oklab, ${ramp.color} 22%, transparent) 55%, transparent 100%)`,
        }}
      />

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-baseline justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-heading text-base font-semibold tracking-tight text-foreground">
                {state.ticker}
              </span>
              <ArrowUpRight className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
            </div>
            <p className="truncate text-xs text-muted-foreground">
              {state.company}
            </p>
          </div>
          <span className={cn("shrink-0 font-mono text-sm tabular-nums", gainTone)}>
            {formatSignedPct(state.totalReturnPct, 1)}
          </span>
        </div>

        {/* structure meter */}
        <div className="flex items-center gap-2">
          <div className="flex flex-1 gap-1" aria-hidden>
            {Array.from({ length: TOTAL_STAGES }).map((_, i) => (
              <span
                key={i}
                className={cn(
                  "h-1 flex-1 rounded-full",
                  i < state.structureStage ? "bg-foliage" : "bg-foliage/15",
                )}
              />
            ))}
          </div>
          <span className="shrink-0 text-[0.7rem] text-muted-foreground">
            {state.structureStageLabel}
          </span>
        </div>

        <div className="mt-auto flex items-center justify-between gap-2 pt-1">
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <span
              aria-hidden
              className="size-2 rounded-full"
              style={{ background: ramp.color }}
            />
            {state.healthLabel}
          </span>
          {state.fireTier > 0 ? (
            <span className="inline-flex items-center gap-1 text-xs text-[color:var(--loss)]">
              <Flame className="size-3" aria-hidden />
              on fire
            </span>
          ) : (
            state.live && (
              <span
                className={cn(
                  "font-mono text-[0.7rem] tabular-nums",
                  state.dayChangePct >= 0
                    ? "text-[color:var(--gain)]"
                    : "text-[color:var(--loss)]",
                )}
              >
                {formatSignedPct(state.dayChangePct, 1)} today
              </span>
            )
          )}
        </div>
      </div>
    </Link>
  );
}

export default async function Home() {
  const positions = getPositions();
  const { quotes, live, fetchedAt } = await fetchQuotes(
    positions.map((p) => p.ticker),
  );
  const clock = marketClock();
  const MarketIcon = clock.open ? Sun : Moon;

  const trees = [...positions]
    .sort((a, b) => a.plantedAt.localeCompare(b.plantedAt))
    .map((p) => ({
      id: p.id,
      state: deriveTreeState(p, quotes[p.ticker] ?? null),
    }));

  const asOf = new Date(fetchedAt).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-4 md:px-8">
          <p className="text-[0.7rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Grove
          </p>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground">
            <MarketIcon className="size-3.5" aria-hidden />
            <span className="font-medium text-foreground/80">
              {clock.open ? "Market open" : "Market closed"}
            </span>
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 md:px-8 md:py-14">
        <div className="max-w-xl">
          <h1 className="font-heading text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            A portfolio you can walk through
          </h1>
          <p className="mt-3 text-balance text-muted-foreground">
            Every position is a tree. Its <strong>size</strong> is the best total
            return the position has ever reached — it only grows. Its{" "}
            <strong>colour, fullness, and fire</strong> track how the stock has
            done lately. Pick one to step inside.
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            {live
              ? `Prices live from Finnhub · ${asOf} ET`
              : "Live feed unavailable — showing each position's reference price."}
          </p>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {trees.map(({ id, state }) => (
            <TreeCard key={id} id={id} state={state} />
          ))}
        </div>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto w-full max-w-6xl px-4 py-4 md:px-8">
          <p className="text-xs text-muted-foreground">
            For informational purposes only. Not investment advice. Positions are
            sample data; recent-trend and volatility inputs are seeded per
            position. Prices are live where available.
          </p>
        </div>
      </footer>
    </div>
  );
}
