# Grove — Project Spec

> **How to use this:** save this file as `SPEC.md` in an empty project folder, open Claude Code there, and say:
> *"Read SPEC.md. Build Phase 1 only, then stop and show me the result before continuing."*
> Building it in phases matters. If you ask for the whole thing at once you'll get a shallow version of every part instead of a good version of the core.

---

## 1. Concept

Grove is a personal portfolio visualizer where every stock you own is a living tree in a forest.

You "plant" a stock by recording a purchase — ticker, number of shares, price paid, date. A seed goes into the ground and grows into a tree over time. The tree's **structure** reflects how much the position has grown since you planted it. The tree's **health** reflects how it's doing right now. Each tree also keeps a journal that explains, in plain language, what real-world events moved the stock.

The goal is emotional legibility. A person should be able to walk into their forest and know how they're doing in one second, before reading a single number.

**This is not a trading platform and not a source of investment advice.** It reads market data and displays it. It never places trades, never recommends buying or selling, and never predicts future prices.

---

## 2. The core design rule: two independent visual channels

This is the most important part of the spec. Get this wrong and the whole thing feels fake.

A tree has two things that change independently:

| Channel | Driven by | What it controls |
|---|---|---|
| **Structure** | Peak total return since planting | Trunk height and thickness, number and length of branches, overall silhouette |
| **Health** | Recent performance (last 5–30 days) | Leaf color, leaf density, canopy droop, falling leaves, bare branches |

**Structure only grows. It does not shrink.** Real trees don't un-grow their trunks. A stock that doubled and then gave half of it back is a big tree that is currently sick — not a small tree. This matters because it preserves the history of the position in the shape of the object, which is the whole point of using a tree.

Branches can **die back** on sustained decline: they stay physically present but turn grey, lose their leaves, and eventually snap off if the drawdown is severe and prolonged. That's how structure reflects loss without cheating and shrinking.

**Health is short-horizon and volatile.** A green day makes a sick tree slightly less sick. It does not make it healthy.

### Structure stages (peak total return since planting)

| Stage | Peak return | Appearance |
|---|---|---|
| 0 — Seed | first 24h after planting | Seed in soil, small mound |
| 1 — Sprout | < 5% | Two leaves, thin green stem |
| 2 — Sapling | 5–15% | Thin trunk, 3–5 branches |
| 3 — Young tree | 15–40% | Defined trunk, 8–15 branches, real canopy |
| 4 — Mature tree | 40–100% | Thick trunk, 20–30 branches, wide canopy, visible roots |
| 5 — Elder tree | 100%+ | Massive gnarled trunk, dense canopy, exposed root system, moss |

Transitions between stages should **animate over 2–3 seconds**, not snap. Crossing a stage boundary is a small celebration and should feel like one.

### Health states (recent performance)

Drive this from a blended score — suggested starting point: 60% weight on 5-day return, 40% on 30-day return. Tune it after you see it move.

| Health | Score | Appearance |
|---|---|---|
| Thriving | > +8% | Vivid saturated green, 100% leaf density, branches lifted slightly upward, occasional new-growth tips |
| Healthy | +2% to +8% | Normal green, ~90% leaves |
| Steady | -2% to +2% | Slightly muted green, ~80% leaves |
| Stressed | -2% to -8% | Yellow-green, ~55% leaves, mild canopy droop |
| Wilting | -8% to -20% | Yellow-orange, ~30% leaves, pronounced droop, slow leaf-fall particles |
| Dying | < -20% | Brown/bare, < 10% leaves, heavy droop, grey branch tips |

Leaf color should be a **continuous gradient**, not six discrete jumps. Interpolate in HSL or OKLCH between the anchor colors so the tree shifts smoothly as the score moves.

---

## 3. Event effects

Discrete real-world events get discrete visuals. These are what make the forest feel alive rather than like an animated bar chart.

| Event | Visual |
|---|---|
| Dividend paid | Fruit appears on the tree; persists ~7 days, then falls to the ground and stays as a small pile at the base (cumulative dividend history) |
| Earnings beat | Blossoms across the canopy for 3 days |
| Earnings miss | A visible shed of leaves on the day, canopy thins temporarily |
| New 52-week high | A shaft of sunlight on that tree; a bird lands on a branch |
| New 52-week low | Persistent shadow over that tree |
| Single-day move > ±5% | Strong wind gust animation; leaf burst (green shimmer up, brown leaves down) |
| Stock split | Trunk forks into a second main stem |
| Position sold | Tree is not deleted — it becomes a **stump with rings**, and the rings count the years/months you held it. Clicking it shows the final realized return. |
| High volatility (elevated 20-day stdev) | Continuous sway amplitude increases |

