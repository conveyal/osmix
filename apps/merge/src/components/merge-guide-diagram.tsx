import { useId, type ReactNode } from "react";

export const MERGE_GUIDE_DIAGRAM_IDS = [
  "pipeline",
  "direct-merge",
  "exact-reconciliation",
  "fuzzy-conflation",
  "intersections",
] as const;

export type MergeGuideDiagramId = (typeof MERGE_GUIDE_DIAGRAM_IDS)[number];

interface DiagramFrameProps {
  children: ReactNode;
  description: string;
  kind: MergeGuideDiagramId;
  title: string;
}

function DiagramFrame({ children, description, kind, title }: DiagramFrameProps) {
  const titleId = useId();
  const descriptionId = useId();

  return (
    <svg
      aria-labelledby={`${titleId} ${descriptionId}`}
      className="h-auto w-full max-w-full"
      data-diagram={kind}
      role="img"
      viewBox="0 0 240 300"
      xmlns="http://www.w3.org/2000/svg"
    >
      <title id={titleId}>{title}</title>
      <desc id={descriptionId}>{description}</desc>
      {children}
    </svg>
  );
}

type DiagramTone = "info" | "neutral" | "success" | "warning";

const boxToneClasses: Record<DiagramTone, string> = {
  info: "fill-info/5 stroke-info",
  neutral: "fill-card stroke-border",
  success: "fill-success/10 stroke-success",
  warning: "fill-warning/10 stroke-warning",
};

function DiagramBox({
  detail,
  height = 54,
  label,
  tone = "neutral",
  width,
  x,
  y,
}: {
  detail?: string;
  height?: number;
  label: string;
  tone?: DiagramTone;
  width: number;
  x: number;
  y: number;
}) {
  const center = x + width / 2;
  return (
    <g>
      <rect
        className={boxToneClasses[tone]}
        height={height}
        rx="2"
        vectorEffect="non-scaling-stroke"
        width={width}
        x={x}
        y={y}
      />
      <text
        className="fill-foreground font-mono font-semibold"
        fontSize="12"
        textAnchor="middle"
        x={center}
        y={detail ? y + 23 : y + height / 2 + 4}
      >
        {label}
      </text>
      {detail ? (
        <text
          className="fill-muted-foreground font-mono"
          fontSize="10"
          textAnchor="middle"
          x={center}
          y={y + 41}
        >
          {detail}
        </text>
      ) : null}
    </g>
  );
}

function DiagramArrow({
  dashed = false,
  endX,
  endY,
  startX,
  startY,
  tone = "info",
}: {
  dashed?: boolean;
  endX: number;
  endY: number;
  startX: number;
  startY: number;
  tone?: Exclude<DiagramTone, "neutral">;
}) {
  const strokeClass =
    tone === "success"
      ? "stroke-success fill-success"
      : tone === "warning"
        ? "stroke-warning fill-warning"
        : "stroke-info fill-info";
  const angle = Math.atan2(endY - startY, endX - startX);
  const arrowLength = 8;
  const arrowSpread = 4;
  const lineEndX = endX - Math.cos(angle) * arrowLength;
  const lineEndY = endY - Math.sin(angle) * arrowLength;
  const leftX = lineEndX + Math.cos(angle + Math.PI / 2) * arrowSpread;
  const leftY = lineEndY + Math.sin(angle + Math.PI / 2) * arrowSpread;
  const rightX = lineEndX + Math.cos(angle - Math.PI / 2) * arrowSpread;
  const rightY = lineEndY + Math.sin(angle - Math.PI / 2) * arrowSpread;

  return (
    <g className={strokeClass}>
      <line
        strokeDasharray={dashed ? "5 4" : undefined}
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
        x1={startX}
        x2={lineEndX}
        y1={startY}
        y2={lineEndY}
      />
      <path d={`M ${endX} ${endY} L ${leftX} ${leftY} L ${rightX} ${rightY} Z`} />
    </g>
  );
}

function PipelineDiagram() {
  return (
    <DiagramFrame
      kind="pipeline"
      title="Reviewed and automatic merge workflows"
      description="The same base and patch inputs can pass through either review checkpoints or an automatic pipeline before producing a merged result."
    >
      <DiagramBox detail="Base + patch" label="Inputs" width={180} x={30} y={12} />
      <DiagramBox
        detail="Pause at previews"
        label="Reviewed"
        tone="info"
        width={108}
        x={4}
        y={112}
      />
      <DiagramBox
        detail="Skip checkpoints"
        label="Automatic"
        tone="warning"
        width={108}
        x={128}
        y={112}
      />
      <DiagramBox
        detail="New in-memory OSM"
        label="Merged result"
        tone="success"
        width={180}
        x={30}
        y={234}
      />
      <DiagramArrow endX={58} endY={112} startX={102} startY={66} />
      <DiagramArrow dashed endX={182} endY={112} startX={138} startY={66} tone="warning" />
      <DiagramArrow endX={102} endY={234} startX={58} startY={166} tone="success" />
      <DiagramArrow dashed endX={138} endY={234} startX={182} startY={166} tone="success" />
    </DiagramFrame>
  );
}

