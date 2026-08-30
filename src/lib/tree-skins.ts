/*
 * Leaf skins — stylised (toon) art direction. Adding a new skin (e.g. autumn)
 * is one entry in LEAF_SKINS, no new branches anywhere.
 *
 * Each skin declares its own canopy GEOMETRY, size, placement and rotation
 * (the `leaf` block). The renderer replaces ez-tree's dense billboard leaves
 * with a low-count InstancedMesh of large soft toon forms:
 *   - "blob"    — rounded icosphere clusters (default green)
 *   - "blossom" — 5-petal geometry
 *   - "note"    — flat banknote quad, alpha-cut, gently curled
 *
 * Colour is a flat MeshToonMaterial colour from the health ramp. In the
 * stylised look the ramps are SATURATED and LUMINOUS, not naturalistic:
 * greens push toward teal, pinks stay hot, against the near-black void.
 */

export type SkinId = "default" | "cherry" | "money";
export type LeafKind = "blob" | "blossom" | "note";

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
}

export interface LeafSkin {
  id: SkinId;
  label: string;
  /** alpha-cut PNG for the "note" kind; null otherwise (pure geometry). */
  texture: string | null;
  leaf: LeafGeometry;
  /**
   * three-stop health ramp → flat MeshToonMaterial colour.
   * "thriving" is the vivid luminous colour; it desaturates + dims as health
   * drops.
   */
  ramp: { thriving: string; stressed: string; dying: string };
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
      size: 5.5,
      aspect: 1,
      densityMul: 1,
      branchBias: 0.35,
      windAmp: 0.6,
      emissive: "#0e6b50",
    },
    ramp: { thriving: "#1fbf92", stressed: "#6faa55", dying: "#54542f" },
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
    ramp: { thriving: "#ff8fd6", stressed: "#f0b9d6", dying: "#8f6f88" },
    particleTint: "#ff9ede",
  },
  money: {
    id: "money",
    label: "Money",
    texture: "/textures/leaves/money.png",
    leaf: {
      kind: "note",
      size: 3.4,
      aspect: 2.4,
      densityMul: 0.7,
      branchBias: 0.2,
      windAmp: 1.1,
      emissive: "#0e5a3a",
    },
    ramp: { thriving: "#7fe6a0", stressed: "#bcd6b0", dying: "#8f8f88" },
    particleTint: "#8fe6a8",
  },
};

export const DEFAULT_SKIN: SkinId = "default";

export function getSkin(id: string | undefined): LeafSkin {
  return LEAF_SKINS[(id as SkinId) ?? DEFAULT_SKIN] ?? LEAF_SKINS.default;
}

export const SKIN_LIST: LeafSkin[] = Object.values(LEAF_SKINS);

/* ------------------------------------------------------------------ */

const clamp = (lo: number, hi: number, v: number) =>
  v < lo ? lo : v > hi ? hi : v;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function toRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * healthScore (-1..1) → hex along the skin's own ramp.
 *   dying by ≈ -0.55 · stressed at ≈ -0.15 · thriving by ≈ +0.2
 */
export function skinLeafColor(skin: LeafSkin, healthScore: number): string {
  const h = clamp(-1, 1, healthScore);
  const d = toRgb(skin.ramp.dying);
  const s = toRgb(skin.ramp.stressed);
  const t = toRgb(skin.ramp.thriving);

  let from: [number, number, number];
  let to: [number, number, number];
  let k: number;
  if (h <= -0.55) {
    from = d;
    to = d;
    k = 0;
  } else if (h <= -0.15) {
    from = d;
    to = s;
    k = (h + 0.55) / 0.4;
  } else if (h <= 0.2) {
    from = s;
    to = t;
    k = (h + 0.15) / 0.35;
  } else {
    from = t;
    to = t;
    k = 0;
  }
  const c = (i: number) => Math.round(lerp(from[i], to[i], k));
  return `rgb(${c(0)}, ${c(1)}, ${c(2)})`;
}
