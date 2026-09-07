/*
 * Mapping layer between Grove's domain values and @dgreenheck/ez-tree's
 * TreeOptions (see node_modules/@dgreenheck/ez-tree/src/lib/options.js).
 *
 * The split that matters:
 *   - GEOMETRY params (seed, structureStage, volatility→gnarliness) feed
 *     applyGeometryOptions() and require Tree.generate() — the expensive path.
 *   - MATERIAL params (healthScore → leaf colour + density, volatility → wind)
 *     are applied to the live meshes every render with NO regeneration.
 */

const clamp = (lo: number, hi: number, v: number) =>
  v < lo ? lo : v > hi ? hi : v;
const clamp01 = (v: number) => clamp(0, 1, v);

/* ------------------------------------------------------------------ */
/* seed                                                                */
/* ------------------------------------------------------------------ */

/** Stable 32-bit seed from a ticker — FNV-1a. Same ticker → same tree. */
export function hashToSeed(ticker: string): number {
  let h = 2166136261 >>> 0;
  const s = ticker.toUpperCase();
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ */
/* GEOMETRY — needs Tree.generate()                                    */
/* ------------------------------------------------------------------ */

export interface TreeGeometryInputs {
  seed: number;
  /** 0 (seed) – 5 (elder). */
  structureStage: number;
  /** 0 – 1. Elevated 20-day stdev → a gnarlier, wilder tree. */
  volatility: number;
  /** skin's leaf-size multiplier — baked into billboard geometry. */
  leafSizeMul: number;
}

interface StageGeom {
  levels: number;
  len: number;
  radius: number;
  children: [number, number, number];
  leafCount: number;
  leafSize: number;
  leafStart: number;
}

// One row per structureStage. leafCount is the MAX for the stage; healthScore
// thins it at render time via geometry.drawRange, never by regenerating.
const STAGE_GEOM: StageGeom[] = [
  { levels: 0, len: 2.4, radius: 0.24, children: [0, 0, 0], leafCount: 4, leafSize: 1.1, leafStart: 0 },
  { levels: 1, len: 8.5, radius: 0.38, children: [3, 0, 0], leafCount: 7, leafSize: 1.5, leafStart: 0.08 },
  { levels: 2, len: 16, radius: 0.8, children: [5, 4, 0], leafCount: 14, leafSize: 2.0, leafStart: 0.22 },
  { levels: 3, len: 25, radius: 1.5, children: [6, 5, 4], leafCount: 22, leafSize: 2.3, leafStart: 0.18 },
  // leafCount is PER max-level branch — bumped at the top stages so the canopy
  // supply keeps pace with the bigger branch structure (old trees = full crown).
  { levels: 3, len: 34, radius: 2.2, children: [7, 5, 4], leafCount: 34, leafSize: 2.5, leafStart: 0.15 },
  { levels: 3, len: 43, radius: 3.2, children: [7, 6, 5], leafCount: 46, leafSize: 2.7, leafStart: 0.13 },
];

export function stageIndex(structureStage: number): number {
  return clamp(0, 5, Math.round(structureStage));
}

/**
 * Quantised volatility. Gnarliness is geometry, so a change here forces a
 * regenerate — bucket it so ordinary daily drift doesn't.
 */
export function volatilityBucket(volatility: number): number {
  return Math.round(clamp01(volatility) * 8);
}

/** Mutates ez-tree's `tree.options` in place with geometry params. */
export function applyGeometryOptions(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  o: any,
  { seed, structureStage, volatility, leafSizeMul }: TreeGeometryInputs,
): void {
  const g = STAGE_GEOM[stageIndex(structureStage)];
  const gnarl = 0.5 + clamp01(volatility) * 3.1;

  o.seed = seed;
  o.type = "deciduous";

  o.bark.type = "oak";
  o.bark.tint = 0xffffff;
  o.bark.textured = true;
  o.bark.flatShading = false;
  o.bark.textureScale = { x: 2, y: Math.max(4, g.len / 3) };

  o.branch.levels = g.levels;
  o.branch.angle = { 1: 58, 2: 52, 3: 44 };
  o.branch.children = { 0: g.children[0], 1: g.children[1], 2: g.children[2] };
  o.branch.force = { direction: { x: 0, y: 1, z: 0 }, strength: 0.012 };
  o.branch.gnarliness = {
    0: 0.03 * gnarl,
    1: 0.08 * gnarl,
    2: 0.16 * gnarl,
    3: 0.04 * gnarl,
  };
  o.branch.length = {
    0: g.len,
    1: g.len * 0.42,
    2: g.len * 0.34,
    3: g.len * 0.2,
  };
  o.branch.radius = {
    0: g.radius,
    1: g.radius * 0.52,
    2: g.radius * 0.38,
    3: g.radius * 0.28,
  };
  o.branch.sections = { 0: 10, 1: 8, 2: 6, 3: 4 };
  o.branch.segments = { 0: 9, 1: 6, 2: 5, 3: 3 };
  o.branch.start = { 1: 0.4, 2: 0.3, 3: 0.3 };
  o.branch.taper = { 0: 0.72, 1: 0.62, 2: 0.66, 3: 0.7 };
  o.branch.twist = {
    0: 0.02 * gnarl,
    1: 0.03 * gnarl,
    2: 0.05 * gnarl,
    3: 0,
  };

  o.leaves.type = "oak"; // texture is overridden per skin on the material
  o.leaves.billboard = "double";
  o.leaves.angle = 40;
  o.leaves.count = g.leafCount;
  o.leaves.start = g.leafStart;
  o.leaves.size = g.leafSize * leafSizeMul;
  o.leaves.sizeVariance = 0.7;
  o.leaves.tint = 0xffffff; // real colour is set on the material at runtime
  o.leaves.alphaTest = 0.5; // ez-tree's default — crisp cutout edge
}

/** Roughly where the visual centre of the canopy sits, in world units. */
export function focusHeight(structureStage: number): number {
  return 2.4 + stageIndex(structureStage) * 2.05;
}

/* ------------------------------------------------------------------ */
/* MATERIAL / RENDER-STATE — no regeneration                           */
/* ------------------------------------------------------------------ */

// Health is a wide multi-channel signal. COLOUR + leaf density + canopy droop
// come from healthRamp() in lib/tree-skins.ts (OKLCH, fully continuous). The
// two channels below are shared across skins (they act on the tree skeleton,
// not the foliage) so they live here.

/** Piecewise-linear interpolation over (x, y) stops sorted ascending by x. */
function lerpStops(
  stops: readonly (readonly [number, number])[],
  x: number,
): number {
  if (x <= stops[0][0]) return stops[0][1];
  const last = stops[stops.length - 1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < stops.length; i++) {
    if (x <= stops[i][0]) {
      const [x0, y0] = stops[i - 1];
      const [x1, y1] = stops[i];
      return y0 + (y1 - y0) * ((x - x0) / (x1 - x0));
    }
  }
  return last[1];
}

/**
 * Fraction of the branch index buffer to draw, by health percent. CONTINUOUS —
 * branches hold until about -8%, then die back from the tips inward (trimming
 * the tail of the index buffer, which ez-tree fills tip-last). Render-state
 * only via geometry.setDrawRange — never a regenerate.
 *   anchors: ~-10% branch count just starts moving · -25% clearly thinned ·
 *            -40% skeletal · -60% a stump.
 */
export function healthToBranchKeep(pct: number): number {
  return lerpStops(
    [
      [-60, 0.22], // a stump, but still enough of a tree to be on fire
      [-40, 0.46],
      [-25, 0.68],
      [-10, 0.9],
      [-8, 1],
      [100, 1],
    ],
    pct,
  );
}

/* ------------------------------------------------------------------ */
/* FIRE — a real threshold, driven by health, with hysteresis          */
/* ------------------------------------------------------------------ */

/** Health percent at/below which fire tier 1 / 2 / 3 turns ON. */
export const FIRE_TRIGGERS = [-35, -50, -75] as const;
/** Fire clears once health recovers past its trigger by this margin. */
export const FIRE_HYSTERESIS = 5;

export const FIRE_TIER_LABELS = [
  "none",
  "small — a few branches",
  "large — across the canopy",
  "inferno — tree + ground",
] as const;

/**
 * New fire tier (0-3) from the current health percent and the PREVIOUSLY active
 * tier. Escalation is immediate and can skip tiers; de-escalation is one step
 * at a time and only once health has recovered past `trigger + FIRE_HYSTERESIS`,
 * so a value oscillating on a boundary can't strobe.
 */
export function resolveFireTier(pct: number, prevTier: number): number {
  let t = clamp(0, 3, Math.round(prevTier));
  while (t < 3 && pct <= FIRE_TRIGGERS[t]) t++;
  while (t > 0 && pct >= FIRE_TRIGGERS[t - 1] + FIRE_HYSTERESIS) t--;
  return t;
}

/**
 * 0..1 "how burnt". Near-total from the first tier up: if a tree is on fire its
 * foliage in the burn zone is scorched — the canopy chars to blackened remnants
 * (kept, not deleted) and the bark darkens.
 */
export function fireChar(tier: number): number {
  return [0, 0.85, 0.95, 1][clamp(0, 3, Math.round(tier))];
}

/** Absolute value for the leaf shader's uWindStrength (x and z). */
export function volatilityToWind(volatility: number): number {
  return 0.35 + clamp01(volatility) * 2.45;
}

/* ------------------------------------------------------------------ */
/* plain-language readout of what the tree is showing and why          */
/* ------------------------------------------------------------------ */

const STAGE_NOUN = [
  "seed",
  "sprout",
  "sapling",
  "young tree",
  "mature tree",
  "elder tree",
];

/**
 * One or two sentences describing the tree's current state in plain terms —
 * structure (size = best total return since planting, only grows) and health
 * (colour / foliage / fire = recent performance, moves fast).
 */
export function describeTree(
  pct: number,
  structureStage: number,
  fireTier: number,
): string {
  const s = stageIndex(structureStage);
  const size =
    s === 0
      ? "A seed, just planted."
      : `A ${STAGE_NOUN[s]} — its size is the position's best total return since planting, and only ever grows.`;

  const down = Math.round(Math.abs(pct));
  const up = Math.round(pct);
  let state: string;
  if (fireTier > 0) {
    const scale =
      fireTier === 1
        ? "a few branches have"
        : fireTier === 2
          ? "the canopy has"
          : "the whole tree and the ground around it have";
    state = `The stock is down ${down}% over the recent window — a severe drawdown, so ${scale} caught fire. The foliage has burned to blackened remnants and the branches are charring; the fire only clears once the stock recovers about 5% past the level that lit it.`;
  } else if (pct <= -25) {
    state = `Down ${down}% recently: the leaves have turned yellow-orange and thinned, and the branches are dying back from the tips.`;
  } else if (pct <= -10) {
    state = `Down ${down}% recently: the green is draining toward yellow, leaves are dropping, and the canopy sags.`;
  } else if (pct < 3) {
    state = `Roughly flat lately (${up >= 0 ? "+" : ""}${up}%): a steady, slightly muted green canopy.`;
  } else if (pct < 12) {
    state = `Up ${up}% recently: a full, healthy green canopy.`;
  } else {
    state = `Up ${up}% recently: the canopy is vivid, near-luminous and completely full.`;
  }

  return `${size} ${state}`;
}
