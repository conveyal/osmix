import { Table, TableBody, TableCell, TableRow, TableRowHeader } from "@osmix/ui";
import type {
  ExtractStrategy,
  ExtractTagFilterRule,
  ExtractTagFilterRules,
  GeoBbox2D,
  Osm,
} from "osmix";

/** What an extract was made from and with: kept with the result, not the (editable) form. */
export interface ExtractParameters {
  sourceName: string;
  bbox: GeoBbox2D;
  strategy: ExtractStrategy;
  tagFilter: ExtractTagFilterRules;
}

const STRATEGY_LABEL: Record<ExtractStrategy, string> = {
  simple: "Simple",
  complete_ways: "Complete ways",
  smart: "Smart",
};

function rulesText(rules: ExtractTagFilterRule[]) {
  if (rules.length === 0) return "all";
  const list = rules.map((rule) => (rule.value ? `${rule.key}=${rule.value}` : rule.key));
  return rules.length === 1 ? list[0]! : `any of ${list.join(", ")}`;
}

/**
 * The extracted dataset: its counts and the bounds of its data, and the source, strategy, bbox
 * and tag filters that produced it. The data can reach past the bbox with complete ways.
 */
export function ExtractResultStats({
  osm,
  parameters,
}: {
  osm: Osm;
  parameters: ExtractParameters | null;
}) {
  const rows: [string, string][] = [];
  const extractBbox = parameters?.bbox.join(", ");
  const dataBounds = osm.bbox()?.join(", ") ?? "empty";
  if (parameters) {
    rows.push(
      ["source file", parameters.sourceName],
      ["strategy", STRATEGY_LABEL[parameters.strategy]],
      ["extract bbox", parameters.bbox.join(", ")],
    );
  }
  rows.push(
    ["nodes", osm.nodes.size.toLocaleString()],
    ["ways", osm.ways.size.toLocaleString()],
    ["relations", osm.relations.size.toLocaleString()],
    ["data bounds", dataBounds === extractBbox ? "same as extract bbox" : dataBounds],
  );
  if (parameters) {
    rows.push(
      ["node filter", rulesText(parameters.tagFilter.nodes)],
      ["way filter", rulesText(parameters.tagFilter.ways)],
      ["relation filter", rulesText(parameters.tagFilter.relations)],
    );
  }
  return (
    <Table aria-label="Extract statistics">
      <TableBody>
        {rows.map(([label, value]) => (
          <TableRow key={label}>
            <TableRowHeader>{label}</TableRowHeader>
            <TableCell clamp>{value}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
