/*
 * The plantings — one hand-authored position per tree in the demo grove.
 *
 * What's real vs. seeded (be honest about this — SPEC §12):
 *   - shares / costBasis / plantedAt : fixed demo values, chosen to spread the
 *     trees across every structure stage and health state.
 *   - current price + today's move   : LIVE from Finnhub at request time
 *     (lib/finnhub.ts). Falls back to `refPrice` (dated) when the feed is down.
 *   - peakReturnPct / recentReturnPct / volatility : SEEDED. The free Finnhub
 *     tier has no historical candles, so the "best return since planting" and
 *     the recent-trend inputs can't be computed — they're authored per position
 *     and documented as such in the README.
 *
 * Journal entries follow SPEC §8: plain language, no causation claims, no
 * forward-looking statements, no buy/sell/hold language, real source links.
 * The full news→journal reasoning engine is designed but not built; every
 * position here carries just its "planted" note.
 */

import type { SkinId } from "@/lib/tree-skins";

export type StructureStage = 0 | 1 | 2 | 3 | 4 | 5;

export type JournalTrigger =
  | "planted"
  | "price-move"
  | "dividend"
  | "earnings"
  | "split";

export interface JournalSource {
  label: string;
  publisher: string;
  url: string;
}

export interface JournalEntry {
  id: string;
  /** ISO date, e.g. "2024-03-12". */
  date: string;
  trigger: JournalTrigger;
  headline: string;
  body: string;
  /** Same-day move that triggered the entry, when there was one. */
  priceChangePct?: number;
  sources: JournalSource[];
}

export interface Position {
  /** URL slug for /tree/[id]. */
  id: string;
  ticker: string;
  company: string;
  industry: string;

  shares: number;
  /** Weighted-average cost per share. */
  costBasis: number;
  /** ISO date the seed went in the ground. */
  plantedAt: string;

  /** Fallback price used only when the live feed is unavailable. */
  refPrice: number;
  /** ISO date `refPrice` is good as of. */
  refPriceAsOf: string;

  /** SEEDED — best total return seen since planting. Structure floor. */
  peakReturnPct: number;
  /** SEEDED — blended recent-trend percent. Drives colour / foliage / fire. */
  recentReturnPct: number;
  /** SEEDED — 0–1, elevated 20-day stdev. Drives gnarliness + wind. */
  volatility: number;

  /** Leaf skin chosen for this planting. */
  skin: SkinId;

  journal: JournalEntry[];
}

