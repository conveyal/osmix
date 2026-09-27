import {
  Card,
  CardContent,
  CardHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@osmix/ui";
import type { OsmConflationRoutingDiagnostics, OsmConflationRoutingGraphStats } from "osmix";
import { useId } from "react";

const METRICS = [
  "nodes",
  "routableNodes",
  "edges",
  "components",
] as const satisfies readonly (keyof OsmConflationRoutingGraphStats)[];

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

const SCOPE_COPY = {
  matching: {
    before: "Before ordinary merge",
    after: "After fuzzy matching",
    description:
      "is the ordinary direct merge, including exact reconciliation when selected. After adds accepted fuzzy property transfers and network attachments.",
  },
  plan: {
    before: "Base",
    after: "Planned result",
    description:
      "is the base dataset. After is the result the plan would apply, with every proposal it currently includes.",
  },
} as const;

/**
 * CAR and WALK graph counts before and after. `scope` says what before and after are: the
 * matching stage of the staged workflow, or a whole merge plan.
 */
export function ConflationRoutingDiagnostics({
  diagnostics,
  scope = "matching",
}: {
  diagnostics: Pick<OsmConflationRoutingDiagnostics, "car" | "walk">;
  scope?: keyof typeof SCOPE_COPY;
}) {
  const descriptionId = useId();
  const copy = SCOPE_COPY[scope];
  return (
    <Card>
      <CardHeader>Routing topology impact</CardHeader>
      <CardContent className="p-0">
        <div className="grid gap-1 p-inset text-muted-foreground" id={descriptionId}>
          <p>
            <span className="font-semibold">Before</span> {copy.description}
          </p>
          <p>
            All graph nodes include every node loaded into the mode-specific graph. Routable nodes
            participate in at least one usable street; directed edges are traversable movements;
            connected components are weakly connected groups calculated without edge direction.
            Different components guarantee no route between them, but one component does not
            guarantee travel in both directions. Delta is after minus before.
          </p>
        </div>
        <Table aria-describedby={descriptionId}>
          <TableHeader>
            <TableRow>
              <TableHead>Mode / metric</TableHead>
              <TableHead>{copy.before}</TableHead>
              <TableHead>{copy.after}</TableHead>
              <TableHead>Signed delta</TableHead>
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
                    <TableCell>{value.before[metric].toLocaleString()}</TableCell>
                    <TableCell>{value.after[metric].toLocaleString()}</TableCell>
                    <TableCell>{formatDelta(value.delta[metric])}</TableCell>
                  </TableRow>
                );
              }),
            )}
          </TableBody>
        </Table>
        <p className="border-t p-inset text-muted-foreground">
          A walk-only attachment should not change CAR topology. Fewer WALK components can indicate
          the intended new connection, but topology counts alone do not prove that routing is
          correct.
        </p>
      </CardContent>
    </Card>
  );
}
