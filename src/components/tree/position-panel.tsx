import { Clock } from "lucide-react";

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { TreeFixture } from "@/lib/tree-fixtures";
import {
  formatCurrency,
  formatDate,
  formatDuration,
  formatEtTime,
  formatPrice,
  formatSignedCurrency,
  formatSignedPct,
} from "@/lib/format";
import { cn } from "@/lib/utils";

function Row({
  label,
  children,
  emphasis,
}: {
  label: string;
  children: React.ReactNode;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="text-[0.7rem] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </dt>
      <dd
        className={cn(
          "text-right font-mono text-sm tabular-nums",
          emphasis ? "text-base font-medium" : "text-foreground/90"
        )}
      >
        {children}
      </dd>
    </div>
  );
}

export function PositionPanel({ tree }: { tree: TreeFixture }) {
  const invested = tree.shares * tree.costBasis;
  const marketValue = tree.shares * tree.currentPrice;
  const totalReturnAbs = marketValue - invested;
  const totalReturnPct = (totalReturnAbs / invested) * 100;

  const dayChangeAbs = tree.currentPrice - tree.previousClose;
  const dayChangePct = (dayChangeAbs / tree.previousClose) * 100;

  const gainTone =
    totalReturnAbs >= 0 ? "text-[color:var(--gain)]" : "text-[color:var(--loss)]";
  const dayTone =
    dayChangeAbs >= 0 ? "text-[color:var(--gain)]" : "text-[color:var(--loss)]";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Position</CardTitle>
        <CardDescription>
          {tree.shares} shares of {tree.ticker}
        </CardDescription>
        <CardAction>
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[0.7rem] text-muted-foreground">
            <Clock className="size-3" aria-hidden />
            <span>Updated {formatEtTime(tree.lastUpdated)}</span>
          </span>
        </CardAction>
      </CardHeader>

      <CardContent>
        <dl className="divide-y divide-border">
          <Row label="Shares">{tree.shares}</Row>
          <Row label="Cost basis">
            {formatPrice(tree.costBasis)}
            <span className="text-muted-foreground"> / sh</span>
          </Row>
          <Row label="Invested">{formatCurrency(invested)}</Row>
          <Row label="Planted">
            <span className="text-foreground/90">
              {formatDate(tree.plantedAt)}
            </span>
          </Row>
        </dl>

        <Separator className="my-3" />

        <dl className="divide-y divide-border">
          <Row label="Current price">
            {formatPrice(tree.currentPrice)}{" "}
            <span className={cn("ml-1 text-xs", dayTone)}>
              {formatSignedPct(dayChangePct)} today
            </span>
          </Row>
          <Row label="Market value">{formatCurrency(marketValue)}</Row>
          <Row label="Total return" emphasis>
            <span className={gainTone}>
              {formatSignedPct(totalReturnPct)}
              <span className="ml-2 font-normal text-muted-foreground">
                {formatSignedCurrency(totalReturnAbs)}
              </span>
            </span>
          </Row>
        </dl>

        <p className="mt-4 text-xs text-muted-foreground">
          Held {formatDuration(tree.plantedAt, "2026-08-29")}. Peak return since
          planting {formatSignedPct(tree.peakReturnPct, 1)}.
        </p>
      </CardContent>
    </Card>
  );
}
