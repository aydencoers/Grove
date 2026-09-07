# Grove — Spec

Grove is a personal portfolio visualiser where every stock you hold is a living
tree. You "plant" a position (ticker, shares, price paid, date); it grows into a
tree whose shape is the history of the position and whose colour is how it's
doing right now.

This document describes **what's built**. Ideas that were designed but not
implemented are collected at the end.

**Not a trading platform, not investment advice.** Grove reads market data and
displays it. It never places trades, never recommends buying or selling, never
predicts prices.

---

## 1. The core rule: two independent visual channels

A tree has two things that move independently.

| Channel | Driven by | Controls |
|---|---|---|
| **Structure** | Peak total return since planting | Trunk height/thickness, branch count and length, canopy size, overall silhouette |
| **Health** | Recent performance | Leaf colour, leaf density, canopy droop, branch die-back, fire |

**Structure only grows.** A stock that doubled and gave half of it back is a big
tree that is currently sick — not a small tree. The peak is a floor; a fresh
all-time high raises it, a drawdown never lowers it.

**Health is short-horizon and volatile.** A green day makes a sick tree slightly
less sick. It does not make it healthy.

### Structure stages — by peak total return since planting

| Stage | Peak return | Appearance |
|---|---|---|
| 0 — Seed | first 24h | seed in soil |
| 1 — Sprout | < 5% | thin stem, a few leaves |
| 2 — Sapling | 5–15% | thin trunk, 3–5 branches |
| 3 — Young tree | 15–40% | defined trunk, real canopy |
| 4 — Mature tree | 40–100% | thick trunk, wide canopy |
| 5 — Elder tree | 100%+ | massive gnarled trunk, dense crown |

Branch count within a stage tracks health continuously via `geometry.setDrawRange`
on the branch mesh — the tree loses visible branches from the tips inward as it
declines, and regains them on recovery, without regenerating.

### Health — continuous, plus one threshold

Health score is a blended recent-return percent. Colour, leaf density and canopy
droop interpolate **continuously** in OKLCH along a per-skin ramp — no discrete
jumps. Rough anchors: `+10%` vivid full green · `0%` muted green · `-15%` yellow,
thinning, drooping · `-35%` and below, see fire.

**Fire** is the one real threshold, driven by health with hysteresis so it can't
strobe on a boundary:

| Tier | Turns on at | Clears at | Look |
|---|---|---|---|
| 1 | −35% | −30% | small fire, a few branches |
| 2 | −50% | −45% | fire across the canopy |
| 3 | −75% | −70% | whole tree + ground ablaze |

While burning, foliage in the zone chars to blackened remnants (kept, not
deleted) and the bark darkens. Escalation is immediate and can skip tiers;
de-escalation is one step at a time.

---

## 2. Tree rendering — procedural and seeded

