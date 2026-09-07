/*
 * Leaf skins — stylised (toon) art direction. Adding a new skin (e.g. autumn)
 * is one entry in LEAF_SKINS + one row in HEALTH_RAMPS, no new branches anywhere.
 *
 * Each skin declares its own canopy GEOMETRY, size, placement and rotation
 * (the `leaf` block). The renderer replaces ez-tree's dense billboard leaves
 * with a low-count InstancedMesh of large soft toon forms:
 *   - "blob"    — rounded icosphere clusters (default green)
 *   - "blossom" — 5-petal geometry (cherry, and gold — same geometry, warm
 *                 palette + a metallic key-light glint)
 *
 * HEALTH is a wide, multi-channel signal. `healthRamp(skin, pct)` takes a
 * blended recent-return PERCENT (SPEC §2) and returns colour + foliage density
 * + canopy droop + emissive scale together — a dying tree desaturates, dims,
 * droops AND sheds most of its leaves so the bare branch structure shows.
 * Colour is interpolated in OKLCH (perceptually even, no muddy midtones), not
 * RGB. STRUCTURE is deliberately kept out of this file: total return drives
 * tree SIZE only and must never touch colour.
 */

export type SkinId = "default" | "cherry" | "gold";
export type LeafKind = "blob" | "blossom";

/** global stylised palette */
export const BARK_COLOR = "#5b4682"; // luminous violet-brown
export const GROUND_COLOR = "#2a1e46"; // dark violet terrain

export interface LeafGeometry {
  kind: LeafKind;
  /** long dimension of one canopy form, world units — BIG in the stylised look. */
  size: number;
  /** width : height. 1 = round, 2.4 = banknote. */
  aspect: number;
  /** instance-count multiplier (canopy stays sparse — a few dozen forms). */
  densityMul: number;
  /** 0 = out at the branch tips, 1 = tight on the inner/middle branch. */
  branchBias: number;
  /** wind response, multiplies the tree's volatility-driven wind. */
  windAmp: number;
  /** self-glow colour so shadowed toon bands still read against the void. */
  emissive: string;
  /** multiplies the skin's base emissive intensity (gold dials its glow DOWN
   *  so the strong gold/purple complementary contrast doesn't go radioactive). */
  emissiveMul?: number;
  /** blossom skins only: 0 = flat toon; ~0.4 adds a metallic key-light glint
   *  so the leaves read as gold rather than yellow paper. */
  sheen?: number;
}

export interface LeafSkin {
  id: SkinId;
  label: string;
  /** kept for future alpha-cut skins; null = pure geometry (all current skins). */
  texture: string | null;
  leaf: LeafGeometry;
  /** colour for the falling motes on a down day. */
  particleTint: string;
}

export const LEAF_SKINS: Record<SkinId, LeafSkin> = {
  default: {
    id: "default",
    label: "Green",
    texture: null,
    leaf: {
      kind: "blob",
      size: 2, // small clumps — the branch structure must read through
      aspect: 1,
      densityMul: 1,
      branchBias: 0.05, // foliage sits out at the branch tips
      windAmp: 0.6,
      emissive: "#0e6b50",
    },
    particleTint: "#5ff0c0",
  },
  cherry: {
    id: "cherry",
    label: "Cherry blossom",
    texture: null,
    leaf: {
      kind: "blossom",
      size: 2.6,
      aspect: 1,
      densityMul: 1.15,
      branchBias: 0.5,
      windAmp: 0.5,
      emissive: "#a01e6a",
    },
    particleTint: "#ff9ede",
  },
  // Gold — cherry's blossom geometry / clustering / density / placement, with a
  // warm amber-honey palette, a metallic key-light glint, and a dialled-down
  // emissive (gold vs the purple-navy void is a hard complementary contrast).
  gold: {
    id: "gold",
    label: "Gold",
    texture: null,
    leaf: {
      kind: "blossom",
      size: 2.6,
      aspect: 1,
      densityMul: 1.15,
      branchBias: 0.5,
      windAmp: 0.5,
      emissive: "#7a5214", // deep honey-amber
      emissiveMul: 0.42, // gold vs the void pops hard — keep the glow modest
      sheen: 0.34, // low metalness feel — glints on the key light, not chrome
    },
    particleTint: "#ffd66b",
  },
};

