import {
  SidebarSection,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@osmix/ui";
import type { PlanRoutingDelta, PlanRoutingStats } from "osmix";
import { useId } from "react";

const METRICS = [
  "nodes",
  "routableNodes",
  "edges",
  "components",
] as const satisfies readonly (keyof PlanRoutingStats)[];

const METRIC_LABEL: Record<(typeof METRICS)[number], string> = {
  components: "Connected components",
  edges: "Directed edges",
  nodes: "All graph nodes",
  routableNodes: "Routable nodes",
};

function formatDelta(value: number) {
  if (value > 0) return `+${value.toLocaleString()}`;
  return value.toLocaleString();
}

type RoutingDiagnostics = { car: PlanRoutingDelta; walk: PlanRoutingDelta };

/**
 * CAR and WALK graph counts of the base and of the plan's result, without a frame: the
 * description, the table and the mode invariants. `applied` says the result is the merged
 * dataset rather than what the plan would apply. Place it in a `flush` section or a `Details`.
 */
export function RoutingTopology({
  diagnostics,
  applied = false,
}: {
  diagnostics: RoutingDiagnostics;
  applied?: boolean;
}) {
  const descriptionId = useId();
  return (
    <>
      <div className="grid gap-1 p-inset text-muted-foreground" id={descriptionId}>
        <p>
          <span className="font-semibold">Before</span> is the base dataset.{" "}
          <span className="font-semibold">After</span>{" "}
          {applied
            ? "is the merged result, with every proposal the plan included."
            : "is the result the plan would apply, with every proposal it currently includes."}
        </p>
        <p>
          All graph nodes include every node loaded into the mode-specific graph. Routable nodes
          participate in at least one usable street; directed edges are traversable movements;
          connected components are weakly connected groups calculated without edge direction.
          Different components guarantee no route between them, but one component does not guarantee
          travel in both directions. Delta is after minus before.
        </p>
      </div>
      <Table aria-describedby={descriptionId}>
        <TableHeader>
          <TableRow>
            <TableHead>Mode / metric</TableHead>
            <TableHead numeric>Base</TableHead>
            <TableHead numeric>{applied ? "Merged result" : "Planned result"}</TableHead>
            <TableHead numeric>Signed delta</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(["car", "walk"] as const).flatMap((mode) =>
            METRICS.map((metric) => {
              const value = diagnostics[mode];
              return (
                <TableRow key={`${mode}-${metric}`}>
                  <TableCell>
                    {mode.toUpperCase()} / {METRIC_LABEL[metric]}
                  </TableCell>
                  <TableCell numeric>{value.before[metric].toLocaleString()}</TableCell>
                  <TableCell numeric>{value.after[metric].toLocaleString()}</TableCell>
                  <TableCell numeric>{formatDelta(value.delta[metric])}</TableCell>
                </TableRow>
              );
            }),
          )}
        </TableBody>
      </Table>
      <p className="border-t p-inset text-muted-foreground">
        Automatic matching never changes CAR topology. Fewer WALK components can indicate the
        intended new connections, but topology counts alone do not prove that routing is correct.
      </p>
    </>
  );
}

/** `RoutingTopology` in its own sidebar section, for the result step. */
export function ConflationRoutingDiagnostics({
  diagnostics,
  applied = false,
}: {
  diagnostics: RoutingDiagnostics;
  applied?: boolean;
}) {
  return (
    <SidebarSection flush title="Routing topology impact">
      <RoutingTopology diagnostics={diagnostics} applied={applied} />
    </SidebarSection>
  );
}
