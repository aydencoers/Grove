"use client";

import dynamic from "next/dynamic";

import { cn } from "@/lib/utils";
import type { Tree3DSceneProps } from "@/components/tree/tree-3d-scene";

const Tree3DScene = dynamic(
  () => import("@/components/tree/tree-3d-scene"),
  {
    ssr: false,
    loading: () => <SceneSkeleton />,
  },
);

function SceneSkeleton() {
  return (
    <div className="absolute inset-0 grid place-items-center bg-[#d9e6ee] text-[#4a5a4a]">
      <div className="flex flex-col items-center gap-3">
        <span
          className="h-8 w-8 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden
        />
        <span className="text-xs">Growing the tree…</span>
      </div>
    </div>
  );
}

interface Tree3DProps extends Tree3DSceneProps {
  className?: string;
}

/**
 * Live 3D tree (React Three Fiber + @dgreenheck/ez-tree). Client-only —
 * dynamically imported with ssr:false so three.js never touches the server
 * bundle. The parent must give this element a height.
 */
export function Tree3D({ className, ...scene }: Tree3DProps) {
  return (
    <div
      className={cn(
        "relative isolate overflow-hidden bg-[#d9e6ee]",
        className,
      )}
    >
      {/* shown until the canvas paints its first (opaque) frame over it */}
      <SceneSkeleton />
      <Tree3DScene {...scene} />
    </div>
  );
}
