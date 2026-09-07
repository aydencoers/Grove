import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Moon, Sun } from "lucide-react";

import { JournalFeed } from "@/components/tree/journal-feed";
import { PositionPanel } from "@/components/tree/position-panel";
import { TreeStage } from "@/components/tree/tree-stage";
import { deriveTreeState } from "@/lib/derive";
import { fetchQuotes } from "@/lib/finnhub";
import { marketClock } from "@/lib/market";
import { getPosition } from "@/lib/positions";

export const revalidate = 60;

export default async function TreePage({ params }: PageProps<"/tree/[id]">) {
  const { id } = await params;
  const position = getPosition(id);
  if (!position) notFound();

  const { quotes } = await fetchQuotes([position.ticker]);
  const state = deriveTreeState(position, quotes[position.ticker] ?? null);
  const clock = marketClock();
  const MarketIcon = clock.open ? Sun : Moon;

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur-sm">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 md:px-8">
          <div className="flex items-center gap-3 md:gap-5">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ArrowLeft className="size-4" aria-hidden />
              <span>Grove</span>
            </Link>
            <div className="h-5 w-px bg-border" aria-hidden />
            <div className="flex items-baseline gap-2.5">
              <h1 className="font-heading text-lg font-semibold tracking-tight text-foreground">
                {state.ticker}
              </h1>
              <p className="hidden text-sm text-muted-foreground sm:block">
                {state.company}
              </p>
            </div>
          </div>

          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground">
            <MarketIcon className="size-3.5" aria-hidden />
            <span className="font-medium text-foreground/80">
              {clock.open ? "Market open" : "Market closed"}
            </span>
            <span className="hidden sm:inline">· {clock.note}</span>
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 md:px-8 md:py-10">
        <div className="mb-6 sm:hidden">
          <p className="text-sm text-muted-foreground">{state.company}</p>
        </div>

        <div className="grid gap-8 min-[900px]:grid-cols-[minmax(0,1fr)_minmax(340px,380px)]">
          <section
            aria-label="Tree"
            className="min-[900px]:sticky min-[900px]:top-[81px] min-[900px]:self-start"
          >
            <TreeStage state={state} />
          </section>

          <div className="flex flex-col gap-6">
            <PositionPanel state={state} />
            <JournalFeed journal={position.journal} />
          </div>
        </div>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto w-full max-w-6xl px-4 py-4 md:px-8">
          <p className="text-xs text-muted-foreground">
            For informational purposes only. Not investment advice. Grove reads
            market data and displays it — it never places trades and never
            recommends buying or selling.
          </p>
        </div>
      </footer>
    </div>
  );
}
