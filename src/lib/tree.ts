/*
 * Procedural tree geometry (SPEC §7).
 *
 * Pure and deterministic: the shape is a function of (ticker, structureStage,
 * healthScore) only. All randomness comes from a hash of the ticker, so NVDA
 * always grows the exact same tree on every reload and every machine.
 *
 * Hydration safety — two rules, both load-bearing:
 *   1. Anything that decides element COUNT or STRUCTURE (which clusters render,
 *      back vs. front layer, leaves per cluster) uses only integer RNG math and
 *      +-*\/ on exact inputs. Never Math.pow / trig / non-const sqrt there.
 *   2. Every COORDINATE that reaches an SVG string goes through q(). Math.sin/
 *      cos/atan2 are not bit-identical between Node and browsers; rounding to
 *      2dp collapses the difference before React can see a mismatch.
 */

export type StructureStage = 0 | 1 | 2 | 3 | 4 | 5;

const DEG = Math.PI / 180;
const UP = -Math.PI / 2; // SVG y-down, so "up" is negative
const TWO_PI = Math.PI * 2;

// Da Vinci's rule: cross-sectional area is conserved across a fork.
// w_child = w_parent * sqrt(share), with shares 0.63 / 0.37 (sum = 1).
const SQRT_SHARE_DOMINANT = 0.793725; // sqrt(0.63)
const SQRT_SHARE_SUBORDINATE = 0.608276; // sqrt(0.37)

// SPEC §7 branching constants — kept exact.
const ANGLE_DOMINANT = 10 * DEG;
const ANGLE_SUBORDINATE = 35 * DEG;
const LEN_DOMINANT = 0.83;
const LEN_SUBORDINATE = 0.62;

// Pull toward vertical each generation. Without it the recursion reads as a
// fractal diagram rather than a tree. Applied harder to structural branches
// (near the trunk) than to twigs, which are allowed to wander.
const TROPISM = 0.09;

const MAX_LEAVES = 200; // SPEC §7 performance ceiling, per tree

/* ------------------------------------------------------------------ */
/* seeded RNG — integer math only, identical on every engine           */
/* ------------------------------------------------------------------ */

function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Rng {
  next: () => number;
  range: (lo: number, hi: number) => number;
  /** multiplier in [1-amt, 1+amt] */
  jitter: (amt: number) => number;
  sign: () => number;
  chance: (p: number) => boolean;
  int: (loInclusive: number, hiInclusive: number) => number;
}

function makeRng(seedStr: string): Rng {
  const seed = xmur3(seedStr);
  const rand = mulberry32(seed());
  return {
    next: rand,
    range: (lo, hi) => lo + (hi - lo) * rand(),
    jitter: (amt) => 1 - amt + 2 * amt * rand(),
    sign: () => (rand() < 0.5 ? -1 : 1),
    chance: (p) => rand() < p,
    int: (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1)),
  };
}

/* ------------------------------------------------------------------ */
/* quantisation + small math helpers                                   */
/* ------------------------------------------------------------------ */

const QUANT = 100; // 2 decimal places
export const q = (n: number) => Math.round(n * QUANT) / QUANT;

const clamp = (lo: number, hi: number, v: number) =>
  v < lo ? lo : v > hi ? hi : v;