const POSITIONS: Position[] = [
  {
    id: "nvda",
    ticker: "NVDA",
    company: "NVIDIA Corporation",
    industry: "Semiconductors",
    shares: 60,
    costBasis: 82.0,
    plantedAt: "2024-08-01",
    refPrice: 178.2,
    refPriceAsOf: "2026-08-29",
    peakReturnPct: 130,
    recentReturnPct: 12,
    volatility: 0.5,
    skin: "default",
    journal: [
      {
        id: "nvda-planted",
        date: "2024-08-01",
        trigger: "planted",
        headline: "Planted: NVIDIA Corporation (NVDA)",
        body: "NVIDIA designs graphics processors and the chips and software used to train and run AI models. Its data-centre business — selling accelerators to cloud providers and large companies — has become the largest part of its revenue, alongside older lines in gaming and professional graphics. Results tend to swing with spending cycles on AI infrastructure, which makes the stock volatile. No price move to explain yet; this marks the day the seed went in. Sixty shares at $82.00.",
        sources: [
          {
            label: "NVIDIA — company overview",
            publisher: "NVIDIA",
            url: "https://www.nvidia.com/en-us/about-nvidia/",
          },
        ],
      },
    ],
  },
  {
    id: "de",
    ticker: "DE",
    company: "Deere & Company",
    industry: "Farm & Heavy Construction Machinery",
    shares: 40,
    costBasis: 398.2,
    plantedAt: "2024-03-12",
    refPrice: 472.6,
    refPriceAsOf: "2026-08-29",
    peakReturnPct: 26.1,
    recentReturnPct: 2.6,
    volatility: 0.32,
    skin: "default",
    journal: [
      {
        id: "de-2026-08-27",
        date: "2026-08-27",
        trigger: "price-move",
        priceChangePct: 3.1,
        headline:
          "Shares rose 3.1% the day Deere reported stronger equipment orders",
        body: "Deere said quarterly equipment sales came in ahead of what analysts had expected, helped by demand for large tractors in Brazil, while noting that North American demand is still soft. Shares climbed 3.1% on the same day; the S&P 500 was roughly flat, so the move looks connected to the company update rather than the broader market. A few branch tips are putting out fresh growth this week.",
        sources: [
          {
            label:
              "Deere quarterly equipment sales top expectations on Brazil demand",
            publisher: "Reuters",
            url: "https://www.reuters.com/markets/companies/DE.N/",
          },
          {
            label: "Farm-equipment makers climb after Deere's update",
            publisher: "Bloomberg",
            url: "https://www.bloomberg.com/quote/DE:US",
          },
        ],
      },
      {
        id: "de-2026-08-14",
        date: "2026-08-14",
        trigger: "dividend",
        headline: "A dividend landed — fruit on the tree",
        body: "Deere paid its regular quarterly dividend of $1.62 per share on August 14. For this position of 40 shares that is $64.80, now recorded in the tree's history. Dividend payments like this one do not typically move the share price, and the day's small change showed no clear connection to it. The fruit will hang on the canopy for about a week, then drop to the pile forming at the base.",
        sources: [
          {
            label:
              "Deere & Company declares quarterly dividend of $1.62 per share",
            publisher: "Deere IR",
            url: "https://ir.deere.com/",
          },
        ],
      },
      {
        id: "de-2024-03-12",
        date: "2024-03-12",
        trigger: "planted",
        headline: "Planted: Deere & Company (DE)",
        body: "Deere makes agricultural and construction machinery — the green tractors and combines on farms, plus road-building and forestry equipment. Its results tend to rise and fall with farm incomes, crop prices, and interest rates, which makes the stock fairly cyclical. There is no price move to explain yet; this entry just marks the day the seed went in. Forty shares at $398.20.",
        sources: [
          {
            label: "Deere & Company — company profile and business overview",
            publisher: "Deere.com",
            url: "https://www.deere.com/en/our-company/",
          },
        ],
      },
    ],
  },
  {
    id: "sbux",
    ticker: "SBUX",
    company: "Starbucks Corporation",
    industry: "Restaurants",
    shares: 90,
    costBasis: 66.0,
    plantedAt: "2020-07-01",
    refPrice: 95.8,
    refPriceAsOf: "2026-08-29",
    peakReturnPct: 62,
    recentReturnPct: 5.2,
    volatility: 0.26,
    skin: "gold",
    journal: [
      {
        id: "sbux-planted",
        date: "2020-07-01",
        trigger: "planted",
        headline: "Planted: Starbucks Corporation (SBUX)",
        body: "Starbucks operates and licenses coffee shops worldwide and sells packaged coffee and drinks through grocery channels. Its results track consumer spending, foot traffic, and its two biggest markets, the United States and China. Same-store sales growth and store count are the numbers watched most closely. No price move to explain yet; this marks the planting. Ninety shares at $66.00.",
        sources: [
          {
            label: "Starbucks — company information",
            publisher: "Starbucks",
            url: "https://www.starbucks.com/about-us/",
          },
        ],
      },
    ],
  },
  {
    id: "xom",
    ticker: "XOM",
    company: "Exxon Mobil Corporation",
    industry: "Oil & Gas Integrated",
    shares: 75,
    costBasis: 88.4,
    plantedAt: "2022-10-05",
    refPrice: 107.9,
    refPriceAsOf: "2026-08-29",
    peakReturnPct: 28,
    recentReturnPct: -14,
    volatility: 0.3,
    skin: "default",
    journal: [
      {
        id: "xom-planted",
        date: "2022-10-05",
        trigger: "planted",
        headline: "Planted: Exxon Mobil Corporation (XOM)",
        body: "ExxonMobil explores for, produces, refines, and sells oil, natural gas, and chemicals. Its earnings move largely with crude oil and natural gas prices, refining margins, and production volumes, so the stock is closely tied to the energy cycle. No price move to explain yet; this entry marks the day the seed went in. Seventy-five shares at $88.40.",
        sources: [
          {
            label: "ExxonMobil — who we are",
            publisher: "ExxonMobil",
            url: "https://corporate.exxonmobil.com/who-we-are",
          },
        ],
      },
    ],
  },
  {
    id: "ko",
    ticker: "KO",
    company: "The Coca-Cola Company",
    industry: "Beverages — Non-Alcoholic",
    shares: 120,
    costBasis: 62.0,
    plantedAt: "2023-06-20",
    refPrice: 68.9,
    refPriceAsOf: "2026-08-29",
    peakReturnPct: 13,
    recentReturnPct: -0.8,
    volatility: 0.12,
    skin: "cherry",
    journal: [
      {
        id: "ko-planted",
        date: "2023-06-20",
        trigger: "planted",
        headline: "Planted: The Coca-Cola Company (KO)",
        body: "Coca-Cola sells concentrate and syrups to a network of bottlers and markets finished sparkling and still drinks under brands including Coca-Cola, Sprite, Fanta, Costa, and Dasani. Its revenue is spread across many countries, so currency swings and pricing decisions matter as much as volume. The stock is generally regarded as defensive. No price move to explain yet; this marks the planting. One hundred and twenty shares at $62.00.",
        sources: [
          {
            label: "The Coca-Cola Company — about us",
            publisher: "The Coca-Cola Company",
            url: "https://www.coca-colacompany.com/about-us",
          },
        ],
      },
    ],
  },
  {
    id: "pfe",
    ticker: "PFE",
    company: "Pfizer Inc.",
    industry: "Drug Manufacturers — General",
    shares: 200,
    costBasis: 44.1,
    plantedAt: "2023-01-17",
    refPrice: 24.2,
    refPriceAsOf: "2026-08-29",
    peakReturnPct: 18,
    recentReturnPct: -52,
    volatility: 0.4,
    skin: "default",
    journal: [
      {
        id: "pfe-planted",
        date: "2023-01-17",
        trigger: "planted",
        headline: "Planted: Pfizer Inc. (PFE)",
        body: "Pfizer researches, makes, and sells prescription medicines and vaccines across areas including oncology, immunology, and cardiology. After a large run-up in pandemic-era vaccine and antiviral sales, revenue from those products fell sharply, and the company's results now depend on its other treatments and its pipeline. No price move to explain yet; this entry marks the day the seed went in. Two hundred shares at $44.10.",
        sources: [
          {
            label: "Pfizer — about",
            publisher: "Pfizer",
            url: "https://www.pfizer.com/about",
          },
        ],
      },
    ],
  },
];

export function getPositions(): Position[] {
  return POSITIONS;
}

export function getPosition(id: string): Position | undefined {
  return POSITIONS.find((p) => p.id === id.toLowerCase());
}