- Trees are generated with [`@dgreenheck/ez-tree`](https://github.com/dgreenheck/ez-tree),
  rendered with React Three Fiber (Three.js / WebGL).
- **Seeded by a hash of the ticker.** `NVDA` produces the same tree on every
  reload and every machine. The shape only changes when structure stage or
  bucketed volatility changes — those are the only inputs that call
  `tree.generate()`.
- `healthScore`, fire and leaf skin are **material / render-state / particle
  overlays only** — they never regenerate the mesh. Colour moves on the live
  materials, branch count via draw-range, fire is an additive-particle overlay.
- Volatility feeds gnarliness (geometry, bucketed) and idle wind sway (a shader
  uniform).
- Art direction is a stylised toon look (flat-shaded `MeshToonMaterial`, a
  4-band gradient ramp, a Blinn sheen term), bloom + vignette post.
- Three leaf skins: default green, cherry blossom, gold. Each has its own leaf
  geometry, placement, palette and health ramp.

Tune any combination live at **`/dev/tree`** — sliders for structure stage and
health score, a skin picker, an all-stages grid, and a plain-language readout of
what the tree is showing and why.

---

## 3. Data

- **Positions** are curated demo data (`src/lib/positions.ts`) — shares, cost
  basis, plant date, and one authored "what this company does" journal note per
  position, chosen to spread the grove across every stage and health state.
- **Current price and today's move** are live from
  [Finnhub](https://finnhub.io) `/quote`, fetched server-side
  (`src/lib/finnhub.ts`). `FINNHUB_API_KEY` lives in `.env.local` / the host's
  env and is never sent to the browser. Batched across all held tickers, cached
  60s while the market is open and 15 min when closed. Also exposed at
  `GET /api/quote?symbols=…`.
- **Seeded per position:** peak return since planting, the recent-trend percent
  that drives health, and volatility. The Finnhub free tier has no historical
  candles, so these can't be derived — they're authored and labelled as such in
  the UI footer.
- **Derivation** (`src/lib/derive.ts`): position + live quote → total return
  (real, from the live price and your cost basis), peak (`max(seeded, live)`),
  structure stage, blended health score, fire tier.
- **No live price is ever fabricated.** When the key is missing or the request
  fails, the tree falls back to the position's dated reference price with a
  visible "prices as of" note.

---

## 4. Stack

- Next.js 16 (App Router, Turbopack) · React 19 · TypeScript
- Tailwind CSS v4 · shadcn/ui (base-nova)
- React Three Fiber v9 · drei · `@react-three/postprocessing` · Three.js · `@dgreenheck/ez-tree`
- No database, no accounts, no telemetry. Deployed on Vercel.

---

## 5. Interface

- **Forest view (`/`)** — every position as a card: ticker, company, total
  return, a structure-stage meter, a health chip tinted by the live canopy
  colour, and today's move or an "on fire" flag. Click to open.
- **Tree view (`/tree/[id]`)** — the tree large and interactive (orbit, skin
  picker), the position panel (shares, cost basis, market value, total return,
  peak), and the journal. Every tree state is also written out in text for
  screen readers; sway and particles respect `prefers-reduced-motion`.
- **`/dev/tree`** — the tuning playground described in §2.

---

## 6. Guardrails

- Never fabricate market data. Missing/failed data falls back to a dated
  reference price with a visible timestamp, never silent stale data shown as
  current.
- No investment advice, predictions, or sentiment-as-signal. Persistent footer:
  "For informational purposes only. Not investment advice."
- Read-only. No trading integration, ever.
- No accounts, no analytics, no third-party tracking.

---

## 7. Decisions

Resolved for this build:

1. **Same ticker bought twice** → one position (combine lots at a weighted
   average cost). Each demo position is a distinct ticker.
2. **Structure scales on total return %**, not absolute dollars — a small
   winning position and a large one grow alike.
3. **A stock held flat does not grow.** Structure is peak return; no return, no
   growth. Time in the market is not a growth input.
4. **A stock that goes to zero** → a stump (the branch die-back floor already
   leaves a stump-sized skeleton at the bottom of the health range).

---

## 8. Designed, not built

Scoped out to ship the visual core as a portfolio piece. Kept here as the
original design intent.

- **Live plant/sell flow** with local persistence — add a position from the UI,
  sell one and leave a stump with rings counting the hold.
- **The journal reasoning engine** — pull company news per ticker, send
  headlines + the actual price move to an LLM, get back a short entry under hard
  honesty constraints (no unsupported causation, no forward-looking claims, no
  buy/sell/hold language, every entry cites working source links, no news → no
  entry), store it so it's never regenerated. Plus a daily forest-level digest.
- **Historical price history** — record a daily snapshot per ticker on first
  fetch each day and build real price history and a genuine "peak since
  planting" over time; a price chart and a growth time-lapse scrubber on the
  tree view.
- **Discrete event visuals** — dividend fruit that falls and piles at the base,
  earnings-beat blossoms, earnings-miss leaf shed, 52-week-high sunbeam, split
  trunk fork, high-volatility gust.
- **Forest environment** — sky/weather from the S&P 500's day, real market-hours
  day/night, soil richness from total portfolio return, optional seasons.
- **One shared 3D forest scene** — all trees on a single ground plane you can
  orbit and walk, instead of a card grid.
- **Structure-stage vegetation** — grass → flowers → pond → fireflies appearing
  from stage 3 up, mutually exclusive with fire.
- **Stage-transition animation** — a 2–3s grow when a tree crosses a stage
  boundary.
