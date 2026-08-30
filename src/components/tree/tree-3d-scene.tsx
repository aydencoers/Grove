"use client";

/* eslint-disable react-hooks/immutability -- R3F is imperative: three.js
   objects (materials, geometry buffers, the ez-tree instance) are mutated in
   effects and the frame loop by design. */

import {
  Component,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, OrbitControls } from "@react-three/drei";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { Tree } from "@dgreenheck/ez-tree";

import {
  applyGeometryOptions,
  hashToSeed,
  healthToLeafDensity,
  mulberry32,
  volatilityBucket,
  volatilityToWind,
} from "@/lib/tree3d";
import {
  BARK_COLOR,
  GROUND_COLOR,
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
  /** true on a down day — spawns falling foliage motes in the skin's colour */
  shedding?: boolean;
  interactive?: boolean;
}

/* ------------------------------------------------------------------ */
/* stylised toon shading — one shared 4-band gradient map              */
/* ------------------------------------------------------------------ */

const toonGradient = (() => {
  // 4 hard steps → flat toon bands
  const data = new Uint8Array([40, 110, 190, 255]);
  const t = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
  t.minFilter = THREE.NearestFilter;
  t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
})();

function toonMaterial(opts: {
  color: string;
  emissive?: string;
  emissiveIntensity?: number;
  transparent?: boolean;
  alphaTest?: number;
  map?: THREE.Texture | null;
  vertexColors?: boolean;
  flatShading?: boolean;
}): THREE.MeshToonMaterial {
  const m = new THREE.MeshToonMaterial({
    color: new THREE.Color(opts.color),
    gradientMap: toonGradient,
    side: THREE.DoubleSide,
    transparent: opts.transparent ?? false,
    alphaTest: opts.alphaTest ?? 0,
    map: opts.map ?? null,
    vertexColors: opts.vertexColors ?? false,
  });
  if (opts.flatShading) (m as unknown as { flatShading: boolean }).flatShading = true;
  if (opts.emissive) {
    m.emissive = new THREE.Color(opts.emissive);
    m.emissiveIntensity = opts.emissiveIntensity ?? 0.3;
  }
  return m;
}

/**
 * Mount "grow-in": an eased scale from ~0.82 to 1 over ~0.5s. Used on a
 * wrapper group so a stage change reads as a soft cross-fade against the dark
 * void without touching material transparency (which fought the overlapping
 * toon geometry).
 */
function useMountGrow(durationSec = 0.5) {
  const startRef = useRef<number | null>(null);
  return (elapsed: number) => {
    if (startRef.current === null) startRef.current = elapsed;
    const t = Math.min(1, (elapsed - startRef.current) / durationSec);
    const e = 1 - Math.pow(1 - t, 3); // ease-out cubic
    return 0.82 + 0.18 * e;
  };
}

/* ------------------------------------------------------------------ */
/* leaf-skin textures (money note still uses one)                      */
/* ------------------------------------------------------------------ */

const textureLoader = new THREE.TextureLoader();
const skinTextureCache = new Map<string, THREE.Texture>();

function skinTexture(url: string): THREE.Texture {
  let tex = skinTextureCache.get(url);
  if (!tex) {
    tex = textureLoader.load(url);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    skinTextureCache.set(url, tex);
  }
  return tex;
}

/* ------------------------------------------------------------------ */
/* stylised ground — flat toon disc with soft radial colour banding    */
/* ------------------------------------------------------------------ */

function Ground({ radius }: { radius: number }) {
  const geo = useMemo(() => {
    const g = new THREE.CircleGeometry(radius, 96);
    const pos = g.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const inner = new THREE.Color(GROUND_COLOR);
    const outer = new THREE.Color(GROUND_COLOR).multiplyScalar(0.4);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const r = Math.hypot(pos.getX(i), pos.getY(i)) / radius;
      // quantise into 3 soft bands
      const band = Math.round(r * 3) / 3;
      c.copy(inner).lerp(outer, band);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    return g;
  }, [radius]);

  const mat = useMemo(
    () => toonMaterial({ color: "#ffffff", vertexColors: true }),
    [],
  );
  useEffect(() => () => {
    geo.dispose();
    mat.dispose();
  }, [geo, mat]);

  return (
    <mesh
      geometry={geo}
      material={mat}
      rotation={[-Math.PI / 2, 0, 0]}
      receiveShadow
    />
  );
}