---

## 4. Forest environment

The environment reflects the whole portfolio and the wider market, so a single stock's tree isn't the only signal.

- **Sky / weather** — driven by S&P 500 daily move. Clear blue on strong up days, overcast on flat, dark and rainy on broad selloffs, storm with lightning on a >2% index drop.
- **Time of day** — tied to real US market hours. Dawn at pre-market, full day 9:30am–4:00pm ET, dusk at close, night with stars and fireflies when closed. Show a small "Market closed" indicator.
- **Soil** — richness and color reflect total portfolio return. Dark and loamy when up, cracked and pale when down.
- **Season** — optional, maps to calendar quarter. Adds visual variety without carrying data meaning. Make it toggleable.
- **Layout** — trees are positioned on a gentle 2.5D ground plane, sorted by plant date (oldest at the back). Position must be stable across reloads.

---

## 5. Data sources

### Market data + news: Finnhub (`finnhub.io`)

Chosen because one free key covers both quotes and company-specific news, which is exactly what this app needs. Free tier at time of writing: ~60 calls/minute, real-time US quotes, company news, no credit card, personal/non-commercial use.

**Verify current free-tier limits and endpoint availability before building** — these change. In particular, check whether historical OHLC candles (`/stock/candle`) are still on the free tier. If they aren't, don't work around it with a second provider; instead have the app record its own daily snapshot on first fetch each day and build price history locally over time. New trees will start with a short history, which is fine and thematically appropriate.

Endpoints to use:
- `/quote` — current price, daily change
- `/company-news?symbol=X&from=&to=` — company news for the reasoning engine
- `/stock/profile2` — company name, logo, industry
- `/calendar/earnings` — earnings dates for the blossom/shed events

If Finnhub doesn't fit, alternatives worth checking: Twelve Data, Tiingo, Alpaca Market Data.

### Reasoning text: Anthropic API

Use the Anthropic Messages API (`claude-sonnet-4-6`) to turn raw news into the journal entries. Details in section 8.

### Rate limiting is a real constraint

Do not fetch on every render. Required:
- Server-side cache with a TTL of 60s during market hours, 15 min when closed
- One batched refresh cycle for all held tickers, not one request per tree
- News fetched at most once per ticker per hour
- Every API key lives in `.env.local` and is only ever read server-side. No key ever reaches the browser.

---

## 6. Architecture

- **Next.js (App Router) + TypeScript + Tailwind CSS**
- **SQLite via better-sqlite3** for local persistence — no cloud DB, no auth, no accounts. This is a single-user local app.
- **Route handlers** in `app/api/*` for all outbound API calls, so keys stay server-side
- **SVG** for tree rendering (see section 7). Not Canvas, not WebGL — SVG keeps it inspectable, crisp at any zoom, and easy to animate declaratively.
- **Framer Motion** for growth and state transitions
- Single-user, runs on `localhost`. No deployment concerns in v1.

---

## 7. Tree rendering — procedural and seeded

Trees must be **procedurally generated**, not drawn from a set of preset images. Six stage illustrations would kill the whole feeling within a day.

Implementation:

1. Recursive branching function. A branch spawns 2–3 child branches at a randomized angle and a length scaled by a decay factor, recursing to a depth set by the structure stage.
2. **Seed the randomness with a hash of the ticker symbol.** NVDA must produce the exact same tree shape on every reload and every machine. The shape only changes when the underlying data changes. This is non-negotiable — a tree that rerolls its silhouette on refresh stops being *your* tree.
3. Leaves are placed at branch endpoints and along outer branch segments. Health controls what fraction of leaf slots render and what color they take.
4. Growth animation uses SVG path `stroke-dasharray` / `stroke-dashoffset` so new branches appear to actually extend outward.
5. Idle sway: a slow sine-based rotation on branch groups, amplitude driven by volatility. Keep it subtle — this runs all day.

**Performance ceiling:** the forest must hold 30 trees at 60fps on a laptop. Cap total leaf elements per tree (~200). Use CSS transforms for sway rather than re-running the branching math. Pause animation for off-screen trees.

---

## 8. The reasoning engine — the journal

Every tree has a journal: a reverse-chronological feed of entries explaining what moved the stock.

**Trigger:** generate an entry when a day's move exceeds ±2%, or when a tracked event fires (earnings, dividend, split), or on the first day a stock is planted (a "what this company does" entry).

**Pipeline:**
1. Pull company news for the ticker across the relevant window
2. Send the headlines and summaries to Claude along with the actual price move
3. Get back a short, plain-language entry
4. Store it in SQLite so it's never regenerated

**Required output shape (2–4 sentences):**
- What happened, in plain English a non-investor understands
- The most likely connection to the price move, honestly hedged
- One line of garden-voice flavor tying it to the tree's visual state

