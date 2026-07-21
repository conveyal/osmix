import type { OsmConflationRoutingDiagnostics, OsmConflationRoutingGraphStats } from "osmix";

import { Card, CardContent, CardHeader } from "./ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";

const METRICS = [
  "nodes",
  "routableNodes",
  "edges",
  "components",
] as const satisfies readonly (keyof OsmConflationRoutingGraphStats)[];

export function ConflationRoutingDiagnostics({
  diagnostics,
}: {
  diagnostics: OsmConflationRoutingDiagnostics;
}) {
  return (
    <Card>
      <CardHeader>Routing topology impact</CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>mode / metric</TableHead>
              <TableHead>before</TableHead>
              <TableHead>after</TableHead>
              <TableHead>delta</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(["car", "walk"] as const).flatMap((mode) =>
              METRICS.map((metric) => {
                const value = diagnostics[mode];
                return (
                  <TableRow key={`${mode}-${metric}`}>
                    <TableCell>
                      {mode} / {metric}
                    </TableCell>
                    <TableCell>{value.before[metric].toLocaleString()}</TableCell>
                    <TableCell>{value.after[metric].toLocaleString()}</TableCell>
                    <TableCell>{value.delta[metric].toLocaleString()}</TableCell>
                  </TableRow>
                );
              }),
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