/* ------------------------------------------------------------------ */
/* floating motes — slow upward drift around the tree                  */
/* ------------------------------------------------------------------ */

// soft round sprite so points don't render as hard squares
const moteSprite = (() => {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.4, "rgba(255,255,255,0.5)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  return t;
})();

function Motes({ bounds }: { bounds: TreeBounds }) {
  const COUNT = 70;
  const spread = Math.max(8, bounds.radius * 1.5);
  const top = Math.max(10, bounds.height * 1.25);
  const moteSize = THREE.MathUtils.clamp(bounds.height * 0.02, 0.12, 0.4);

  const [geometry] = useState(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(COUNT * 3), 3),
    );
    return g;
  });
  const [drift] = useState(() => {
    const rand = mulberry32(0x310e5);
    return Array.from({ length: COUNT }, () => ({
      x: (rand() * 2 - 1) * spread,
      z: (rand() * 2 - 1) * spread,
      y: rand() * top,
      speed: 0.15 + rand() * 0.4,
      phase: rand() * Math.PI * 2,
      amp: 0.3 + rand() * 0.8,
    }));
  });
  const [material] = useState(
    () =>
      new THREE.PointsMaterial({
        size: moteSize,
        map: moteSprite,
        color: new THREE.Color("#d4f2ff"),
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
      }),
  );
  useEffect(() => {
    material.size = moteSize;
  }, [material, moteSize]);
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
      d.y += d.speed * dt;
      if (d.y > top) {
        d.y = 0.2;
        d.x = (Math.random() * 2 - 1) * spread;
        d.z = (Math.random() * 2 - 1) * spread;
      }
      pos[i * 3] = d.x + Math.sin(t * 0.4 + d.phase) * d.amp;
      pos[i * 3 + 1] = d.y;
      pos[i * 3 + 2] = d.z + Math.cos(t * 0.35 + d.phase) * d.amp;
    }
    geometry.attributes.position.needsUpdate = true;
  });

  return <points geometry={geometry} material={material} frustumCulled={false} />;
}

/* ------------------------------------------------------------------ */
/* leaf anchors from ez-tree's baked leaf quads                        */
/* ------------------------------------------------------------------ */

export interface TreeBounds {
  height: number;
  radius: number;
}

interface LeafAnchor {
  pos: THREE.Vector3;
  up: THREE.Vector3;
  normal: THREE.Vector3;
  r: number; // 0 trunk axis .. 1 canopy edge
  h: number; // 0 ground .. 1 crown top
}

function extractLeafAnchors(tree: Tree, bounds: TreeBounds): LeafAnchor[] {
  const v = tree.leaves.verts as number[];
  const n = tree.leaves.normals as number[];
  const stride = 24; // 8 verts * 3 (Double billboard)
  const out: LeafAnchor[] = [];
  const invR = 1 / Math.max(1, bounds.radius);
  const invH = 1 / Math.max(1, bounds.height);
  for (let i = 0; i + stride <= v.length; i += stride) {
    const v0 = new THREE.Vector3(v[i], v[i + 1], v[i + 2]);
    const v1 = new THREE.Vector3(v[i + 3], v[i + 4], v[i + 5]);
    const v2 = new THREE.Vector3(v[i + 6], v[i + 7], v[i + 8]);
    const v3 = new THREE.Vector3(v[i + 9], v[i + 10], v[i + 11]);
    const pos = v1.clone().add(v2).multiplyScalar(0.5);
    const up = v0.clone().add(v3).multiplyScalar(0.5).sub(pos).normalize();
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

/* ------------------------------------------------------------------ */
/* per-skin canopy geometry                                            */
/* ------------------------------------------------------------------ */

// deliberately faceted low-poly clump — strongly lumped so the silhouette is
// irregular, not a sphere. Material renders it flat-shaded.
function buildBlobGeometry(seed = 0xb10b): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 2);
  const p = g.attributes.position;
  const rand = mulberry32(seed);
  // a few random low-frequency bumps
  const bumps = Array.from({ length: 5 }, () => ({
    dir: new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize(),
    amp: 0.22 + rand() * 0.4,
    sharp: 2 + rand() * 3,
  }));
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.set(p.getX(i), p.getY(i), p.getZ(i)).normalize();
    let r = 1;
    for (const b of bumps) r += b.amp * Math.pow(Math.max(0, v.dot(b.dir)), b.sharp);
    p.setXYZ(i, v.x * r, v.y * r, v.z * r);
  }
  g.computeVertexNormals();
  return g;
}

