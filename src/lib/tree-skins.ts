/*
 * Leaf skins. Adding a new skin (e.g. autumn) is one entry in LEAF_SKINS —
 * no new branches anywhere.
 *
 * A skin is NOT just a texture. Each skin declares its own leaf GEOMETRY,
 * PLACEMENT and ROTATION (the `leaf` block below):
 *   - "sprite"  — ez-tree's own billboard leaves, unchanged. We only tint the
 *     material + trim drawRange. No regenerate. (this is "default")
 *   - "blossom" / "note" — ez-tree's leaf mesh is hidden and replaced by our own
 *     InstancedMesh, placed from the tree's leaf-anchor points. See
 *     <SkinnedLeaves> in tree-3d-scene.tsx.
 *
 * `leafSizeMul` still feeds ez-tree's options.leaves.size (sprite only) and so
 * costs one regenerate on change; everything else about a skin is applied live.
 *
 * SPEC §3 conflict, resolved: the "earnings beat → blossoms for 3 days" event
 * is meaningless on a cherry-skinned tree (already all blossom). When events
 * ship (Phase 6): for skin === "cherry" the earnings-beat effect should be a
 * brief sunlit-shimmer / bird instead of blossoms — do NOT stack a blossom
 * overlay. For other skins, a 3-day temporary cherry-blossom overlay is fine.
 */

export type SkinId = "default" | "cherry" | "money";
export type LeafKind = "sprite" | "blossom" | "note";

export interface LeafGeometry {
  kind: LeafKind;
  /** long dimension, world units. */
  size: number;
  /** width : height. 1 = round, 2.4 = banknote. */
  aspect: number;
  /** instance count vs. ez-tree's leaf-anchor count. */
  densityMul: number;
  placement: "even" | "clustered";
  /** clustered only: [min, max] instances per clump. */
  clusterSize: [number, number];
  /** 0 = out at the branch tips, 1 = tight on the inner/middle branch. */
  branchBias: number;
  /** "leaf" = follow the branch; "hang" = dangle from the attach point, spin freely. */
  rotation: "leaf" | "hang";
  /** "leaf" = translucent standard; "paper" = matte, rough, fibre normal map. */
  material: "leaf" | "paper";
  /** wind response, multiplies the tree's volatility-driven wind. */
  windAmp: number;
}

export interface LeafSkin {
  id: SkinId;
  label: string;
  /**
   * public/ URL of the 1024² alpha-cutout PNG. Used by the "sprite" and (as a
   * fallback tint reference) particle systems. `null` = ez-tree's native leaf
   * texture. Ignored by "blossom" (pure geometry).
   */
  texture: string | null;
  /** multiplier on ez-tree's leaf size — GEOMETRY (sprite only; one rebuild). */
  leafSizeMul: number;
  /** health-driven canopy density multiplier — MATERIAL drawRange (sprite only). */
  densityMul: number;
  /** per-skin geometry / placement / rotation. */
  leaf: LeafGeometry;
  /**
   * three-stop health ramp, multiplied onto material.color — MATERIAL. Keep it
   * SUBTLE: "thriving" should be ~white so the texture/geometry colour reads at
   * full richness; only shift + darken as health drops.
   */
  ramp: { thriving: string; stressed: string; dying: string };
  /** tint for the falling / ground scatter on a down day. */
  particleTint: string;
}

export const LEAF_SKINS: Record<SkinId, LeafSkin> = {
  default: {
    id: "default",
    label: "Green",
    texture: null, // ez-tree's native oak leaf texture, untouched
    leafSizeMul: 1,
    densityMul: 1,
    leaf: {
      kind: "sprite",
      size: 2.3,
      aspect: 1,
      densityMul: 1,
      placement: "even",
      clusterSize: [1, 1],
      branchBias: 0,
      rotation: "leaf",
      material: "leaf",
      windAmp: 1,
    },
    ramp: { thriving: "#fbfaf3", stressed: "#d7d0a6", dying: "#7a5f3c" },
    particleTint: "#9db566",
  },
  cherry: {
    id: "cherry",
    label: "Cherry blossom",
    texture: "/textures/leaves/cherry.png",
    leafSizeMul: 0.95,
    densityMul: 1.1,
    leaf: {
      // real 5-petal blossom geometry, tight clumps hugging the inner branch,
      // denser than green, with bare wood showing through at the tips
      kind: "blossom",
      size: 1.7,
      aspect: 1,
      densityMul: 1.2,
      placement: "clustered",
      clusterSize: [3, 6],
      branchBias: 0.55,
      rotation: "leaf",
      material: "leaf",
      windAmp: 0.55,
    },
    ramp: { thriving: "#fbe6ee", stressed: "#e7cdd6", dying: "#8f7168" },
    particleTint: "#f2b6cd",
  },
  money: {
    id: "money",
    label: "Money",
    texture: "/textures/leaves/money.png",
    leafSizeMul: 1.1,
    densityMul: 0.82,
    leaf: {
      // rigid 2.4:1 banknotes, hanging from the attach point, spun to varied
      // angles (some edge-on), sparser than green, matte paper
      kind: "note",
      size: 2.8,
      aspect: 2.4,
      densityMul: 1,
      placement: "even",
      clusterSize: [1, 1],
      branchBias: 0.2,
      rotation: "hang",
      material: "paper",
      windAmp: 1.15,
    },
    ramp: { thriving: "#f2f4ea", stressed: "#cdccb8", dying: "#8f8f88" },
    particleTint: "#9bb886",
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
 * healthScore (-1..1) → hex along the skin's own ramp, multiplied onto the leaf
 * material. Breakpoints lean toward "thriving" so a healthy tree (score ~0.3)
 * sits at ~full texture richness rather than a heavy tint:
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