const clamp01 = (v: number) => clamp(0, 1, v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Piecewise-linear interpolation over sorted [x, y] stops. Deterministic. */
function lerpStops(stops: readonly (readonly [number, number])[], x: number): number {
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

function normalizeAngle(a: number): number {
  while (a > Math.PI) a -= TWO_PI;
  while (a < -Math.PI) a += TWO_PI;
  return a;
}

function towardVertical(angle: number, k: number = TROPISM): number {
  return angle + normalizeAngle(UP - angle) * k;
}

/* ------------------------------------------------------------------ */
/* colour                                                              */
/* ------------------------------------------------------------------ */

interface HSL {
  h: number;
  s: number;
  l: number;
}

const hsl = ({ h, s, l }: HSL) => `hsl(${q(h)} ${q(s)}% ${q(l)}%)`;

const BARK: HSL = { h: 28, s: 26, l: 30 };
const BARK_GREEN: HSL = { h: 96, s: 40, l: 38 }; // sprout stem
const DEAD: HSL = { h: 38, s: 8, l: 44 }; // grey, sun-bleached

// Leaf base colour across healthScore: brown -> amber -> yellow-green -> green.
const LEAF_STOPS: { at: number; c: HSL }[] = [
  { at: -1.0, c: { h: 26, s: 36, l: 29 } },
  { at: -0.5, c: { h: 40, s: 50, l: 36 } },
  { at: -0.15, c: { h: 68, s: 52, l: 42 } },
  { at: 0.15, c: { h: 96, s: 48, l: 39 } },
  { at: 0.5, c: { h: 122, s: 46, l: 35 } },
  { at: 1.0, c: { h: 138, s: 50, l: 33 } },
];

function leafBaseColor(health: number): HSL {
  const h = clamp(-1, 1, health);
  for (let i = 1; i < LEAF_STOPS.length; i++) {
    const a = LEAF_STOPS[i - 1];
    const b = LEAF_STOPS[i];
    if (h <= b.at) {
      const t = (h - a.at) / (b.at - a.at);
      return {
        h: lerp(a.c.h, b.c.h, t),
        s: lerp(a.c.s, b.c.s, t),
        l: lerp(a.c.l, b.c.l, t),
      };
    }
  }
  return LEAF_STOPS[LEAF_STOPS.length - 1].c;
}

function towardDead(c: HSL, k: number): HSL {
  return {
    h: lerp(c.h, DEAD.h, k),
    s: lerp(c.s, DEAD.s, k),
    l: lerp(c.l, DEAD.l, k),
  };
}

// Atmospheric perspective for the back depth layer.
function recede(c: HSL): HSL {
  return { h: c.h, s: c.s * 0.5, l: lerp(c.l, 80, 0.38) };
}

/* ------------------------------------------------------------------ */
/* public shape types                                                  */
/* ------------------------------------------------------------------ */

export interface BranchShape {
  d: string;
  fill: string;
}

export interface LeafShape {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  angle: number;
  fill: string;
}

export interface TreeGeometry {
  kind: "tree" | "seed";
  viewBox: string;
  backBranches: BranchShape[];
  frontBranches: BranchShape[];
  backLeaves: LeafShape[];
  frontLeaves: LeafShape[];
  seed?: { mound: string; sprout: string };
  /** rough leaf-fill count, for debugging the budget */
  leafCount: number;
}

/* ------------------------------------------------------------------ */
/* per-stage structural parameters                                     */
/* ------------------------------------------------------------------ */

const STAGE = {
  maxDepth: [0, 2, 4, 7, 8, 9],
  trunkLength: [0, 26, 46, 68, 86, 102],
  trunkWidth: [0, 4, 10, 18, 30, 46],
} as const;

/* ------------------------------------------------------------------ */
/* branch outline — a tapered, curved, filled path                     */
/* ------------------------------------------------------------------ */

interface Outline {
  d: string;
  tipX: number;
  tipY: number;
  tipAngle: number;
}

function branchOutline(
  baseX: number,
  baseY: number,
  angle: number,
  length: number,
  wBase: number,
  wTip: number,
  curveMag: number,
): Outline {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const px = -dy; // left perpendicular
  const py = dx;

  const midX = baseX + dx * length * 0.5;
  const midY = baseY + dy * length * 0.5;
  const straightTipX = baseX + dx * length;
  const straightTipY = baseY + dy * length;

  // bend the branch by pushing the centreline off the straight line
  const ctrlX = midX + px * curveMag * 1.15;
  const ctrlY = midY + py * curveMag * 1.15;
  const tipX = straightTipX + px * curveMag;
  const tipY = straightTipY + py * curveMag;

  const tipAngle = Math.atan2(tipY - ctrlY, tipX - ctrlX);
  const tdx = Math.cos(tipAngle);
  const tdy = Math.sin(tipAngle);
  const tpx = -tdy;
  const tpy = tdx;

  const midAngle = (angle + tipAngle) * 0.5;
  const cpx = -Math.sin(midAngle);
  const cpy = Math.cos(midAngle);
  const wMid = (wBase + wTip) * 0.5;

  // outline: up the left edge (base -> ctrl -> tip), across the tip,
  // back down the right edge (tip -> ctrl -> base).
  const bLx = baseX + px * wBase * 0.5;
  const bLy = baseY + py * wBase * 0.5;
  const bRx = baseX - px * wBase * 0.5;
  const bRy = baseY - py * wBase * 0.5;
  const cLx = ctrlX + cpx * wMid * 0.5;
  const cLy = ctrlY + cpy * wMid * 0.5;
  const cRx = ctrlX - cpx * wMid * 0.5;
  const cRy = ctrlY - cpy * wMid * 0.5;
  const tLx = tipX + tpx * wTip * 0.5;
  const tLy = tipY + tpy * wTip * 0.5;
  const tRx = tipX - tpx * wTip * 0.5;
  const tRy = tipY - tpy * wTip * 0.5;

  const d =
    `M ${q(bLx)} ${q(bLy)} ` +
    `Q ${q(cLx)} ${q(cLy)} ${q(tLx)} ${q(tLy)} ` +
    `L ${q(tRx)} ${q(tRy)} ` +
    `Q ${q(cRx)} ${q(cRy)} ${q(bRx)} ${q(bRy)} Z`;

  return { d, tipX, tipY, tipAngle };
}

/* ------------------------------------------------------------------ */
/* build                                                               */
/* ------------------------------------------------------------------ */

interface BuildCtx {
  rng: Rng;
  stage: number;
  maxDepth: number;
  minLength: number;
  bark: HSL;
  deadness: number; // 0..1
  curveLo: number;
  curveHi: number;
  mirror: number; // +1 or -1, per tree — flips all left/right choices
  backBranches: BranchShape[];
  frontBranches: BranchShape[];
  tips: { x: number; y: number; angle: number; z: number; scale: number }[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function expand(ctx: BuildCtx, x: number, y: number) {
  if (x < ctx.minX) ctx.minX = x;
  if (y < ctx.minY) ctx.minY = y;
  if (x > ctx.maxX) ctx.maxX = x;
  if (y > ctx.maxY) ctx.maxY = y;
}

function branchColor(ctx: BuildCtx, depth: number, z: number): HSL {
  const tipT = clamp01((ctx.maxDepth - depth) / Math.max(1, ctx.maxDepth));
  let c = ctx.bark;
  if (ctx.deadness > 0) {
    c = towardDead(c, ctx.deadness * (0.25 + 0.75 * tipT));
  }
  if (z < 0) c = recede(c);
  return c;
}

function clampZ(z: number) {
  return clamp(-1, 1, z);
}

function grow(
  ctx: BuildCtx,
  x: number,
  y: number,
  angle: number,
  length: number,
  width: number,
  depth: number,
  z: number,
) {
  const { rng } = ctx;
  const terminal = depth <= 0 || length < ctx.minLength;

  // 0 at the trunk, 1 at the twigs
  const tipT = clamp01((ctx.maxDepth - depth) / Math.max(1, ctx.maxDepth));

  // structural branches barely bend; twigs are allowed to wander
  const curveMag =
    length *
    rng.range(ctx.curveLo, ctx.curveHi) *
    rng.sign() *
    ctx.mirror *
    (0.3 + 0.7 * tipT);
  const wTip = terminal
    ? Math.max(width * 0.28, 0.5)
    : width * SQRT_SHARE_DOMINANT;

  const outline = branchOutline(x, y, angle, length, width, wTip, curveMag);
  (z < 0 ? ctx.backBranches : ctx.frontBranches).push({
    d: outline.d,
    fill: hsl(branchColor(ctx, depth, z)),
  });
  expand(ctx, x, y);
  expand(ctx, outline.tipX, outline.tipY);

  if (terminal) {
    ctx.tips.push({
      x: outline.tipX,
      y: outline.tipY,
      angle: outline.tipAngle,
      z,
      scale: 1,
    });
    return;
  }

  // canopy fill: the last couple of generations also carry a lighter cluster
  if (depth <= 2) {
    ctx.tips.push({
      x: outline.tipX,
      y: outline.tipY,
      angle: outline.tipAngle,
      z,
      scale: 0.72,
    });
  }

  const subSide = rng.sign() * ctx.mirror;
  // straighten structural branches hard, let twigs wander for a wider crown
  const trop = TROPISM * (1.3 - 0.9 * tipT);
  const domAngle = towardVertical(
    outline.tipAngle - subSide * ANGLE_DOMINANT * rng.jitter(0.5),
    trop,
  );
  const subAngle = towardVertical(
    outline.tipAngle + subSide * ANGLE_SUBORDINATE * rng.jitter(0.35),
    trop,
  );

  const zDrift = () => rng.range(-0.16, 0.16) + (rng.chance(0.2) ? rng.sign() * 0.5 : 0);

  grow(
    ctx,
    outline.tipX,
    outline.tipY,
    domAngle,
    length * LEN_DOMINANT * rng.jitter(0.12),
    width * SQRT_SHARE_DOMINANT,
    depth - 1,
    clampZ(z + zDrift()),
  );
  grow(
    ctx,
    outline.tipX,
    outline.tipY,
    subAngle,
    length * LEN_SUBORDINATE * rng.jitter(0.14),
    width * SQRT_SHARE_SUBORDINATE,
    depth - 1,
    clampZ(z + zDrift()),
  );

  // extra mid-branch shoot to fill the crown (bigger trees only)
  if (ctx.stage >= 2 && depth >= 1 && rng.chance(0.62)) {
    grow(
      ctx,
      lerp(x, outline.tipX, 0.68),
      lerp(y, outline.tipY, 0.68),
      towardVertical(
        outline.tipAngle +
          rng.sign() * ctx.mirror * ANGLE_SUBORDINATE * 1.15 * rng.jitter(0.3),
        trop,
      ),
      length * 0.46 * rng.jitter(0.2),
      width * 0.46,
      depth - 1,
      clampZ(z + rng.range(-0.3, 0.3)),
    );
  }
}

function buildLeaves(
  ctx: BuildCtx,
  health: number,
): { back: LeafShape[]; front: LeafShape[]; count: number } {
  const { rng } = ctx;
  const density = clamp01(
    lerpStops(
      [
        [-1, 0.05],
        [-0.6, 0.18],
        [-0.2, 0.46],
        [0, 0.72],
        [0.3, 0.9],
        [1, 1],
      ],
      health,
    ),
  );
  const base = leafBaseColor(health);

  // leaf size scales with the tree, then eases off
  const size = clamp(4.5, 9, STAGE.trunkLength[ctx.stage] * 0.085);

  const kept: typeof ctx.tips = [];
  for (const tip of ctx.tips) {
    if (rng.chance(density)) kept.push(tip);
  }

  let per = rng.int(4, 6);
  if (kept.length * per > MAX_LEAVES) {
    per = Math.max(1, Math.floor(MAX_LEAVES / Math.max(1, kept.length)));
  }

  const back: LeafShape[] = [];
  const front: LeafShape[] = [];

  for (const tip of kept) {
    const clusterSize = size * tip.scale;
    // elongate the cluster back down the branch so foliage rides the outer
    // canopy instead of sitting in a pom-pom at the very tip
    const bx = Math.cos(tip.angle + Math.PI);
    const by = Math.sin(tip.angle + Math.PI);
    for (let i = 0; i < per; i++) {
      const a = rng.range(0, TWO_PI);
      const spread = clusterSize * rng.range(0.3, 1.35);
      const along = clusterSize * rng.range(-0.4, 2.1);
      const cx = tip.x + Math.cos(a) * spread + bx * along;
      const cy = tip.y + Math.sin(a) * spread + by * along - clusterSize * 0.2;
      const rx = clusterSize * rng.range(0.55, 1.0);
      const ry = rx * rng.range(0.42, 0.62);
      const angle = rng.range(0, 180);

      let c: HSL = {
        h: base.h + rng.range(-8, 8),
        s: clamp(14, 82, base.s + rng.range(-8, 10)),
        l: clamp(14, 68, base.l + rng.range(-9, 11)),
      };
      if (tip.z < 0) c = recede(c);

      const leaf: LeafShape = {
        cx: q(cx),
        cy: q(cy),
        rx: q(rx),
        ry: q(ry),
        angle: q(angle),
        fill: hsl(c),
      };
      expand(ctx, cx - rx, cy - ry);
      expand(ctx, cx + rx, cy + ry);
      (tip.z < 0 ? back : front).push(leaf);
    }
  }

  return { back, front, count: back.length + front.length };
}

/* ------------------------------------------------------------------ */
/* entry point                                                         */
/* ------------------------------------------------------------------ */

export function buildTreeGeometry(
  ticker: string,
  structureStage: number,
  healthScore: number,
): TreeGeometry {
  const stage = clamp(0, 5, Math.round(structureStage));
  const health = clamp(-1, 1, healthScore);
  const rng = makeRng(`grove::${ticker.toUpperCase()}::${stage}`);

  if (stage === 0) {
    // seed in soil — no tree yet
    return {
      kind: "seed",
      viewBox: "-60 -46 120 92",
      backBranches: [],
      frontBranches: [],
      backLeaves: [],
      frontLeaves: [],
      leafCount: 0,
      seed: {
        mound: "M -52 18 Q 0 -20 52 18 Q 0 34 -52 18 Z",
        sprout: "M 0 16 Q 6 2 0 -12 Q -6 2 0 16 Z",
      },
    };
  }

  const ctx: BuildCtx = {
    rng,
    stage,
    maxDepth: STAGE.maxDepth[stage],
    minLength: 3,
    bark: stage === 1 ? BARK_GREEN : BARK,
    deadness: clamp01((-health - 0.12) / 0.88),
    curveLo: stage >= 4 ? 0.09 : 0.06,
    curveHi: stage >= 4 ? 0.28 : 0.19,
    mirror: rng.next() < 0.5 ? 1 : -1,
    backBranches: [],
    frontBranches: [],
    tips: [],
    minX: 0,
    minY: 0,
    maxX: 0,
    maxY: 0,
  };

  grow(
    ctx,
    0,
    0,
    UP + rng.range(-0.04, 0.04) * ctx.mirror,
    STAGE.trunkLength[stage] * rng.jitter(0.06),
    STAGE.trunkWidth[stage],
    ctx.maxDepth,
    0.15,
  );

  const leaves = buildLeaves(ctx, health);

  const w = ctx.maxX - ctx.minX;
  const h = ctx.maxY - ctx.minY;
  const pad = Math.max(w, h) * 0.08 + 6;
  const viewBox = `${q(ctx.minX - pad)} ${q(ctx.minY - pad)} ${q(w + pad * 2)} ${q(
    h + pad * 2,
  )}`;

  return {
    kind: "tree",
    viewBox,
    backBranches: ctx.backBranches,
    frontBranches: ctx.frontBranches,
    backLeaves: leaves.back,
    frontLeaves: leaves.front,
    leafCount: leaves.count,
  };
}

/* ------------------------------------------------------------------ */
/* health helpers (shared with the detail view)                        */
/* ------------------------------------------------------------------ */

/** Blended recent-return percent (SPEC §2) -> Tree healthScore in [-1, 1]. */
export function healthPercentToUnit(pct: number): number {
  if (pct <= 0) return clamp(-1, 0, pct / 20); // -20% -> -1
  return clamp(0, 1, pct / 10); // +10% -> +1
}

export function healthLabelForUnit(u: number): string {
  if (u > 0.6) return "Thriving";
  if (u > 0.15) return "Healthy";
  if (u >= -0.15) return "Steady";
  if (u >= -0.5) return "Stressed";
  if (u >= -0.8) return "Wilting";
  return "Dying";
}