// 5-petal blossom, rounded
function buildBlossomGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    const base: [number, number, number] = [0, 0, 0.14];
    const l: [number, number, number] = [
      Math.cos(a - 0.36) * 0.34,
      Math.sin(a - 0.36) * 0.34,
      0.06,
    ];
    const tl: [number, number, number] = [
      Math.cos(a - 0.16) * 0.62,
      Math.sin(a - 0.16) * 0.62,
      0,
    ];
    const tr: [number, number, number] = [
      Math.cos(a + 0.16) * 0.62,
      Math.sin(a + 0.16) * 0.62,
      0,
    ];
    const rr: [number, number, number] = [
      Math.cos(a + 0.36) * 0.34,
      Math.sin(a + 0.36) * 0.34,
      0.06,
    ];
    positions.push(...base, ...l, ...tl, ...base, ...tl, ...tr, ...base, ...tr, ...rr);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  return geo;
}

function buildNoteGeometry(w: number, h: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h, 8, 2);
  g.translate(0, -h / 2, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) / w;
    p.setZ(i, Math.sin(u * Math.PI) * w * 0.06);
  }
  g.computeVertexNormals();
  return g;
}

/* wind: rotate an instance about a pivot in the vertex shader */
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
         float sw = uWind * uAmp * (0.55 * sin(uTime * 1.4 + ph) + 0.3 * sin(uTime * 3.1 + ph * 1.7));
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
const _p = new THREE.Vector3();
const _radial = new THREE.Vector3();
const _zAxis = new THREE.Vector3(0, 0, 1);
const _yAxis = new THREE.Vector3(0, 1, 0);

