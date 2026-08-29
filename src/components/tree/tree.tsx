import { buildTreeGeometry } from "@/lib/tree";

interface TreeProps {
  ticker: string;
  /** 0 (seed) – 5 (elder). SPEC §2 structure stage. */
  structureStage: number;
  /** -1 (dying) – 1 (thriving). SPEC §2 health score. */
  healthScore: number;
  className?: string;
  /** Screen-reader description. Omit + pass `decorative` when a parent conveys state. */
  "aria-label"?: string;
  /** Hide from the a11y tree (the surrounding figure describes the tree instead). */
  decorative?: boolean;
}

/**
 * Procedurally generated SVG tree (SPEC §7). Pure render of
 * `buildTreeGeometry` — deterministic per ticker, safe to render on the server.
 */
export function Tree({
  ticker,
  structureStage,
  healthScore,
  className,
  decorative,
  ...rest
}: TreeProps) {
  const geo = buildTreeGeometry(ticker, structureStage, healthScore);

  const a11y = decorative
    ? { "aria-hidden": true as const }
    : {
        role: "img" as const,
        "aria-label":
          rest["aria-label"] ?? `Procedural tree for ${ticker.toUpperCase()}`,
      };

  if (geo.kind === "seed") {
    return (
      <svg
        viewBox={geo.viewBox}
        className={className}
        preserveAspectRatio="xMidYMax meet"
        {...a11y}
      >
        <path d={geo.seed!.mound} fill="hsl(28 22% 30%)" />
        <path d={geo.seed!.mound} fill="hsl(28 30% 18%)" opacity={0.3} />
        <path d={geo.seed!.sprout} fill="hsl(96 42% 40%)" />
      </svg>
    );
  }

  return (
    <svg
      viewBox={geo.viewBox}
      className={className}
      preserveAspectRatio="xMidYMax meet"
      shapeRendering="geometricPrecision"
      {...a11y}
    >
      <g>
        {geo.backBranches.map((b, i) => (
          <path key={`bb${i}`} d={b.d} fill={b.fill} />
        ))}
      </g>
      <g>
        {geo.backLeaves.map((l, i) => (
          <ellipse
            key={`bl${i}`}
            cx={l.cx}
            cy={l.cy}
            rx={l.rx}
            ry={l.ry}
            fill={l.fill}
            transform={`rotate(${l.angle} ${l.cx} ${l.cy})`}
          />
        ))}
      </g>
      <g>
        {geo.frontBranches.map((b, i) => (
          <path key={`fb${i}`} d={b.d} fill={b.fill} />
        ))}
      </g>
      <g>
        {geo.frontLeaves.map((l, i) => (
          <ellipse
            key={`fl${i}`}
            cx={l.cx}
            cy={l.cy}
            rx={l.rx}
            ry={l.ry}
            fill={l.fill}
            transform={`rotate(${l.angle} ${l.cx} ${l.cy})`}
          />
        ))}
      </g>
    </svg>
  );
}
