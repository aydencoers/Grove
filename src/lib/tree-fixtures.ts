/*
 * UI-only fixture data for the tree detail view.
 *
 * There is no market data layer wired up yet (SPEC phase 2). Everything here is
 * hand-authored so the view can be designed against realistic shapes. The
 * journal entries deliberately follow the honesty constraints from SPEC §8:
 * correlation is never stated as causation, there are no forward-looking claims,
 * no price targets, and no buy / sell / hold language.
 */

export type StructureStage = 0 | 1 | 2 | 3 | 4 | 5;

export type HealthState =
  | "thriving"
  | "healthy"
  | "steady"
  | "stressed"
  | "wilting"
  | "dying";

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
  /** ISO date, e.g. 2026-08-27 */
  date: string;
  trigger: JournalTrigger;
  headline: string;
  body: string;
  /** Same-day move that triggered the entry, when there was one. */
  priceChangePct?: number;
  sources: JournalSource[];
}

export interface TreeFixture {
  id: string;
  ticker: string;
  company: string;
  industry: string;

  shares: number;
  /** Weighted-average cost per share. */
  costBasis: number;
  /** ISO date the seed went in the ground. */
  plantedAt: string;

  currentPrice: number;
  previousClose: number;

  /** Blended recent-performance inputs (percent). */
  return5dPct: number;
  return30dPct: number;

  /** Best total return seen since planting — drives structure, only grows. */
  peakReturnPct: number;

  structureStage: StructureStage;
  structureStageLabel: string;

  health: HealthState;
  healthLabel: string;
  /** 60% weight on 5d, 40% on 30d — the SPEC §2 starting point. */
  healthScore: number;

  /** ISO datetime of the last successful data pull. */
  lastUpdated: string;
  marketOpen: boolean;
  marketStatusNote: string;

  journal: JournalEntry[];
}

const DEERE: TreeFixture = {
  id: "de",
  ticker: "DE",
  company: "Deere & Company",
  industry: "Farm & Heavy Construction Machinery",

  shares: 40,
  costBasis: 398.2,
  plantedAt: "2024-03-12",

  currentPrice: 472.6,
  previousClose: 465.99,

  return5dPct: 2.1,
  return30dPct: 3.4,

  peakReturnPct: 26.1,

  structureStage: 3,
  structureStageLabel: "Young tree",

  health: "healthy",
  healthLabel: "Healthy",
  healthScore: 2.6,

  lastUpdated: "2026-08-29T15:58:00-04:00",
  marketOpen: false,
  marketStatusNote: "Opens Monday 9:30 AM ET",

  journal: [
    {
      id: "de-2026-08-27",
      date: "2026-08-27",
      trigger: "price-move",
      priceChangePct: 3.1,
      headline: "Shares rose 3.1% the day Deere reported stronger equipment orders",
      body: "Deere said quarterly equipment sales came in ahead of what analysts had expected, helped by demand for large tractors in Brazil, while noting that North American demand is still soft. Shares climbed 3.1% on the same day; the S&P 500 was roughly flat, so the move looks connected to the company update rather than the broader market. A few branch tips are putting out fresh growth this week.",
      sources: [
        {
          label: "Deere quarterly equipment sales top expectations on Brazil demand",
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
          label: "Deere & Company declares quarterly dividend of $1.62 per share",
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
};

const FIXTURES: Record<string, TreeFixture> = {
  de: DEERE,
};

/**
 * Returns the fixture for an id, falling back to the sample tree so any
 * /tree/[id] route renders something during UI development.
 */
export function getTreeFixture(id: string): TreeFixture {
  return FIXTURES[id.toLowerCase()] ?? DEERE;
}
