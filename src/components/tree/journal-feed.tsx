import type { ComponentType } from "react";
import {
  Citrus,
  ExternalLink,
  Sparkles,
  Split,
  Sprout,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type {
  JournalEntry,
  JournalTrigger,
  TreeFixture,
} from "@/lib/tree-fixtures";
import { formatDate, formatSignedPct } from "@/lib/format";
import { cn } from "@/lib/utils";

const TRIGGER_META: Record<
  JournalTrigger,
  { label: string; icon: ComponentType<{ className?: string }> }
> = {
  planted: { label: "Planted", icon: Sprout },
  "price-move": { label: "Price move", icon: TrendingUp },
  dividend: { label: "Dividend", icon: Citrus },
  earnings: { label: "Earnings", icon: Sparkles },
  split: { label: "Stock split", icon: Split },
};

function Entry({ entry, isLast }: { entry: JournalEntry; isLast: boolean }) {
  const meta = TRIGGER_META[entry.trigger];
  const Icon =
    entry.trigger === "price-move" && (entry.priceChangePct ?? 0) < 0
      ? TrendingDown
      : meta.icon;

  const moveTone =
    (entry.priceChangePct ?? 0) >= 0
      ? "text-[color:var(--gain)]"
      : "text-[color:var(--loss)]";

  return (
    <li className="relative pl-9">
      {!isLast && (
        <span
          aria-hidden
          className="absolute left-[13px] top-8 -bottom-1 w-px bg-foreground/15"
        />
      )}
      <span
        aria-hidden
        className="absolute left-0 top-0.5 flex size-7 items-center justify-center rounded-full bg-secondary text-secondary-foreground ring-4 ring-card"
      >
        <Icon className="size-3.5" />
      </span>

      <div className={cn("space-y-2", isLast ? "pb-0" : "pb-8")}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span className="font-medium text-foreground/80">{meta.label}</span>
          {entry.priceChangePct != null && (
            <span className={cn("tabular-nums", moveTone)}>
              {formatSignedPct(entry.priceChangePct, 1)}
            </span>
          )}
          <span aria-hidden>·</span>
          <time dateTime={entry.date}>{formatDate(entry.date)}</time>
        </div>

        <h3 className="font-heading text-[0.95rem] font-medium leading-snug text-foreground">
          {entry.headline}
        </h3>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {entry.body}
        </p>

        <ul className="space-y-1.5 pt-0.5">
          {entry.sources.map((source) => (
            <li key={source.url}>
              <a
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex w-full items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs text-foreground/70 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ExternalLink
                  className="size-3 shrink-0 text-muted-foreground"
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate">{source.label}</span>
                <span className="shrink-0 text-muted-foreground">
                  {source.publisher}
                </span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </li>
  );
}

export function JournalFeed({ tree }: { tree: TreeFixture }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Journal</CardTitle>
        <CardDescription>
          What moved this tree, in plain language — {tree.journal.length} entries.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ol>
          {tree.journal.map((entry, i) => (
            <Entry
              key={entry.id}
              entry={entry}
              isLast={i === tree.journal.length - 1}
            />
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
