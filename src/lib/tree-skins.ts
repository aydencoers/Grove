/*
 * Leaf skins. Adding a new skin (e.g. autumn) is one entry in LEAF_SKINS —
 * no new branches anywhere.
 *
 * ez-tree check (node_modules/@dgreenheck/ez-tree/src/lib/tree.js): the leaf
 * TEXTURE is `mat.map` in createLeavesGeometry — a MATERIAL property. Swapping
 * it does not require Tree.generate(). Same for the colour ramp (mat.color) and
 * density (geometry.drawRange). Only `leafSizeMul` touches geometry
 * (options.leaves.size is baked into the billboard verts), so switching skins
 * does ONE rebuild — acceptable because skin is a set-once-per-planting
 * preference, not a daily value like healthScore.
 *
 * SPEC §3 conflict, resolved: the "earnings beat → blossoms for 3 days" event
 * is meaningless on a cherry-skinned tree (already all blossom). When events
 * ship (Phase 6): for skin === "cherry" the earnings-beat effect should be a
 * brief sunlit-shimmer / bird instead of blossoms — do NOT stack a blossom
 * overlay. For other skins, a 3-day temporary cherry-blossom overlay is fine.
 */

export type SkinId = "default" | "cherry" | "money";

export interface LeafSkin {
  id: SkinId;
  label: string;
  /** public/ URL of the 1024² alpha PNG (matches ez-tree's own leaf textures). */
  texture: string;
  /** multiplier on the stage's base leaf size — GEOMETRY (one rebuild on change). */
  leafSizeMul: number;
  /** multiplier on the health-driven canopy density — MATERIAL (drawRange, no rebuild). */
  densityMul: number;
  /** three-stop health ramp, multiplied onto material.color — MATERIAL (no rebuild). */
  ramp: { thriving: string; stressed: string; dying: string };
  /** tint for the falling-leaf particles on a down day. */
  particleTint: string;
}

export const LEAF_SKINS: Record<SkinId, LeafSkin> = {
  default: {
    id: "default",
    label: "Green",
    texture: "/textures/leaves/default.png",
    leafSizeMul: 1,
    densityMul: 1,
    ramp: { thriving: "#eef4d8", stressed: "#c9cf86", dying: "#6f5230" },
    particleTint: "#8fae5a",
  },
  cherry: {
    id: "cherry",
    label: "Cherry blossom",
    texture: "/textures/leaves/cherry.png",
    leafSizeMul: 0.9,
    densityMul: 1.15,
    ramp: { thriving: "#ffc2da", stressed: "#f1dde3", dying: "#8a6a5c" },
    particleTint: "#f4a9c4",
  },
  money: {
    id: "money",
    label: "Money",
    texture: "/textures/leaves/money.png",
    leafSizeMul: 1.15,
    densityMul: 0.78,
    ramp: { thriving: "#e2f0d6", stressed: "#c3c6b0", dying: "#8f8f8a" },
    particleTint: "#8caf78",
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
 * healthScore (-1..1) → hex colour along the skin's own ramp.
 * dying by ≈ -0.6, stressed around 0, thriving by ≈ +0.5.
 */
export function skinLeafColor(skin: LeafSkin, healthScore: number): string {
  const h = clamp(-1, 1, healthScore);
  const d = toRgb(skin.ramp.dying);
  const s = toRgb(skin.ramp.stressed);
  const t = toRgb(skin.ramp.thriving);

  let from: [number, number, number];
  let to: [number, number, number];
  let k: number;
  if (h <= -0.6) {
    from = d;
    to = d;
    k = 0;
  } else if (h <= 0) {
    from = d;
    to = s;
    k = (h + 0.6) / 0.6;
  } else if (h <= 0.5) {
    from = s;
    to = t;
    k = h / 0.5;
  } else {
    from = t;
    to = t;
    k = 0;
  }
  const c = (i: number) => Math.round(lerp(from[i], to[i], k));
  return `rgb(${c(0)}, ${c(1)}, ${c(2)})`;
}