function SkinnedCanopy({
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
    volatilityToWind(volatility) * skin.leaf.windAmp * (kind === "note" ? 0.14 : 0.08);
  const healthDensity = healthToLeafDensity(healthScore);

  const built = useMemo(() => {
    const anchors = extractLeafAnchors(tree, bounds);
    if (anchors.length === 0) return null;
    const rand = mulberry32(hashToSeed(`${skin.id}:${gen}`));

    // shuffle so a cap trims uniformly, never one-sided
    for (let i = anchors.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const t = anchors[i];
      anchors[i] = anchors[j];
      anchors[j] = t;
    }

    // Stylised low-count canopy. Money keeps more instances (notes are big and
    // must not look detached) — its own multiplier, not the shared one.
    const perKind = kind === "blob" ? 0.02 : kind === "blossom" ? 0.05 : 0.06;
    const capKind = kind === "blob" ? 78 : kind === "blossom" ? 260 : 300;
    const target = Math.round(
      THREE.MathUtils.clamp(
        anchors.length * perKind * skin.leaf.densityMul * (0.5 + 0.5 * healthDensity),
        8,
        capKind,
      ),
    );
    const bias = skin.leaf.branchBias;
    const kept: LeafAnchor[] = [];
    for (const a of anchors) {
      if (kept.length >= target) break;
      const edgeTrim = 1 - bias * Math.max(0, a.r - 0.3) * 1.1;
      if (rand() < Math.max(0.4, edgeTrim)) kept.push(a);
    }

    const sizeFit =
      kind === "blob" ? bounds.radius * 0.4 : bounds.radius * 0.26;
    const s = THREE.MathUtils.clamp(sizeFit, 1.2, skin.leaf.size);
    const h = s / skin.leaf.aspect;

    let geo: THREE.BufferGeometry;
    let mat: THREE.MeshToonMaterial;
    const pivotY = 0;
    let span = s;

    if (kind === "blob") {
      geo = buildBlobGeometry();
      mat = toonMaterial({
        color: skinLeafColor(skin, healthScore),
        emissive: skin.leaf.emissive,
        emissiveIntensity: 0.16,
        flatShading: true,
      });
    } else if (kind === "blossom") {
      geo = buildBlossomGeometry();
      mat = toonMaterial({
        color: skinLeafColor(skin, healthScore),
        emissive: skin.leaf.emissive,
        emissiveIntensity: 0.42,
      });
    } else {
      geo = buildNoteGeometry(s, h);
      mat = toonMaterial({
        color: skinLeafColor(skin, healthScore),
        map: skin.texture ? skinTexture(skin.texture) : null,
        alphaTest: 0.45, // hard cutout — no blending, no sort issues
        emissive: skin.leaf.emissive,
        emissiveIntensity: 0.22,
      });
      span = h;
    }
    attachWindShader(mat, pivotY, span, kind === "note" ? 1 : 0.5, wind);

    // money: a short stem connects each note to the branch so it hangs rather
    // than floats
    const stemGeo =
      kind === "note" ? new THREE.CylinderGeometry(0.045, 0.06, 1, 5) : null;
    const stemMat = stemGeo
      ? toonMaterial({ color: BARK_COLOR, emissive: "#241640", emissiveIntensity: 0.4 })
      : null;
    const stemMatrices: THREE.Matrix4[] = [];

    const matrices: THREE.Matrix4[] = [];
    for (const a of kept) {
      _p.copy(a.pos);

      if (kind === "note") {
        // attach on the branch, drop a short stem, hang the note from its top
        _radial.set(a.pos.x, 0, a.pos.z).normalize();
        _p.addScaledVector(a.up, (rand() - 0.5) * s * 0.5);
        _p.addScaledVector(_radial, (rand() - 0.2) * s * 0.35);
        const attach = _p.clone();
        const stemLen = s * (0.22 + rand() * 0.3);
        const pivot = attach
          .clone()
          .add(
            new THREE.Vector3(
              (rand() - 0.5) * 0.3,
              -stemLen,
              (rand() - 0.5) * 0.3,
            ),
          );
        // stem: default cylinder is +Y, centred — put it between attach & pivot
        const dir = pivot.clone().sub(attach);
        const len = dir.length();
        _q.setFromUnitVectors(_yAxis, dir.clone().normalize());
        _s.set(1, len, 1);
        stemMatrices.push(
          _m.clone().compose(
            attach.clone().lerp(pivot, 0.5),
            _q.clone(),
            _s.clone(),
          ),
        );
        // note hangs from `pivot`, mostly upright, free spin, wind swings it
        _q.setFromEuler(
          new THREE.Euler(
            (rand() - 0.5) * 0.28,
            rand() * Math.PI * 2,
            (rand() - 0.5) * 0.22,
          ),
        );
        _s.set(0.9 + rand() * 0.45, 0.9 + rand() * 0.4, 1);
        matrices.push(_m.clone().compose(pivot, _q.clone(), _s.clone()));
        continue;
      }

      // blossom + blob share an irregular offset
      _p.addScaledVector(a.up, (rand() - 0.5) * s * 1.3);
      _p.addScaledVector(a.normal, (rand() - 0.5) * s * 0.9);

      if (kind === "blossom") {
        const dir = a.normal
          .clone()
          .lerp(a.up, 0.25)
          .add(
            new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(
              0.5,
            ),
          )
          .normalize();
        _q.setFromUnitVectors(_zAxis, dir);
        _q.multiply(_tmpQ.setFromAxisAngle(_zAxis, rand() * Math.PI * 2));
        _s.setScalar(s * (0.8 + rand() * 0.5));
      } else {
        // blob — deliberate faceted clump. Big scale spread (~4x) + a radial
        // shove so some poke past the crown → notched, asymmetric silhouette.
        _radial.set(a.pos.x, 0.15, a.pos.z).normalize();
        _p.addScaledVector(_radial, (rand() - 0.4) * s * 1.1);
        _q.setFromEuler(
          new THREE.Euler(rand() * Math.PI, rand() * Math.PI, rand() * Math.PI),
        );
        const base = s * (0.34 + rand() * rand() * 1.5);
        _s.set(base * (0.75 + rand() * 0.5), base * (0.75 + rand() * 0.5), base);
      }
      matrices.push(_m.clone().compose(_p.clone(), _q.clone(), _s.clone()));
    }

    const mesh = new THREE.InstancedMesh(geo, mat, matrices.length);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    for (let i = 0; i < matrices.length; i++) mesh.setMatrixAt(i, matrices[i]);
    mesh.instanceMatrix.needsUpdate = true;

    let stems: THREE.InstancedMesh | null = null;
    if (stemGeo && stemMat && stemMatrices.length) {
      stems = new THREE.InstancedMesh(stemGeo, stemMat, stemMatrices.length);
      stems.castShadow = true;
      stems.frustumCulled = false;
      for (let i = 0; i < stemMatrices.length; i++)
        stems.setMatrixAt(i, stemMatrices[i]);
      stems.instanceMatrix.needsUpdate = true;
    }

    return { mesh, stems, geo, mat, stemGeo, stemMat, count: matrices.length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree, gen, skin, bounds.height, bounds.radius]);

  useEffect(() => {
    if (built) built.mat.color.set(skinLeafColor(skin, healthScore));
  }, [built, skin, healthScore]);

  useEffect(() => {
    return () => {
      if (!built) return;
      built.geo.dispose();
      built.mat.dispose();
      built.mesh.dispose();
      built.stemGeo?.dispose();
      built.stemMat?.dispose();
      built.stems?.dispose();
    };
  }, [built]);

  useFrame((state) => {
    const sh = built?.mat.userData?.windShader as
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
      {built.stems && <primitive object={built.stems} />}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* falling motes on a down day                                         */
/* ------------------------------------------------------------------ */

function FallingFoliage({
  skin,
  healthScore,
  bounds,
}: {
  skin: LeafSkin;
  healthScore: number;
  bounds: TreeBounds;
}) {
  const COUNT = 26;
  const spread = Math.max(6, bounds.radius * 1.1);
  const top = Math.max(6, bounds.height * 0.95);

  const [geometry] = useState(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(COUNT * 3), 3),
    );
    return g;
  });
  const [drift] = useState(() => {
    const rand = mulberry32(0x1eaf);
    return Array.from({ length: COUNT }, () => ({
      speed: 1.4 + rand() * 2,
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
        size: 0.6,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
      }),
  );
  useEffect(() => {
    material.color.set(skinLeafColor(skin, healthScore));
  }, [material, skin, healthScore]);
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
      pos[i * 3] = d.x + Math.sin(t * 1.2 + d.phase) * d.amp;
      pos[i * 3 + 1] = d.y;
      pos[i * 3 + 2] = d.z + Math.cos(t * 1.05 + d.phase) * d.amp;
    }
    geometry.attributes.position.needsUpdate = true;
  });

  return <points geometry={geometry} material={material} frustumCulled={false} />;
}

/* ------------------------------------------------------------------ */
/* seed + sprout — hand-authored, NOT the ez-tree generator            */
/* ------------------------------------------------------------------ */

const soilGeo = (() => {
  const g = new THREE.IcosahedronGeometry(1, 2);
  const p = g.attributes.position;
  const rand = mulberry32(0x50a1);
  for (let i = 0; i < p.count; i++) {
    const bump = 1 + (rand() - 0.5) * 0.12;
    p.setXYZ(i, p.getX(i) * bump, p.getY(i) * bump, p.getZ(i) * bump);
  }
  g.computeVertexNormals();
  return g;
})();

// a rounded, pointed leaf blade in the XY plane, base at y≈-0.5, tip at y≈0.75
function buildLeafGeometry(): THREE.BufferGeometry {
  const N = 8;
  const L: [number, number, number][] = [];
  const R: [number, number, number][] = [];
  for (let i = 0; i < N; i++) {
    const f = i / (N - 1);
    const y = -0.5 + 1.25 * f;
    const w = 0.5 * Math.pow(Math.sin(f * Math.PI), 0.7); // 0 → wide → 0
    const cup = -0.12 * Math.sin(f * Math.PI); // slight curl toward viewer
    L.push([-w, y, cup]);
    R.push([w, y, cup]);
  }
  const pos: number[] = [];
  for (let i = 0; i < N - 1; i++) {
    pos.push(...L[i], ...R[i], ...L[i + 1]);
    pos.push(...R[i], ...R[i + 1], ...L[i + 1]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

function SeedForm({
  skin,
  onBounds,
}: {
  skin: LeafSkin;
  onBounds: (b: TreeBounds) => void;
}) {
  const moundR = 3.8;
  const seedS = 1.6;
  const mats = useMemo(
    () => ({
      soil: toonMaterial({
        color: "#392b54",
        emissive: "#180f30",
        emissiveIntensity: 0.35,
        flatShading: true,
      }),
      seed: toonMaterial({
        color: "#caa14c",
        emissive: skin.leaf.emissive,
        emissiveIntensity: 0.35,
        flatShading: true,
      }),
    }),
    [skin],
  );
  useEffect(() => {
    onBounds({ height: moundR * 0.6, radius: moundR });
  }, [onBounds]);
  useEffect(() => () => {
    mats.soil.dispose();
    mats.seed.dispose();
  }, [mats]);

  const grow = useMountGrow();
  const grpRef = useRef<THREE.Group>(null);
  useFrame((state) => {
    const et = state.clock.elapsedTime;
    if (grpRef.current) {
      grpRef.current.scale.setScalar((1 + Math.sin(et * 0.7) * 0.02) * grow(et));
    }
  });

  return (
    <group ref={grpRef}>
      {/* low dome poking up through the ground disc */}
      <mesh
        geometry={soilGeo}
        material={mats.soil}
        position={[0, -moundR * 0.32, 0]}
        scale={[moundR, moundR * 0.5, moundR]}
        receiveShadow
        castShadow
      />
      {/* seed, lower half nestled into the mound, tilted */}
      <mesh
        geometry={soilGeo}
        material={mats.seed}
        position={[0.2, moundR * 0.1, 0]}
        rotation={[0.42, 0.3, 0.66]}
        scale={[seedS * 0.6, seedS * 0.9, seedS * 0.6]}
        castShadow
      />
    </group>
  );
}

function SproutForm({
  skin,
  healthScore,
  volatility,
  onBounds,
}: {
  skin: LeafSkin;
  healthScore: number;
  volatility: number;
  onBounds: (b: TreeBounds) => void;
}) {
  const moundR = 2.8;
  const stemH = 2.9;
  const leafS = 2.0; // oversized for a sprout, but still 3 distinct leaves

  const built = useMemo(() => {
    const soil = toonMaterial({
      color: "#392b54",
      emissive: "#180f30",
      emissiveIntensity: 0.35,
      flatShading: true,
    });
    const stemGeo = new THREE.CylinderGeometry(0.07, 0.14, stemH, 7);
    const stemMat = toonMaterial({
      color: "#6f9a4e",
      emissive: "#12401a",
      emissiveIntensity: 0.4,
      flatShading: true,
    });
    const leafGeo = buildLeafGeometry();
    const leafMat = toonMaterial({
      color: skinLeafColor(skin, healthScore),
      emissive: skin.leaf.emissive,
      emissiveIntensity: 0.32,
    });
    attachWindShader(leafMat, 0, leafS, 0.9, volatilityToWind(volatility) * 0.1);
    // 3 distinct oversized leaves fanning up-and-out from the stem tip
    const leaves = new THREE.InstancedMesh(leafGeo, leafMat, 3);
    const spec = [
      { yaw: -2.3, tilt: 0.6, y: stemH - 0.15, sc: 1.0, off: 0.55 },
      { yaw: 0.3, tilt: 0.35, y: stemH + 0.35, sc: 1.15, off: 0.35 },
      { yaw: 2.5, tilt: 0.7, y: stemH - 0.35, sc: 0.85, off: 0.6 },
    ];
    spec.forEach((sp, i) => {
      _q.setFromEuler(new THREE.Euler(0, sp.yaw, 0));
      _tmpQ.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -sp.tilt);
      _q.multiply(_tmpQ);
      _s.setScalar(leafS * sp.sc);
      leaves.setMatrixAt(
        i,
        _m.clone().compose(
          new THREE.Vector3(
            Math.cos(sp.yaw) * sp.off,
            sp.y,
            Math.sin(sp.yaw) * sp.off,
          ),
          _q.clone(),
          _s.clone(),
        ),
      );
    });
    leaves.instanceMatrix.needsUpdate = true;
    leaves.castShadow = true;
    return { soil, stemGeo, stemMat, leafGeo, leafMat, leaves };
  }, [skin, healthScore, volatility]);

  useEffect(() => {
    onBounds({ height: stemH + leafS, radius: Math.max(moundR, leafS * 1.4) });
  }, [onBounds]);
  useEffect(() => () => {
    built.soil.dispose();
    built.stemGeo.dispose();
    built.stemMat.dispose();
    built.leafGeo.dispose();
    built.leafMat.dispose();
    built.leaves.dispose();
  }, [built]);

  const grow = useMountGrow();
  const grpRef = useRef<THREE.Group>(null);
  useFrame((state) => {
    const et = state.clock.elapsedTime;
    const sh = built.leafMat.userData?.windShader as
      | { uniforms: Record<string, { value: number }> }
      | undefined;
    if (sh) sh.uniforms.uTime.value = et;
    if (grpRef.current) {
      grpRef.current.scale.setScalar((1 + Math.sin(et * 0.8) * 0.02) * grow(et));
    }
  });

  return (
    <group ref={grpRef}>
      <mesh
        geometry={soilGeo}
        material={built.soil}
        position={[0, -moundR * 0.3, 0]}
        scale={[moundR, moundR * 0.42, moundR]}
        receiveShadow
        castShadow
      />
      <mesh
        geometry={built.stemGeo}
        material={built.stemMat}
        position={[0, stemH / 2 - 0.3, 0]}
        castShadow
      />
      <primitive object={built.leaves} />
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* the ez-tree instance                                                */
/* ------------------------------------------------------------------ */

function EzTreeObject({
  ticker,
  structureStage,
  healthScore,
  volatility,
  skin: skinId,
  shedding,
  onBounds,
}: Omit<Tree3DSceneProps, "interactive"> & {
  onBounds: (b: TreeBounds) => void;
}) {
  const [tree] = useState(() => new Tree());
  const skin = getSkin(skinId);
  const breatheRef = useRef<THREE.Group>(null);

  const [gen, setGen] = useState(0);
  const [localBounds, setLocalBounds] = useState<TreeBounds | null>(null);

  const seed = hashToSeed(ticker);
  const volBucket = volatilityBucket(volatility);
  const bucketedVolatility = volBucket / 8;

  // GEOMETRY — regenerate on seed / stage / volatility bucket / leaf size.
  useEffect(() => {
    applyGeometryOptions(tree.options, {
      seed,
      structureStage,
      volatility: bucketedVolatility,
      leafSizeMul: 1,
    });
    tree.generate();

    // swap ez-tree's textured phong materials for flat toon
    (tree.branchesMesh.material as THREE.Material).dispose();
    tree.branchesMesh.material = toonMaterial({
      color: BARK_COLOR,
      emissive: "#2a1a4a",
      emissiveIntensity: 0.45,
    });
    tree.branchesMesh.castShadow = true;
    tree.branchesMesh.receiveShadow = true;
    tree.leavesMesh.visible = false; // <SkinnedCanopy> owns the foliage now

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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocalBounds(b);
    onBounds(b);
    setGen((g) => g + 1);
  }, [tree, seed, structureStage, bucketedVolatility, onBounds]);

  useEffect(() => {
    return () => {
      tree.branchesMesh.geometry.dispose();
      tree.leavesMesh.geometry.dispose();
      (tree.branchesMesh.material as THREE.Material).dispose();
      (tree.leavesMesh.material as THREE.Material).dispose();
    };
  }, [tree]);

  // slow breathing scale on the whole tree — ~7s cycle; plus a mount grow-in
  const grow = useMountGrow();
  useFrame((state) => {
    const et = state.clock.elapsedTime;
    tree.update(et);
    if (breatheRef.current) {
      breatheRef.current.scale.setScalar(
        (1 + Math.sin(et * 0.85) * 0.018) * grow(et),
      );
    }
  });

  return (
    <group ref={breatheRef}>
      <primitive object={tree} />
      {localBounds && (
        <SceneErrorBoundary>
          <SkinnedCanopy
            tree={tree}
            gen={gen}
            skin={skin}
            healthScore={healthScore}
            volatility={volatility}
            bounds={localBounds}
          />
        </SceneErrorBoundary>
      )}
      {shedding && localBounds && (
        <SceneErrorBoundary>
          <FallingFoliage skin={skin} healthScore={healthScore} bounds={localBounds} />
        </SceneErrorBoundary>
      )}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* camera                                                              */
/* ------------------------------------------------------------------ */

function frameCamera(bounds: TreeBounds) {
  const small = bounds.height < 8; // seed / sprout
  const focusY = bounds.height * (small ? 0.3 : 0.54);
  const dist = small
    ? Math.max(bounds.height * 2.6, bounds.radius * 2.7, 6.5)
    : // the stylised canopy overshoots ez-tree's leaf bounds by a blob radius
      Math.max(bounds.height * 1.55, bounds.radius * 3.6) + bounds.height * 0.15 + 6;
  return {
    focusY,
    position: [
      dist * 0.48,
      focusY + bounds.height * (small ? 0.5 : 0.26),
      dist,
    ] as const,
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
/* resilience                                                          */
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
/* scene — dark void, warm key + cool fill + bright rim, bloom         */
/* ------------------------------------------------------------------ */

/* stage 0/1 are hand-authored; the ez-tree generator only runs from stage 2. */
function StageContent(
  props: Omit<Tree3DSceneProps, "interactive"> & {
    onBounds: (b: TreeBounds) => void;
  },
) {
  const stage = Math.max(0, Math.min(5, Math.round(props.structureStage)));
  const skin = getSkin(props.skin);

  if (stage === 0) {
    return <SeedForm skin={skin} onBounds={props.onBounds} />;
  }
  if (stage === 1) {
    return (
      <SproutForm
        skin={skin}
        healthScore={props.healthScore}
        volatility={props.volatility}
        onBounds={props.onBounds}
      />
    );
  }
  // key on the seed/tree boundary so the tree remounts (and fades in) when
  // crossing up from the sprout — reads as a cross-fade against the dark void
  return <EzTreeObject key="tree" {...props} />;
}

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
  const d = Math.max(bounds.height, bounds.radius * 2);

  return (
    <>
      <color attach="background" args={["#0a0a1e"]} />
      <fog attach="fog" args={["#0a0a1e", d * 2.4, d * 7]} />

      <ambientLight intensity={0.22} color="#20305c" />
      {/* warm key, one side */}
      <directionalLight
        position={[d * 0.9, d * 1.3, d * 0.5]}
        intensity={2.4}
        color="#ffcf9c"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0005}
        shadow-normalBias={0.04}
        shadow-camera-near={1}
        shadow-camera-far={d * 6}
        shadow-camera-left={-d * 1.6}
        shadow-camera-right={d * 1.6}
        shadow-camera-top={d * 2}
        shadow-camera-bottom={-d * 0.4}
      />
      {/* cool fill, opposite */}
      <directionalLight
        position={[-d * 1.1, d * 0.5, d * 0.3]}
        intensity={0.9}
        color="#4f6ee0"
      />
      {/* bright rim, behind + above the tree (away from camera) — the single
          biggest contributor to the look */}
      <directionalLight
        position={[-d * 0.5, d * 1.1, -d * 1.4]}
        intensity={5}
        color="#8fe6ff"
      />
      <directionalLight
        position={[d * 0.7, d * 0.9, -d * 1.2]}
        intensity={2.4}
        color="#ff9ad0"
      />

      <Ground radius={Math.max(40, bounds.radius * 4)} />

      <SceneErrorBoundary>
        <StageContent
          ticker={ticker}
          structureStage={structureStage}
          healthScore={healthScore}
          volatility={volatility}
          skin={skinId}
          shedding={shedding}
          onBounds={setBounds}
        />
      </SceneErrorBoundary>

      <Motes bounds={bounds} />

      <ContactShadows
        position={[0, 0.02, 0]}
        scale={Math.max(26, bounds.radius * 3.2)}
        resolution={1024}
        blur={3.2}
        far={Math.max(10, bounds.height * 0.5)}
        opacity={0.5}
        color="#05030f"
      />

      <CameraRig
        bounds={bounds}
        structureStage={structureStage}
        interactive={interactive}
      />

      <SceneErrorBoundary>
        <EffectComposer>
          <Bloom
            mipmapBlur
            intensity={0.9}
            luminanceThreshold={0.62}
            luminanceSmoothing={0.25}
            radius={0.75}
          />
          <Vignette offset={0.3} darkness={0.6} eskil={false} />
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
        toneMappingExposure: 1.15,
        outputColorSpace: THREE.SRGBColorSpace,
      }}
      camera={{ fov: 38, near: 0.5, far: 400, position: [18, 16, 26] }}
    >
      <SceneContents {...props} />
    </Canvas>
  );
}
