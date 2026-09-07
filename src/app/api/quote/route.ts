/*
 * GET /api/quote?symbols=DE,NVDA,KO
 *
 * Server-side proxy for Finnhub quotes so the API key never reaches the
 * browser (SPEC §5). The pages fetch quotes directly via lib/finnhub on the
 * server; this route exists for client-side or external callers and mirrors
 * the same batched, cached fetch.
 */

import { fetchQuotes } from "@/lib/finnhub";
import { getPositions } from "@/lib/positions";

export async function GET(request: Request) {
  const param = new URL(request.url).searchParams.get("symbols");
  const symbols = param
    ? param.split(",").map((s) => s.trim()).filter(Boolean)
    : getPositions().map((p) => p.ticker);

  if (symbols.length === 0 || symbols.length > 50) {
    return Response.json(
      { error: "Pass 1–50 comma-separated symbols." },
      { status: 400 },
    );
  }

  const result = await fetchQuotes(symbols);
  return Response.json(result, {
    status: result.error && !result.live ? 502 : 200,
  });
}
