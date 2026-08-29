"use client";

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
  healthToLeafColor,
  healthToLeafDensity,
  mulberry32,
  volatilityBucket,
  volatilityToWind,
} from "@/lib/tree3d";

export interface Tree3DSceneProps {
  ticker: string;
  structureStage: number;
  healthScore: number;
  volatility: number;
  interactive?: boolean;
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

/** healthScore → leaf material colour + canopy density. No regeneration. */
function applyHealthMaterial(tree: Tree, maxLeafIndex: number, health: number) {
  const mat = tree.leavesMesh.material as THREE.MeshPhongMaterial;
  if (!mat) return;
  mat.color.set(healthToLeafColor(health));
  mat.opacity = health < -0.45 ? 0.9 : 1;
  mat.transparent = mat.opacity < 1;
  mat.needsUpdate = true;

  const frac = healthToLeafDensity(health);
  const n =
    Math.floor((maxLeafIndex * frac) / LEAF_INDEX_BLOCK) * LEAF_INDEX_BLOCK;
  tree.leavesMesh.geometry.setDrawRange(0, Math.max(0, n));
}

export interface TreeBounds {
  height: number;
  radius: number;
}

function EzTreeObject({
  ticker,
  structureStage,
  healthScore,
  volatility,
  onBounds,
}: Omit<Tree3DSceneProps, "interactive"> & {
  onBounds: (b: TreeBounds) => void;
}) {
  // One imperative THREE.Group for the life of the component. useState's lazy
  // initialiser gives a stable instance; React never reconciles its internals.
  const [tree] = useState(() => new Tree());
  const maxLeafIndexRef = useRef(0);

  const seed = hashToSeed(ticker);
  const volBucket = volatilityBucket(volatility);
  // Quantised volatility feeds geometry so ordinary daily drift within a bucket
  // never triggers a rebuild; the raw value only drives wind (below).
  const bucketedVolatility = volBucket / 8;

  // GEOMETRY — the expensive path. seed / structureStage / volatility bucket.
  useEffect(() => {
    applyGeometryOptions(tree.options, {
      seed,
      structureStage,
      volatility: bucketedVolatility,
    });
    tree.generate();
    maxLeafIndexRef.current = shuffleLeafIndices(tree, seed);
    for (const m of [tree.branchesMesh, tree.leavesMesh]) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
    const box = new THREE.Box3().setFromObject(tree);
    onBounds({
      height: Math.max(1, box.max.y),
      radius: Math.max(
        Math.abs(box.max.x),
        Math.abs(box.min.x),
        Math.abs(box.max.z),
        Math.abs(box.min.z),
        1,
      ),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree, seed, structureStage, bucketedVolatility]);

  // MATERIAL — healthScore changes daily. Tint + drawRange only, no rebuild.
  // structureStage / bucket are deps too so the tint re-applies to the fresh
  // material after any regenerate.
  useEffect(() => {
    applyHealthMaterial(tree, maxLeafIndexRef.current, healthScore);
  }, [tree, healthScore, structureStage, bucketedVolatility]);

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

  return <primitive object={tree} />;
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
  interactive = false,
}: Tree3DSceneProps) {
  const [bounds, setBounds] = useState<TreeBounds>({ height: 28, radius: 12 });
  const { focusY } = frameCamera(bounds);

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
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0005}
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
          onBounds={setBounds}
        />
      </SceneErrorBoundary>

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
      shadows="soft"
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
