"use client";

/* eslint-disable react-hooks/immutability -- R3F is imperative: three.js
   objects (materials, geometry buffers, the ez-tree instance) are mutated in
   effects and the frame loop by design. */

import { Component, type ReactNode, Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Environment, OrbitControls } from "@react-three/drei";
import { DepthOfField, EffectComposer } from "@react-three/postprocessing";
import { Tree } from "@dgreenheck/ez-tree";
import parkHdri from "@pmndrs/assets/hdri/park.exr";

import {
  applyGeometryOptions,
  hashToSeed,
  healthToLeafDensity,
  mulberry32,
  volatilityBucket,
  volatilityToWind,
} from "@/lib/tree3d";
import {
  getSkin,
  type LeafSkin,
  type SkinId,
  skinLeafColor,
} from "@/lib/tree-skins";

export interface Tree3DSceneProps {
  ticker: string;
  structureStage: number;
  healthScore: number;
  volatility: number;
  /** which leaf skin this planting uses */
  skin: SkinId;
  /** true on a down day — spawns falling-leaf particles in the skin's texture */
  shedding?: boolean;
  interactive?: boolean;
}

/* ------------------------------------------------------------------ */
/* leaf-skin textures — loaded once, shared, cheap to swap            */
/* ------------------------------------------------------------------ */

const textureLoader = new THREE.TextureLoader();
const skinTextureCache = new Map<string, THREE.Texture>();

function skinTexture(url: string): THREE.Texture {
  let tex = skinTextureCache.get(url);
  if (!tex) {
    tex = textureLoader.load(url);
    // colour texture, not linear data — without this it renders washed out
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    tex.needsUpdate = true;
    skinTextureCache.set(url, tex);
  }
  return tex;
}

/* ------------------------------------------------------------------ */
/* procedural ground texture (no asset files)                          */
/* ------------------------------------------------------------------ */

function makeGroundTexture(): THREE.Texture {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#5b5138";
  ctx.fillRect(0, 0, size, size);

  const rand = mulberry32(0x5eed);
  // soft earthy blotches
  for (let i = 0; i < 900; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 6 + rand() * 46;
    const tone = rand();
    const col =
      tone < 0.5
        ? `rgba(58, 48, 32, ${0.05 + rand() * 0.12})`
        : tone < 0.85
          ? `rgba(104, 92, 60, ${0.05 + rand() * 0.14})`
          : `rgba(86, 104, 58, ${0.04 + rand() * 0.1})`; // occasional mossy fleck
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // fine grain
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rand() - 0.5) * 26;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(9, 9);
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function Ground() {
  const { gl } = useThree();
  const tex = useMemo(() => {
    const t = makeGroundTexture();
    t.anisotropy = gl.capabilities.getMaxAnisotropy();
    return t;
  }, [gl]);
  useEffect(() => () => tex.dispose(), [tex]);

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
      <circleGeometry args={[70, 72]} />
      <meshStandardMaterial map={tex} roughness={0.97} metalness={0} />
    </mesh>
  );
}

/* ------------------------------------------------------------------ */
/* the ez-tree instance + the geometry/material split                  */
/* ------------------------------------------------------------------ */

const LEAF_INDEX_BLOCK = 6; // two triangles — keep quads intact when shuffling

/**
 * Randomly permute the leaf index buffer (seeded, once per generate) so that
 * later trimming it with drawRange thins the canopy evenly instead of lopping
 * off whichever branches were generated last.
 */
function shuffleLeafIndices(tree: Tree, seed: number): number {
  const geo = tree.leavesMesh.geometry;
  const index = geo.getIndex();
  if (!index) return 0;
  const arr = index.array as Uint16Array | Uint32Array;
  const blocks = Math.floor(arr.length / LEAF_INDEX_BLOCK);
  const rand = mulberry32(seed ^ 0x9e3779b9);
  const Ctor = arr.constructor as Uint16ArrayConstructor | Uint32ArrayConstructor;
  const tmp = new Ctor(LEAF_INDEX_BLOCK);
  for (let i = blocks - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const bi = i * LEAF_INDEX_BLOCK;
    const bj = j * LEAF_INDEX_BLOCK;
    tmp.set(arr.subarray(bi, bi + LEAF_INDEX_BLOCK));
    arr.copyWithin(bi, bj, bj + LEAF_INDEX_BLOCK);
    arr.set(tmp, bj);
  }
  index.needsUpdate = true;
  return blocks * LEAF_INDEX_BLOCK;
}

