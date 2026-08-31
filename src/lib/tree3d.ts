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
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function lerpStops(
  stops: readonly (readonly [number, number])[],
  x: number,
): number {
  if (x <= stops[0][0]) return stops[0][1];
  const last = stops[stops.length - 1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < stops.length; i++) {
    const [x1, y1] = stops[i];
    if (x <= x1) {
      const [x0, y0] = stops[i - 1];
      return lerp(y0, y1, (x - x0) / (x1 - x0));
    }
  }
  return last[1];
}

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
  { levels: 2, len: 16, radius: 0.8, children: [5, 4, 0], leafCount: 13, leafSize: 2.0, leafStart: 0.22 },
  { levels: 3, len: 25, radius: 1.5, children: [6, 5, 4], leafCount: 20, leafSize: 2.3, leafStart: 0.18 },
  { levels: 3, len: 34, radius: 2.2, children: [7, 5, 4], leafCount: 26, leafSize: 2.5, leafStart: 0.15 },
  { levels: 3, len: 43, radius: 3.2, children: [7, 6, 5], leafCount: 32, leafSize: 2.7, leafStart: 0.13 },
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
/* MATERIAL — no regeneration                                          */
/* ------------------------------------------------------------------ */

// Leaf colour is now per-skin — see skinLeafColor() in lib/tree-skins.ts.

/** Fraction of leaves to draw (via drawRange), by health. */
export function healthToLeafDensity(healthScore: number): number {
  return lerpStops(
    [
      [-1, 0.08],
      [-0.6, 0.2],
      [-0.2, 0.5],
      [0, 0.72],
      [0.3, 0.9],
      [1, 1],
    ],
    clamp(-1, 1, healthScore),
  );
}

/** Absolute value for the leaf shader's uWindStrength (x and z). */
export function volatilityToWind(volatility: number): number {
  return 0.35 + clamp01(volatility) * 2.45;
}

/* ------------------------------------------------------------------ */
/* health scalar helpers (shared with the detail view)                 */
/* ------------------------------------------------------------------ */

/** Blended recent-return percent (SPEC §2) → healthScore in [-1, 1]. */
export function healthPercentToUnit(pct: number): number {
  if (pct <= 0) return clamp(-1, 0, pct / 20);
  return clamp(0, 1, pct / 10);
}

export function healthLabelForUnit(u: number): string {
  if (u > 0.6) return "Thriving";
  if (u > 0.15) return "Healthy";
  if (u >= -0.15) return "Steady";
  if (u >= -0.5) return "Stressed";
  if (u >= -0.8) return "Wilting";
  return "Dying";
}
