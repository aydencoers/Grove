/*
 * Position + live quote → the numbers the tree renders from.
 *
 * The two-channel rule (SPEC §2):
 *   structure  = f(peak total return since planting)   monotonic, only grows
 *   health     = f(recent performance)                 volatile, moves fast
 *
 * Structure stage comes from peakReturnPct (seeded) OR the current live total
 * return, whichever is higher — so a fresh all-time high grows the tree, but a
 * drawdown never shrinks it. Health comes from the seeded recent-trend percent,
 * nudged slightly by today's live move.
 */

import { resolveFireTier, stageIndex } from "@/lib/tree3d";
import { healthLabelForPercent } from "@/lib/tree-skins";
import type { Quote } from "@/lib/finnhub";
import type { Position, StructureStage } from "@/lib/positions";

const STAGE_LABELS = [
  "Seed",
  "Sprout",
  "Sapling",
  "Young tree",
  "Mature tree",
  "Elder tree",
] as const;

/** Peak total return (%) → structure stage, per the SPEC §2 table. */
function stageFromPeak(peakPct: number, plantedAt: string): StructureStage {
  const hoursHeld = (Date.now() - new Date(plantedAt).getTime()) / 3_600_000;
  if (hoursHeld < 24) return 0;
  if (peakPct < 5) return 1;
  if (peakPct < 15) return 2;
  if (peakPct < 40) return 3;
  if (peakPct < 100) return 4;
  return 5;
}

export interface TreeState {
  ticker: string;
  company: string;
  industry: string;

  shares: number;
  costBasis: number;
  plantedAt: string;

  /** Live when `live` is true, else the position's dated reference price. */
  price: number;
  dayChangePct: number;
  live: boolean;
  /** ISO date the price is good as of (today when live, else refPriceAsOf). */
  priceAsOf: string;

  invested: number;
  marketValue: number;
  totalReturnAbs: number;
  totalReturnPct: number;
  peakReturnPct: number;

  structureStage: StructureStage;
  structureStageLabel: string;

  /** Blended recent-return percent — drives colour / foliage / fire. */
  healthScore: number;
  healthLabel: string;
  volatility: number;
  fireTier: number;

  skin: Position["skin"];
}

export function deriveTreeState(pos: Position, quote: Quote | null): TreeState {
  const live = quote != null;
  const price = live ? quote.price : pos.refPrice;
  const dayChangePct = live ? quote.changePct : 0;
  const priceAsOf = live
    ? new Date().toISOString().slice(0, 10)
    : pos.refPriceAsOf;

  const invested = pos.shares * pos.costBasis;
  const marketValue = pos.shares * price;
  const totalReturnAbs = marketValue - invested;
  const totalReturnPct = (totalReturnAbs / invested) * 100;

  // Structure only grows: the live return can raise the peak, never lower it.
  const peakReturnPct = Math.max(pos.peakReturnPct, totalReturnPct);
  const structureStage = stageFromPeak(peakReturnPct, pos.plantedAt);

  // Health is the seeded recent trend, lightly pulled by today's live move.
  const healthScore = live
    ? pos.recentReturnPct * 0.85 + dayChangePct * 0.15
    : pos.recentReturnPct;

  return {
    ticker: pos.ticker,
    company: pos.company,
    industry: pos.industry,
    shares: pos.shares,
    costBasis: pos.costBasis,
    plantedAt: pos.plantedAt,

    price,
    dayChangePct,
    live,
    priceAsOf,

    invested,
    marketValue,
    totalReturnAbs,
    totalReturnPct,
    peakReturnPct,

    structureStage,
    structureStageLabel: STAGE_LABELS[stageIndex(structureStage)],

    healthScore,
    healthLabel: healthLabelForPercent(healthScore),
    volatility: pos.volatility,
    fireTier: resolveFireTier(healthScore, 0),

    skin: pos.skin,
  };
}