function DirectMergeDiagram() {
  return (
    <DiagramFrame
      kind="direct-merge"
      title="Direct merge behavior"
      description="Base-only entities remain, patch-only entities are added, and patch entities replace base entities with the same OpenStreetMap ID."
    >
      <DiagramBox detail="Existing data" label="Base OSM" width={108} x={4} y={12} />
      <DiagramBox detail="Adds + updates" label="Patch OSM" width={108} x={128} y={12} />
      <DiagramBox
        detail="Base-only retained"
        label="Merged preview"
        tone="success"
        width={180}
        x={30}
        y={234}
      />
      <DiagramArrow endX={102} endY={234} startX={58} startY={66} tone="success" />
      <DiagramArrow dashed endX={138} endY={234} startX={182} startY={66} tone="success" />
      <text
        className="fill-muted-foreground font-mono"
        fontSize="10"
        textAnchor="middle"
        x="120"
        y="112"
      >
        Base-only IDs: retained
      </text>
      <text
        className="fill-muted-foreground font-mono"
        fontSize="10"
        textAnchor="middle"
        x="120"
        y="148"
      >
        Patch-only IDs: added
      </text>
      <text
        className="fill-muted-foreground font-mono"
        fontSize="10"
        textAnchor="middle"
        x="120"
        y="184"
      >
        Same IDs: patch wins
      </text>
    </DiagramFrame>
  );
}

function ExactReconciliationDiagram() {
  return (
    <DiagramFrame
      kind="exact-reconciliation"
      title="Exact entity reconciliation"
      description="A uniquely compatible patch entity with exact geometry is represented by the preserved base entity, and imported references are rewritten to the base ID."
    >
      <DiagramBox detail="Preserved ID 42" label="Base node" tone="info" width={108} x={4} y={12} />
      <DiagramBox detail="Imported ID -7" label="Patch node" width={108} x={128} y={12} />
      <DiagramBox
        detail="Exact + compatible"
        label="Unique match"
        tone="warning"
        width={180}
        x={30}
        y={122}
      />
      <DiagramBox
        detail="Patch refs → 42"
        label="Base node 42"
        tone="success"
        width={180}
        x={30}
        y={234}
      />
      <DiagramArrow endX={94} endY={122} startX={58} startY={66} />
      <DiagramArrow dashed endX={146} endY={122} startX={182} startY={66} />
      <DiagramArrow endX={120} endY={234} startX={120} startY={176} tone="success" />
    </DiagramFrame>
  );
}

function FuzzyConflationDiagram() {
  return (
    <DiagramFrame
      kind="fuzzy-conflation"
      title="Imported-data matching actions"
      description="A compatible nearby imported entity can transfer selected tags to a base entity, attach imported network references to a base node, or perform both reviewed actions."
    >
      <DiagramBox detail="Nearby, non-exact" label="Imported entity" width={180} x={30} y={12} />
      <DiagramBox detail="Selected tags" label="Properties" tone="info" width={108} x={4} y={112} />
      <DiagramBox
        detail="Patch refs only"
        label="Network"
        tone="warning"
        width={108}
        x={128}
        y={112}
      />
      <DiagramBox
        detail="ID + geometry stay"
        label="Base preserved"
        tone="success"
        width={180}
        x={30}
        y={234}
      />
      <DiagramArrow endX={58} endY={112} startX={102} startY={66} />
      <DiagramArrow dashed endX={182} endY={112} startX={138} startY={66} tone="warning" />
      <DiagramArrow endX={102} endY={234} startX={58} startY={166} tone="success" />
      <DiagramArrow dashed endX={138} endY={234} startX={182} startY={166} tone="success" />
    </DiagramFrame>
  );
}

function IntersectionsDiagram() {
  return (
    <DiagramFrame
      kind="intersections"
      title="Intersection compatibility"
      description="Same-grade highway crossings receive a shared node, while crossings separated by bridge, tunnel, layer, level, or covered context remain disconnected."
    >
      <text className="fill-foreground font-mono font-semibold" fontSize="12" x="12" y="20">
        Compatible grade
      </text>
      <line
        className="stroke-info"
        strokeWidth="3"
        vectorEffect="non-scaling-stroke"
        x1="30"
        x2="210"
        y1="68"
        y2="68"
      />
      <line
        className="stroke-success"
        strokeWidth="3"
        vectorEffect="non-scaling-stroke"
        x1="120"
        x2="120"
        y1="34"
        y2="102"
      />
      <circle
        className="fill-card stroke-foreground"
        cx="120"
        cy="68"
        r="6"
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
      <text
        className="fill-muted-foreground font-mono"
        fontSize="10"
        textAnchor="middle"
        x="120"
        y="124"
      >
        Shared node: connected
      </text>

      <text className="fill-foreground font-mono font-semibold" fontSize="12" x="12" y="166">
        Grade separated
      </text>
      <line
        className="stroke-info"
        strokeWidth="3"
        vectorEffect="non-scaling-stroke"
        x1="30"
        x2="210"
        y1="214"
        y2="214"
      />
      <line
        className="stroke-warning"
        strokeDasharray="6 4"
        strokeWidth="3"
        vectorEffect="non-scaling-stroke"
        x1="120"
        x2="120"
        y1="180"
        y2="248"
      />
      <text
        className="fill-muted-foreground font-mono"
        fontSize="10"
        textAnchor="middle"
        x="120"
        y="270"
      >
        No shared node: disconnected
      </text>
    </DiagramFrame>
  );
}

export function MergeGuideDiagram({ diagram }: { diagram: MergeGuideDiagramId }) {
  switch (diagram) {
    case "pipeline":
      return <PipelineDiagram />;
    case "direct-merge":
      return <DirectMergeDiagram />;
    case "exact-reconciliation":
      return <ExactReconciliationDiagram />;
    case "fuzzy-conflation":
      return <FuzzyConflationDiagram />;
    case "intersections":
      return <IntersectionsDiagram />;
  }
}