/** Resolve a skin to its leaf texture — its own PNG, or ez-tree's native one. */
function resolveLeafTexture(
  skin: LeafSkin,
  nativeTex: THREE.Texture | null,
): THREE.Texture | null {
  return skin.texture ? skinTexture(skin.texture) : nativeTex;
}

/**
 * Skin + healthScore → leaf texture, colour, and canopy density. All of it is
 * MATERIAL / drawRange work — no Tree.generate(). (Only the skin's leaf *size*
 * is geometry; that lives in the geometry effect.)
 *
 * The material itself is ez-tree's own MeshPhongMaterial (DoubleSide, dithering,
 * the wind shader, alphaTest from options) — we only mutate map / color /
 * drawRange, never replace it.
 */
function applyLeafMaterial(
  tree: Tree,
  maxLeafIndex: number,
  health: number,
  skin: LeafSkin,
  nativeTex: THREE.Texture | null,
) {
  const mat = tree.leavesMesh.material as THREE.MeshPhongMaterial;
  if (!mat) return;

  const tex = resolveLeafTexture(skin, nativeTex);
  if (tex && mat.map !== tex) {
    mat.map = tex;
    mat.needsUpdate = true;
  }
  // Subtle tint only — a saturated multiply flattens the texture.
  mat.color.set(skinLeafColor(skin, health));
  mat.opacity = health < -0.5 ? 0.94 : 1;
  mat.transparent = mat.opacity < 1;

  const frac = Math.min(1, healthToLeafDensity(health) * skin.densityMul);
  const n =
    Math.floor((maxLeafIndex * frac) / LEAF_INDEX_BLOCK) * LEAF_INDEX_BLOCK;
  tree.leavesMesh.geometry.setDrawRange(0, Math.max(0, n));
}

export interface TreeBounds {
  height: number;
  radius: number;
}

/* ------------------------------------------------------------------ */
/* skinned leaves — per-skin geometry, placement and rotation          */
/* ------------------------------------------------------------------ */

interface LeafAnchor {
  pos: THREE.Vector3;
  up: THREE.Vector3; // along the branch
  normal: THREE.Vector3;
  r: number; // 0 (trunk axis) .. 1 (canopy edge)
  h: number; // 0 (ground) .. 1 (crown top)
}

// Read the attach point + basis of every leaf ez-tree baked, from
// tree.leaves.verts (8 verts / leaf for a Double billboard; first quad is
// v0=top-left v1=bottom-left v2=bottom-right v3=top-right).
function extractLeafAnchors(tree: Tree, bounds: TreeBounds): LeafAnchor[] {
  const v = tree.leaves.verts as number[];
  const n = tree.leaves.normals as number[];
  const stride = 24; // 8 verts * 3
  const out: LeafAnchor[] = [];
  const invR = 1 / Math.max(1, bounds.radius);
  const invH = 1 / Math.max(1, bounds.height);
  for (let i = 0; i + stride <= v.length; i += stride) {
    const v0 = new THREE.Vector3(v[i], v[i + 1], v[i + 2]);
    const v1 = new THREE.Vector3(v[i + 3], v[i + 4], v[i + 5]);
    const v2 = new THREE.Vector3(v[i + 6], v[i + 7], v[i + 8]);
    const v3 = new THREE.Vector3(v[i + 9], v[i + 10], v[i + 11]);
    const pos = v1.clone().add(v2).multiplyScalar(0.5);
    const top = v0.clone().add(v3).multiplyScalar(0.5);
    const up = top.sub(pos).normalize();
    const normal = new THREE.Vector3(n[i], n[i + 1], n[i + 2]).normalize();
    out.push({
      pos,
      up,
      normal,
      r: Math.min(1, Math.hypot(pos.x, pos.z) * invR),
      h: Math.min(1, Math.max(0, pos.y * invH)),
    });
  }
  return out;
}

