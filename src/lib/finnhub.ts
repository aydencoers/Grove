/*
 * Finnhub quote fetch — SERVER ONLY.
 *
 * FINNHUB_API_KEY lives in .env.local and is read here only. This module must
 * never be imported by a Client Component: it has no "use client" ancestor and
 * the key has no NEXT_PUBLIC_ prefix, so it stays out of the browser bundle.
 *
 * Free tier (finnhub.io): ~60 req/min, real-time US quotes via /quote. No
 * historical candles on the free tier, so "peak return since planting" and the
 * recent-trend inputs are seeded per position (see lib/positions.ts) rather
 * than derived here.
 *
 * SPEC guardrail: never fabricate a live price. When the key is missing or a
 * request fails, the quote comes back absent and the UI falls back to each
 * position's dated reference price with a visible "prices as of" note.
 */

import { marketClock } from "@/lib/market";

const BASE = "https://finnhub.io/api/v1";

export interface Quote {
  /** Current price. */
  price: number;
  /** Absolute day change. */
  change: number;
  /** Percent day change. */
  changePct: number;
  /** Previous close. */
  prevClose: number;
}

export interface QuoteResult {
  quotes: Record<string, Quote>;
  /** ISO timestamp of this fetch. */
  fetchedAt: string;
  /** True when at least one live quote came back. */
  live: boolean;
  /** Present when the fetch could not run or fully failed. */
  error?: string;
}

/** Finnhub /quote raw shape. Zeros mean "unknown symbol" on the free tier. */
interface RawQuote {
  c: number; // current
  d: number | null; // change
  dp: number | null; // percent change
  pc: number; // previous close
}

async function fetchOne(
  symbol: string,
  token: string,
  revalidate: number,
): Promise<Quote | null> {
  try {
    const res = await fetch(
      `${BASE}/quote?symbol=${encodeURIComponent(symbol)}&token=${token}`,
      { next: { revalidate } },
    );
    if (!res.ok) return null;
    const raw = (await res.json()) as RawQuote;
    // Finnhub returns all-zeros for an unrecognised symbol rather than a 404.
    if (!raw || !raw.c || raw.c <= 0) return null;
    return {
      price: raw.c,
      change: raw.d ?? 0,
      changePct: raw.dp ?? 0,
      prevClose: raw.pc || raw.c - (raw.d ?? 0),
    };
  } catch {
    return null;
  }
}

/**
 * Batched quote fetch for every held ticker. One request per symbol (Finnhub
 * has no bulk quote endpoint on the free tier), each individually cached so a
 * page render reuses them. TTL: 60s while the market is open, 15 min closed.
 */
export async function fetchQuotes(symbols: string[]): Promise<QuoteResult> {
  const fetchedAt = new Date().toISOString();
  const token = process.env.FINNHUB_API_KEY;
  const unique = [...new Set(symbols.map((s) => s.toUpperCase()))];

  if (!token) {
    return {
      quotes: {},
      fetchedAt,
      live: false,
      error: "FINNHUB_API_KEY is not set — showing reference prices.",
    };
  }

  const revalidate = marketClock().open ? 60 : 900;
  const settled = await Promise.all(
    unique.map(async (s) => [s, await fetchOne(s, token, revalidate)] as const),
  );

  const quotes: Record<string, Quote> = {};
  for (const [s, q] of settled) if (q) quotes[s] = q;

  const live = Object.keys(quotes).length > 0;
  return {
    quotes,
    fetchedAt,
    live,
    error: live ? undefined : "Finnhub request failed — showing reference prices.",
  };
}