export const DEFAULT_SKIN: SkinId = "default";

export function getSkin(id: string | undefined): LeafSkin {
  return LEAF_SKINS[(id as SkinId) ?? DEFAULT_SKIN] ?? LEAF_SKINS.default;
}

export const SKIN_LIST: LeafSkin[] = Object.values(LEAF_SKINS);

/* ================================================================== */
/* HEALTH RAMP — OKLCH anchors defined in PERCENT                      */
/* ================================================================== */

const clamp = (lo: number, hi: number, v: number) =>
  v < lo ? lo : v > hi ? hi : v;
const clamp01 = (v: number) => clamp(0, 1, v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** shortest-path hue interpolation, degrees. */
function lerpHue(h0: number, h1: number, t: number): number {
  const d = (((h1 - h0) % 360) + 540) % 360 - 180;
  return h0 + d * t;
}

/**
 * One stop on a skin's health curve.
 *   at      — blended recent-return percent this anchor is placed at
 *   L, C, H — OKLCH lightness (0..1), chroma, hue (deg)
 *   density — fraction of the (already sparse) canopy that keeps its leaves
 */
export interface HealthAnchor {
  at: number;
  L: number;
  C: number;
  H: number;
  density: number;
}

/*
 * Anchors, per the brief:
 *   +15% or better  vivid saturated, near-luminous, 100% foliage
 *   +5%             healthy
 *    0%             slightly desaturated
 *   -10%            drained, hue shifts toward yellow-green, ~55% foliage
 *   -25%            yellow-orange, ~34% foliage
 *   -40%            brown, ~15% foliage — bare branches show through
 *   -60% or worse   grey-brown, ~5% foliage — a few clinging leaves
 * Sorted DESCENDING by `at`.
 */
export const HEALTH_RAMPS: Record<SkinId, HealthAnchor[]> = {
  default: [
    { at: 15, L: 0.88, C: 0.22, H: 148, density: 1.0 },
    { at: 5, L: 0.76, C: 0.17, H: 146, density: 0.9 },
    { at: 0, L: 0.67, C: 0.12, H: 143, density: 0.78 },
    { at: -10, L: 0.7, C: 0.15, H: 118, density: 0.55 },
    { at: -25, L: 0.67, C: 0.155, H: 85, density: 0.34 },
    { at: -40, L: 0.5, C: 0.09, H: 62, density: 0.15 },
    { at: -60, L: 0.43, C: 0.03, H: 55, density: 0.05 },
  ],
  cherry: [
    { at: 15, L: 0.86, C: 0.16, H: 350, density: 1.0 },
    { at: 5, L: 0.8, C: 0.13, H: 350, density: 0.9 },
    { at: 0, L: 0.75, C: 0.095, H: 352, density: 0.78 },
    { at: -10, L: 0.8, C: 0.05, H: 358, density: 0.55 },
    { at: -25, L: 0.6, C: 0.07, H: 25, density: 0.34 },
    { at: -40, L: 0.46, C: 0.06, H: 45, density: 0.15 },
    { at: -60, L: 0.42, C: 0.022, H: 48, density: 0.05 },
  ],
  // gold: rich saturated gold (warm amber ~83°, NOT lemon ~105°) → pale washed
  // gold → dull bronze-brown. Deeper + more saturated than a yellow.
  gold: [
    { at: 15, L: 0.83, C: 0.155, H: 84, density: 1.0 },
    { at: 5, L: 0.79, C: 0.14, H: 83, density: 0.9 },
    { at: 0, L: 0.75, C: 0.12, H: 82, density: 0.78 },
    { at: -10, L: 0.8, C: 0.075, H: 84, density: 0.55 },
    { at: -25, L: 0.63, C: 0.085, H: 72, density: 0.34 },
    { at: -40, L: 0.46, C: 0.06, H: 60, density: 0.15 },
    { at: -60, L: 0.4, C: 0.03, H: 55, density: 0.05 },
  ],
};

/* ---- OKLCH → sRGB (Björn Ottosson), with a chroma-reduction gamut clip -- */

function oklchToLinearSrgb(L: number, C: number, Hdeg: number): [number, number, number] {
  const h = (Hdeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function inGamut([r, g, b]: [number, number, number]): boolean {
  const e = 1e-4;
  return (
    r >= -e && r <= 1 + e && g >= -e && g <= 1 + e && b >= -e && b <= 1 + e
  );
}

function gammaEncode(c: number): number {
  const v = clamp01(c);
  return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

/** OKLCH → "rgb(r, g, b)" 8-bit string. Out-of-gamut hues lose chroma, not hue. */
export function oklchToCss(L: number, C: number, Hdeg: number): string {
  let lin = oklchToLinearSrgb(L, C, Hdeg);
  if (!inGamut(lin)) {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToLinearSrgb(L, C * mid, Hdeg))) lo = mid;
      else hi = mid;
    }
    lin = oklchToLinearSrgb(L, C * lo, Hdeg);
  }
  const r = Math.round(gammaEncode(lin[0]) * 255);
  const g = Math.round(gammaEncode(lin[1]) * 255);
  const b = Math.round(gammaEncode(lin[2]) * 255);
  return `rgb(${r}, ${g}, ${b})`;
}

/* ---- the resolved health state ---------------------------------------- */

export interface HealthState {
  /** flat MeshToonMaterial colour, OKLCH-interpolated. */
  color: string;
  /** 0..1 — fraction of the sparse canopy that keeps its leaves. */
  density: number;
  /** 0..1 — how far the canopy sags; edge leaves sag most. */
  droop: number;
  /** multiplies each skin's base emissiveIntensity — a dying tree goes dim. */
  emissiveScale: number;
}

function anchorAt(anchors: HealthAnchor[], pct: number): Omit<HealthAnchor, "at"> {
  if (pct >= anchors[0].at) return anchors[0];
  const last = anchors[anchors.length - 1];
  if (pct <= last.at) return last;
  for (let i = 1; i < anchors.length; i++) {
    const hi = anchors[i - 1]; // larger `at`
    const lo = anchors[i]; // smaller `at`
    if (pct >= lo.at) {
      const t = (pct - lo.at) / (hi.at - lo.at); // 0 at lo … 1 at hi
      return {
        L: lerp(lo.L, hi.L, t),
        C: lerp(lo.C, hi.C, t),
        H: lerpHue(lo.H, hi.H, t),
        density: lerp(lo.density, hi.density, t),
      };
    }
  }
  return last;
}

/**
 * Blended recent-return PERCENT → the full health state for `skin`.
 * Structure (total return / tree size) is intentionally not an input here.
 */
export function healthRamp(skin: LeafSkin, pct: number): HealthState {
  const anchors = HEALTH_RAMPS[skin.id] ?? HEALTH_RAMPS.default;
  const a = anchorAt(anchors, pct);
  const density = clamp01(a.density);
  return {
    color: oklchToCss(a.L, a.C, a.H),
    density,
    droop: clamp01((0.82 - density) / 0.82),
    emissiveScale: clamp(0, 1.15, 0.32 + 0.86 * density),
  };
}

const HEALTH_LABELS: [number, string][] = [
  [10, "Thriving"],
  [3, "Healthy"],
  [-3, "Steady"],
  [-15, "Drained"],
  [-32, "Stressed"],
  [-50, "Failing"],
];

/** Blended recent-return percent → a one-word health label. */
export function healthLabelForPercent(pct: number): string {
  for (const [threshold, label] of HEALTH_LABELS) {
    if (pct >= threshold) return label;
  }
  return "Dying";
}

/** Small solid swatch for the skin pickers — the skin's "+6% healthy" colour. */
export function skinSwatch(skin: LeafSkin): string {
  return healthRamp(skin, 6).color;
}
