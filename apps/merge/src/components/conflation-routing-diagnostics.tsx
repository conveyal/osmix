import type { OsmConflationRoutingDiagnostics, OsmConflationRoutingGraphStats } from "osmix";
import { useId } from "react";

import { Card, CardContent, CardHeader } from "./ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";

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

export function ConflationRoutingDiagnostics({
  diagnostics,
}: {
  diagnostics: OsmConflationRoutingDiagnostics;
}) {
  const descriptionId = useId();
  return (
    <Card>
      <CardHeader>Routing topology impact</CardHeader>
      <CardContent className="p-0">
        <div className="grid gap-1 p-2 text-muted-foreground" id={descriptionId}>
          <p>
            <span className="font-bold text-foreground">Before</span> is the ordinary direct merge,
            including exact reconciliation when selected.{" "}
            <span className="font-bold text-foreground">After</span> adds accepted fuzzy property
            transfers and network attachments.
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
              <TableHead>Before ordinary merge</TableHead>
              <TableHead>After fuzzy matching</TableHead>
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
        <p className="border-t p-2 text-muted-foreground">
          A walk-only attachment should not change CAR topology. Fewer WALK components can indicate
          the intended new connection, but topology counts alone do not prove that routing is
          correct.
        </p>
      </CardContent>
    </Card>
  );
}