// 5-petal blossom — real geometry, not a quad. Petal colour + yellow centre are
// baked as vertex colours; material.color (the health ramp) multiplies on top.
function buildBlossomGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const petal = [1.0, 0.55, 0.62]; // warm coral — survives blue skylight as pink
  const centre = [1.0, 0.8, 0.42];
  const push = (
    p: [number, number, number],
    c: number[],
  ) => {
    positions.push(p[0], p[1], p[2]);
    colors.push(c[0], c[1], c[2]);
  };
  // 5 rounded, slightly cupped petals
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    const base: [number, number, number] = [0, 0, 0.07];
    const l: [number, number, number] = [
      Math.cos(a - 0.34) * 0.2,
      Math.sin(a - 0.34) * 0.2,
      0.035,
    ];
    const tl: [number, number, number] = [
      Math.cos(a - 0.14) * 0.48,
      Math.sin(a - 0.14) * 0.48,
      0.005,
    ];
    const tr: [number, number, number] = [
      Math.cos(a + 0.14) * 0.48,
      Math.sin(a + 0.14) * 0.48,
      0.005,
    ];
    const rr: [number, number, number] = [
      Math.cos(a + 0.34) * 0.2,
      Math.sin(a + 0.34) * 0.2,
      0.035,
    ];
    push(base, petal);
    push(l, petal);
    push(tl, petal);
    push(base, petal);
    push(tl, petal);
    push(tr, petal);
    push(base, petal);
    push(tr, petal);
    push(rr, petal);
  }
  // centre disc
  const segs = 8;
  for (let k = 0; k < segs; k++) {
    const a0 = (k / segs) * Math.PI * 2;
    const a1 = ((k + 1) / segs) * Math.PI * 2;
    push([0, 0, 0.09], centre);
    push([Math.cos(a0) * 0.13, Math.sin(a0) * 0.13, 0.05], centre);
    push([Math.cos(a1) * 0.13, Math.sin(a1) * 0.13, 0.05], centre);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

// A single flat petal, for the ground scatter.
function buildPetalGeometry(): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(0.5, 0.32);
  return geo;
}

// Procedural paper-fibre normal map (matte banknote surface).
function makePaperNormalTexture(): THREE.Texture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const rand = mulberry32(0x9a17);
  const height = new Float32Array(size * size);
  for (let i = 0; i < height.length; i++) height[i] = rand();
  // smear horizontally into fibres
  for (let y = 0; y < size; y++) {
    for (let x = 1; x < size; x++) {
      const i = y * size + x;
      height[i] = height[i] * 0.4 + height[i - 1] * 0.6;
    }
  }
  const img = ctx.createImageData(size, size);
  const at = (x: number, y: number) =>
    height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * 2.2;
      const dy = (at(x, y + 1) - at(x, y - 1)) * 2.2;
      const nz = 1;
      const len = Math.hypot(dx, dy, nz);
      const j = (y * size + x) * 4;
      img.data[j] = ((-dx / len) * 0.5 + 0.5) * 255;
      img.data[j + 1] = ((-dy / len) * 0.5 + 0.5) * 255;
      img.data[j + 2] = (nz / len) * 0.5 * 255 + 128;
      img.data[j + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 1);
  return tex;
}