**Honesty constraints — these are hard requirements on the system prompt:**

- The model must **never assert causation it can't support.** Correct: "Shares rose 6% the same day the company announced its new chip." Not correct: "The chip announcement caused shares to rise 6%."
- If the news doesn't plausibly explain the move, the entry must **say so.** "Shares dropped 4% today with no company-specific news — this looks like it moved with the broader semiconductor selloff" is a good entry. An invented explanation is a failure.
- **No forward-looking claims. No price targets. No buy/sell/hold language.** Not even implied.
- Every entry cites its source headlines with working links.
- If no news is available at all, write no entry rather than a fabricated one.

**Tone:** calm, factual, curious. A knowledgeable friend explaining what happened, not a hype account and not a doom account. The garden framing is a light touch at the end of the entry, not the whole voice.

Also render a **forest-level daily digest** — one short summary of the whole portfolio's day, generated once per day after market close.

---

## 9. Data model

```
plantings
  id, ticker, shares, cost_basis, planted_at, sold_at (nullable),
  sale_price (nullable), notes

snapshots            -- one row per ticker per trading day
  id, ticker, date, open, close, high, low, volume, created_at

journal_entries
  id, ticker, date, headline, body, sources (json),
  trigger_type, price_change_pct, created_at

events
  id, ticker, date, type, payload (json)   -- dividend, earnings, split, 52w high/low

tree_state           -- derived, cached
  ticker, structure_stage, peak_return, current_return,
  health_score, last_computed_at
```

`tree_state` is derived from the other tables. Recompute it on refresh rather than treating it as source of truth.

---

## 10. Interface

- **Forest view** (default) — the whole portfolio as trees on a ground plane. Hover a tree: name, current price, today's change, total return. Click: opens that tree.
- **Tree view** — one tree large and centered, journal feed beside it, position details, price chart, a **time-lapse scrubber** that replays the tree's growth from planting to today. The time-lapse is the feature people will show their friends. Build it well.
- **Plant flow** — search ticker, enter shares / price / date, watch the seed go into the ground with a short planting animation.
- **Numbers are always available but never dominant.** The tree is the primary display; exact figures live in a panel that's one click away. Someone who wants a spreadsheet has a spreadsheet.
- **Accessibility:** every tree state must be conveyed in text as well as visually. Screen-reader labels describing the tree's condition. Respect `prefers-reduced-motion` by disabling sway and particles while keeping state changes.

---

## 11. Build phases

**Do not skip ahead. Stop after each phase and show the result.**

1. **Static tree renderer.** No data. A `<Tree>` component taking `structureStage` (0–5) and `healthScore` (-1 to 1) as props, plus a dev page with sliders to drag through every combination. Nothing else matters until a wilting elder tree and a thriving sapling both look right.
2. **Data layer.** Finnhub integration, SQLite schema, plant/sell flow, caching, snapshot recording. Verified with real tickers.
3. **Wire them together.** Real positions driving real tree states. The forest view.
4. **Journal.** Anthropic API integration, news fetching, entry generation with the honesty constraints, journal UI.
5. **Environment.** Sky, weather, day/night, soil, market-wide effects.
6. **Events and polish.** Fruit, blossoms, stumps, the time-lapse scrubber, accessibility pass, performance pass.

---

## 12. Guardrails

- **Never fabricate market data.** If an API call fails, the UI shows a clear "data unavailable" state. A tree with unknown data renders in a neutral greyed state with a visible timestamp of its last successful update. Silent stale data displayed as current is the worst possible bug in this app.
- **No investment advice, ever.** No recommendations, no predictions, no sentiment scores presented as signals. A persistent, unobtrusive footer: "For informational purposes only. Not investment advice."
- **No trading integration.** Read-only, always.
- **No accounts, no telemetry, no third-party analytics.** Position data stays on the user's machine.
- Handle the ugly cases: tickers that get delisted, trading halts, tickers bought before an IPO date, positions added with a past date (backfill the growth), and the same ticker planted twice on different dates (two trees, or one tree with two root systems — pick one and be consistent).

---

## 13. Decisions still open

Flag these and ask before assuming:

1. If the same ticker is bought twice on different dates — one tree or two?
2. Should structure scale on **total return %** or **absolute dollar gain**? Percentage makes a small winning position look as impressive as a large one. Dollar-based makes the forest reflect real stakes but makes small positions permanently tiny.
3. Should a stock held flat for a long time still grow slowly? (Argument for: time in the market should be visible. Argument against: it decouples the tree from performance.)
4. What happens to a tree that goes to zero — stump, or does it stay standing as a dead snag?