// Wind: rotate the instance about a pivot in the vertex shader (no per-frame
// JS). Blossoms sway from the base (pivot 0); notes swing from the top edge.
function attachWindShader(
  mat: THREE.Material,
  pivotY: number,
  span: number,
  amp: number,
  initialWind: number,
) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.uniforms.uWind = { value: initialWind };
    shader.uniforms.uPivotY = { value: pivotY };
    shader.uniforms.uSpan = { value: span };
    shader.uniforms.uAmp = { value: amp };
    shader.vertexShader =
      "uniform float uTime; uniform float uWind; uniform float uPivotY; uniform float uSpan; uniform float uAmp;\n" +
      shader.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         vec3 iP = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
         float ph = fract(sin(dot(iP.xz, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831853;
         float d = clamp((uPivotY - transformed.y) / uSpan, 0.0, 1.0);
         float sw = uWind * uAmp * (0.55 * sin(uTime * 1.5 + ph) + 0.3 * sin(uTime * 3.3 + ph * 1.7));
         float ang = sw * d;
         vec2 rp = transformed.xy - vec2(0.0, uPivotY);
         rp = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * rp;
         transformed.xy = rp + vec2(0.0, uPivotY);`,
      );
    mat.userData.windShader = shader;
  };
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _tmpQ = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _tmpPos = new THREE.Vector3();

function SkinnedLeaves({
  tree,
  gen,
  skin,
  healthScore,
  volatility,
  bounds,
}: {
  tree: Tree;
  gen: number;
  skin: LeafSkin;
  healthScore: number;
  volatility: number;
  bounds: TreeBounds;
}) {
  const kind = skin.leaf.kind;
  const wind =
    volatilityToWind(volatility) *
    skin.leaf.windAmp *
    (kind === "note" ? 0.16 : 0.1);

  // Build the instanced mesh(es) whenever the tree regenerates or the skin
  // changes. Placement is seeded so it's stable per (tree, skin).
  const built = useMemo(() => {
    const anchors = extractLeafAnchors(tree, bounds);
    if (anchors.length === 0) return null;
    const rand = mulberry32(hashToSeed(`${skin.id}:${gen}`));

    // Shuffle so that hitting the instance cap thins the canopy UNIFORMLY
    // instead of lopping off whichever branches ez-tree generated last (that
    // was the "bare patches on one side" bug).
    const shuffled = anchors.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const t = shuffled[i];
      shuffled[i] = shuffled[j];
      shuffled[j] = t;
    }

    // Keep a HIGH fraction of anchors — coverage first. branchBias only trims
    // the outer third of the canopy, and even there never below ~55%, so the
    // edge is thinner but never empty.
    const bias = skin.leaf.branchBias;
    const dMul = skin.leaf.densityMul;
    const baseKeep = kind === "blossom" ? 0.6 : 0.42;
    const kept: LeafAnchor[] = [];
    for (const a of shuffled) {
      const edgeTrim = 1 - bias * Math.max(0, a.r - 0.35) * 1.1;
      if (rand() < Math.min(1, baseKeep * dMul * Math.max(0.55, edgeTrim)))
        kept.push(a);
    }

    const s = skin.leaf.size;
    const h = s / skin.leaf.aspect;

    let geo: THREE.BufferGeometry;
    let mat: THREE.Material;
    let pivotY: number;
    let span: number;

    if (kind === "blossom") {
      geo = buildBlossomGeometry();
      const m = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.7,
        metalness: 0,
        side: THREE.DoubleSide,
        // self-warmth so the blue skylight doesn't turn petals lavender
        emissive: new THREE.Color("#c02a4e"),
        emissiveIntensity: 0.6,
      });
      m.color.set(skinLeafColor(skin, healthScore));
      mat = m;
      pivotY = 0;
      span = s;
    } else {
      // note — ONE flat quad, gently curled so it reads as paper not card
      geo = new THREE.PlaneGeometry(s, h, 10, 3);
      geo.translate(0, -h / 2, 0); // top edge at origin so it hangs
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const u = p.getX(i) / s; // -0.5 .. 0.5
        const vy = p.getY(i) / h;
        p.setZ(
          i,
          Math.sin(u * Math.PI) * s * 0.05 + Math.sin(vy * Math.PI * 1.6) * s * 0.02,
        );
      }
      geo.computeVertexNormals();
      const m = new THREE.MeshStandardMaterial({
        map: skin.texture ? skinTexture(skin.texture) : null,
        normalMap: makePaperNormalTexture(),
        roughness: 0.98,
        metalness: 0,
        side: THREE.DoubleSide,
        transparent: true,
        alphaTest: 0.45,
        emissive: new THREE.Color("#1f5a34"),
        emissiveIntensity: 0.28,
      });
      m.color.set(skinLeafColor(skin, healthScore));
      mat = m;
      pivotY = 0;
      span = h;
    }
    attachWindShader(mat, pivotY, span, kind === "note" ? 1 : 0.6, wind);

    // instance matrices — generous caps (instanced tris are cheap); the
    // shuffle above makes any cap thinning spatially uniform.
    const matrices: THREE.Matrix4[] = [];
    const clumpMin = skin.leaf.clusterSize[0];
    const clumpMax = skin.leaf.clusterSize[1];
    const cap = kind === "blossom" ? 5200 : 1100;

    for (const a of kept) {
      // inner branches carry bigger clumps; the outer edge still gets 1–2 so
      // there are no holes, just a lighter fringe with wood showing.
      const innerness = 1 - a.r; // 0 at the canopy edge, 1 at the trunk
      let count = 1;
      if (skin.leaf.placement === "clustered") {
        const span01 = clumpMin + (clumpMax - clumpMin) * (0.3 + 0.7 * innerness);
        count = Math.max(1, Math.round(span01 * (0.6 + 0.4 * rand())));
      }
      for (let c = 0; c < count && matrices.length < cap; c++) {
        // always jitter off the exact anchor so big planes never stack
        const jr = count > 1 ? s * 1.3 : s * 0.75;
        _tmpPos.copy(a.pos);
        _tmpPos.addScaledVector(a.up, (rand() - 0.5) * jr * 1.3);
        _tmpPos.addScaledVector(a.normal, (rand() - 0.5) * jr);
        _tmpPos.x += (rand() - 0.5) * jr * 0.6;
        _tmpPos.z += (rand() - 0.5) * jr * 0.6;

        if (kind === "note") {
          // hang from the top edge, tumbled on all three axes, no two alike —
          // enough tilt that some read edge-on, not so much they all do
          _q.setFromEuler(
            new THREE.Euler(
              (rand() - 0.5) * 1.05,
              rand() * Math.PI * 2,
              (rand() - 0.5) * 0.8,
            ),
          );
          _s.set(0.9 + rand() * 0.55, 0.85 + rand() * 0.6, 1);
        } else {
          // blossom: face along a jittered branch normal
          const dir = a.normal
            .clone()
            .lerp(a.up, 0.25)
            .add(
              new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(
                0.6,
              ),
            )
            .normalize();
          _q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
          _q.multiply(
            _tmpQ.setFromAxisAngle(new THREE.Vector3(0, 0, 1), rand() * Math.PI * 2),
          );
          _s.setScalar((0.7 + rand() * 0.6) * (s / 1.5));
        }
        matrices.push(_m.clone().compose(_tmpPos.clone(), _q.clone(), _s.clone()));
      }
    }

    const mesh = new THREE.InstancedMesh(geo, mat, matrices.length);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    for (let i = 0; i < matrices.length; i++) mesh.setMatrixAt(i, matrices[i]);
    mesh.instanceMatrix.needsUpdate = true;

    // ground scatter (cherry only) — a few flat petals near the trunk
    let ground: THREE.InstancedMesh | null = null;
    if (kind === "blossom") {
      const gGeo = buildPetalGeometry();
      const gMat = new THREE.MeshStandardMaterial({
        color: skin.particleTint,
        roughness: 0.9,
        metalness: 0,
        side: THREE.DoubleSide,
      });
      const gn = 26;
      ground = new THREE.InstancedMesh(gGeo, gMat, gn);
      ground.receiveShadow = true;
      for (let i = 0; i < gn; i++) {
        const ang = rand() * Math.PI * 2;
        const rad = Math.sqrt(rand()) * bounds.radius * 0.85;
        _tmpPos.set(Math.cos(ang) * rad, 0.04 + rand() * 0.03, Math.sin(ang) * rad);
        _q.setFromEuler(new THREE.Euler(-Math.PI / 2, rand() * Math.PI * 2, 0));
        _s.setScalar(0.6 + rand() * 0.5);
        ground.setMatrixAt(i, _m.clone().compose(_tmpPos.clone(), _q.clone(), _s.clone()));
      }
      ground.instanceMatrix.needsUpdate = true;
    }

    return { mesh, ground, geo, mat, count: matrices.length };
  }, [tree, gen, skin, bounds.height, bounds.radius]); // eslint-disable-line react-hooks/exhaustive-deps

  // health tint — MATERIAL only, no rebuild
  useEffect(() => {
    if (!built) return;
    (built.mat as THREE.MeshStandardMaterial).color.set(
      skinLeafColor(skin, healthScore),
    );
    if (built.ground) {
      (built.ground.material as THREE.MeshStandardMaterial).color.set(
        skin.particleTint,
      );
    }
  }, [built, skin, healthScore]);

  useEffect(() => {
    return () => {
      if (!built) return;
      built.geo.dispose();
      (built.mat as THREE.Material).dispose();
      built.mesh.dispose();
      if (built.ground) {
        built.ground.geometry.dispose();
        (built.ground.material as THREE.Material).dispose();
        built.ground.dispose();
      }
    };
  }, [built]);

  useFrame((state) => {
    const sh = (built?.mat as THREE.Material | undefined)?.userData
      ?.windShader as
      | { uniforms: Record<string, { value: number }> }
      | undefined;
    if (sh) {
      sh.uniforms.uTime.value = state.clock.elapsedTime;
      sh.uniforms.uWind.value = wind;
    }
  });

  if (!built) return null;
  return (
    <>
      <primitive object={built.mesh} />
      {built.ground && <primitive object={built.ground} />}
    </>
  );
}

function EzTreeObject({
  ticker,
  structureStage,
  healthScore,
  volatility,
  skin: skinId,
  onBounds,
  onNativeLeafTexture,
}: Omit<Tree3DSceneProps, "interactive" | "shedding"> & {
  onBounds: (b: TreeBounds) => void;
  onNativeLeafTexture: (t: THREE.Texture | null) => void;
}) {
  // One imperative THREE.Group for the life of the component. useState's lazy
  // initialiser gives a stable instance; React never reconciles its internals.
  const [tree] = useState(() => new Tree());
  const maxLeafIndexRef = useRef(0);
  const nativeLeafTexRef = useRef<THREE.Texture | null>(null);
  const skin = getSkin(skinId);
  // bumped on every regenerate — SkinnedLeaves re-reads the leaf anchors
  const [gen, setGen] = useState(0);
  const [localBounds, setLocalBounds] = useState<TreeBounds | null>(null);

  const seed = hashToSeed(ticker);
  const volBucket = volatilityBucket(volatility);
  // Quantised volatility feeds geometry so ordinary daily drift within a bucket
  // never triggers a rebuild; the raw value only drives wind (below).
  const bucketedVolatility = volBucket / 8;

  // GEOMETRY — the expensive path. seed / stage / volatility bucket / skin leaf
  // size (the only skin field that is geometry — a skin pick does ONE rebuild).
  useEffect(() => {
    applyGeometryOptions(tree.options, {
      seed,
      structureStage,
      volatility: bucketedVolatility,
      leafSizeMul: skin.leafSizeMul,
    });
    tree.generate();
    maxLeafIndexRef.current = shuffleLeafIndices(tree, seed);
    // ez-tree assigns its native leaf texture (oak) here — grab it before any
    // skin override so the "default" skin can render it untouched.
    nativeLeafTexRef.current =
      (tree.leavesMesh.material as THREE.MeshPhongMaterial).map ?? null;
    onNativeLeafTexture(nativeLeafTexRef.current);
    for (const m of [tree.branchesMesh, tree.leavesMesh]) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
    // non-"sprite" skins replace ez-tree's leaf mesh with <SkinnedLeaves>
    tree.leavesMesh.visible = skin.leaf.kind === "sprite";

    const box = new THREE.Box3().setFromObject(tree);
    const b: TreeBounds = {
      height: Math.max(1, box.max.y),
      radius: Math.max(
        Math.abs(box.max.x),
        Math.abs(box.min.x),
        Math.abs(box.max.z),
        Math.abs(box.min.z),
        1,
      ),
    };
    // Publish the freshly generated geometry's bounds + a rebuild signal to
    // <SkinnedLeaves>. One extra render per actual regenerate — not per frame.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocalBounds(b);
    onBounds(b);
    setGen((g) => g + 1);
  }, [
    tree,
    seed,
    structureStage,
    bucketedVolatility,
    skin,
    onBounds,
    onNativeLeafTexture,
  ]);

  // MATERIAL — skin + healthScore. Texture / tint / drawRange only, no rebuild.
  // For non-sprite skins the ez-tree leaf mesh stays hidden; SkinnedLeaves owns
  // the canopy.
  useEffect(() => {
    tree.leavesMesh.visible = skin.leaf.kind === "sprite";
    if (skin.leaf.kind !== "sprite") return;
    applyLeafMaterial(
      tree,
      maxLeafIndexRef.current,
      healthScore,
      skin,
      nativeLeafTexRef.current,
    );
  }, [tree, healthScore, skin, structureStage, bucketedVolatility]);

  // dispose on unmount
  useEffect(() => {
    return () => {
      tree.branchesMesh.geometry.dispose();
      tree.leavesMesh.geometry.dispose();
      (tree.branchesMesh.material as THREE.Material).dispose();
      (tree.leavesMesh.material as THREE.Material).dispose();
    };
  }, [tree]);

  // WIND — volatility drives the leaf shader's wind strength once it has
  // compiled. Cheap per-frame uniform write; never regenerates.
  useFrame((state) => {
    tree.update(state.clock.elapsedTime);
    const shader = (
      tree.leavesMesh.material as THREE.Material & {
        userData: { shader?: { uniforms: Record<string, { value: unknown }> } };
      }
    ).userData?.shader;
    if (shader?.uniforms?.uWindStrength) {
      const w = volatilityToWind(volatility);
      (shader.uniforms.uWindStrength.value as THREE.Vector3).set(w, 0, w);
    }
  });

  return (
    <>
      <primitive object={tree} />
      {skin.leaf.kind !== "sprite" && localBounds && (
        <SceneErrorBoundary>
          <SkinnedLeaves
            tree={tree}
            gen={gen}
            skin={skin}
            healthScore={healthScore}
            volatility={volatility}
            bounds={localBounds}
          />
        </SceneErrorBoundary>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* camera framing                                                      */
/* ------------------------------------------------------------------ */

function frameCamera(bounds: TreeBounds) {
  const focusY = bounds.height * 0.52;
  const dist =
    Math.max(bounds.height * 1.15, bounds.radius * 2.5) + bounds.height * 0.15 + 4;
  return {
    focusY,
    position: [dist * 0.52, focusY + bounds.height * 0.3, dist] as const,
  };
}

function CameraRig({
  bounds,
  structureStage,
  interactive,
}: {
  bounds: TreeBounds;
  structureStage: number;
  interactive: boolean;
}) {
  const camera = useThree((s) => s.camera);
  const { focusY, position } = frameCamera(bounds);

  // Reframe when the tree changes size (stage) or is first measured. Between
  // those, OrbitControls owns the camera in interactive mode.
  useEffect(() => {
    camera.position.set(...position);
    camera.lookAt(0, focusY, 0);
    camera.updateProjectionMatrix();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, structureStage, bounds.height, bounds.radius]);

  return interactive ? (
    <OrbitControls
      makeDefault
      target={[0, focusY, 0]}
      enablePan={false}
      minDistance={4}
      maxDistance={bounds.height * 4 + 40}
      maxPolarAngle={Math.PI / 2.03}
    />
  ) : null;
}

/* ------------------------------------------------------------------ */
/* falling-leaf particles — down days. Uses the current skin's texture. */
/* ------------------------------------------------------------------ */

function FallingLeaves({
  skin,
  texture,
  healthScore,
  bounds,
}: {
  skin: LeafSkin;
  /** resolved leaf texture (skin PNG, or ez-tree's native one for default) */
  texture: THREE.Texture | null;
  healthScore: number;
  bounds: TreeBounds;
}) {
  const COUNT = 30;
  const spread = Math.max(6, bounds.radius * 1.15);
  const top = Math.max(6, bounds.height * 0.95);

  const [geometry] = useState(() => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(COUNT * 3);
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    return g;
  });
  // per-particle fall speed + horizontal drift phase/amp
  const [drift] = useState(() => {
    const rand = mulberry32(0x1eaf);
    return Array.from({ length: COUNT }, () => ({
      speed: 1.6 + rand() * 2.4,
      phase: rand() * Math.PI * 2,
      amp: 0.4 + rand() * 0.9,
      x: (rand() * 2 - 1) * spread,
      z: (rand() * 2 - 1) * spread,
      y: rand() * top,
    }));
  });

  const [material] = useState(
    () =>
      new THREE.PointsMaterial({
        size: Math.max(0.9, skin.leafSizeMul * 1.4),
        transparent: true,
        alphaTest: 0.35,
        depthWrite: false,
        sizeAttenuation: true,
      }),
  );

  useEffect(() => {
    material.map = texture;
    material.color.set(skinLeafColor(skin, healthScore));
    material.needsUpdate = true;
  }, [material, texture, skin, healthScore]);

  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const pos = geometry.attributes.position.array as Float32Array;
    const t = performance.now() * 0.001;
    for (let i = 0; i < COUNT; i++) {
      const d = drift[i];
      d.y -= d.speed * dt;
      if (d.y < 0.2) {
        d.y = top;
        d.x = (Math.random() * 2 - 1) * spread;
        d.z = (Math.random() * 2 - 1) * spread;
      }
      pos[i * 3] = d.x + Math.sin(t * 1.3 + d.phase) * d.amp;
      pos[i * 3 + 1] = d.y;
      pos[i * 3 + 2] = d.z + Math.cos(t * 1.1 + d.phase) * d.amp;
    }
    geometry.attributes.position.needsUpdate = true;
  });

  return (
    <points geometry={geometry} material={material} frustumCulled={false} />
  );
}

/* ------------------------------------------------------------------ */
/* resilience — a loader/render failure degrades, it doesn't blank      */
/* ------------------------------------------------------------------ */

class SceneErrorBoundary extends Component<
  { children: ReactNode; fallback?: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    console.error("[Tree3D] scene subtree failed:", err);
  }
  render() {
    return this.state.failed ? this.props.fallback ?? null : this.props.children;
  }
}

/* ------------------------------------------------------------------ */
/* scene                                                               */
/* ------------------------------------------------------------------ */

function SceneContents({
  ticker,
  structureStage,
  healthScore,
  volatility,
  skin: skinId,
  shedding = false,
  interactive = false,
}: Tree3DSceneProps) {
  const [bounds, setBounds] = useState<TreeBounds>({ height: 28, radius: 12 });
  const [nativeLeafTex, setNativeLeafTex] = useState<THREE.Texture | null>(null);
  const { focusY } = frameCamera(bounds);
  const skin = getSkin(skinId);

  return (
    <>
      <color attach="background" args={["#d9e6ee"]} />
      <fog
        attach="fog"
        args={["#cbdde8", bounds.height * 2.6, bounds.height * 7]}
      />

      <hemisphereLight args={["#c3d8e8", "#4c4030", 0.6]} />
      <directionalLight
        position={[24, 34, 14]}
        intensity={2.7}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.04}
        shadow-camera-near={1}
        shadow-camera-far={110}
        shadow-camera-left={-45}
        shadow-camera-right={45}
        shadow-camera-top={60}
        shadow-camera-bottom={-6}
      />

      {/* Outdoor HDRI for IBL. Bundled (no network); if it ever fails the
          lights above still carry the scene. */}
      <SceneErrorBoundary>
        <Suspense fallback={null}>
          <Environment files={parkHdri} />
        </Suspense>
      </SceneErrorBoundary>

      <Ground />

      <SceneErrorBoundary>
        <EzTreeObject
          ticker={ticker}
          structureStage={structureStage}
          healthScore={healthScore}
          volatility={volatility}
          skin={skinId}
          onBounds={setBounds}
          onNativeLeafTexture={setNativeLeafTex}
        />
      </SceneErrorBoundary>

      {shedding && (
        <SceneErrorBoundary>
          <FallingLeaves
            skin={skin}
            texture={resolveLeafTexture(skin, nativeLeafTex)}
            healthScore={healthScore}
            bounds={bounds}
          />
        </SceneErrorBoundary>
      )}

      <ContactShadows
        position={[0, 0.015, 0]}
        scale={Math.max(24, bounds.radius * 3.2)}
        resolution={1024}
        blur={3.4}
        far={Math.max(10, bounds.height * 0.55)}
        opacity={0.4}
        color="#241d12"
      />

      <CameraRig
        bounds={bounds}
        structureStage={structureStage}
        interactive={interactive}
      />

      <SceneErrorBoundary>
        <EffectComposer multisampling={4}>
          <DepthOfField
            target={[0, focusY, 0]}
            // keep the whole tree sharp; only the far ground/background falls off
            worldFocusRange={bounds.radius * 2.6 + bounds.height * 0.7}
            focalLength={0.02}
            bokehScale={1.4}
            resolutionScale={1}
          />
        </EffectComposer>
      </SceneErrorBoundary>
    </>
  );
}

export default function Tree3DScene(props: Tree3DSceneProps) {
  return (
    <Canvas
      shadows={{ type: THREE.PCFShadowMap }}
      dpr={[1, 2]}
      gl={{
        antialias: true,
        powerPreference: "high-performance",
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: 1.05,
        outputColorSpace: THREE.SRGBColorSpace,
      }}
      camera={{ fov: 38, near: 0.5, far: 220, position: [18, 16, 26] }}
    >
      <SceneContents {...props} />
    </Canvas>
  );
}
