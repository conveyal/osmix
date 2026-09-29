import {
  bytesSizeToHuman,
  Details,
  DetailsContent,
  DetailsSummary,
  Table,
  TableBody,
  TableCell,
  TableRow,
  TableRowHeader,
} from "@osmix/ui";
import type { OsmPbfHeaderBlock } from "osmix";

import { headerBboxToGeoBbox } from "../lib/extract-bbox";

/** Seconds since the epoch stay below this until the year 5138; milliseconds pass it in 1973. */
const MILLISECOND_TIMESTAMP_MIN = 1e11;

/**
 * The selected source file, before it is read: its name, size and what its PBF header records.
 * Node, way and relation counts are only known for the extract (see `ExtractResultStats`).
 */
export function SourceFileInfo({ file, header }: { file: File; header: OsmPbfHeaderBlock | null }) {
  const bbox = header ? headerBboxToGeoBbox(header.bbox) : null;
  const replicated = header?.osmosis_replication_timestamp;
  const rows: [string, string][] = [
    ["file name", file.name],
    ["size", bytesSizeToHuman(file.size)],
    ["modified", new Date(file.lastModified).toISOString().slice(0, 19).replace("T", " ")],
  ];
  if (header) {
    rows.push(["header bbox", bbox ? bbox.join(", ") : "not recorded"]);
    if (header.writingprogram) rows.push(["writing program", header.writingprogram]);
    if (header.source) rows.push(["source", header.source]);
    if (replicated) {
      // The format records seconds; earlier Osmix exports (and the Monaco fixture) wrote milliseconds.
      const milliseconds = replicated > MILLISECOND_TIMESTAMP_MIN;
      const at = new Date(milliseconds ? replicated : replicated * 1000);
      const text = `${at.toISOString().slice(0, 19).replace("T", " ")} UTC`;
      rows.push([
        "replication timestamp",
        milliseconds ? `${text} (recorded in milliseconds)` : text,
      ]);
    }
    if (header.osmosis_replication_sequence_number !== undefined) {
      rows.push(["replication sequence", String(header.osmosis_replication_sequence_number)]);
    }
    if (header.osmosis_replication_base_url) {
      rows.push(["replication URL", header.osmosis_replication_base_url]);
    }
    if (header.required_features.length > 0) {
      rows.push(["required features", header.required_features.join(", ")]);
    }
    if (header.optional_features.length > 0) {
      rows.push(["optional features", header.optional_features.join(", ")]);
    }
  }
  return (
    <Details defaultOpen={false}>
      <DetailsSummary>File info</DetailsSummary>
      <DetailsContent>
        <Table aria-label="Selected file">
          <TableBody>
            {rows.map(([label, value]) => (
              <TableRow key={label}>
                <TableRowHeader>{label}</TableRowHeader>
                <TableCell clamp>{value}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </DetailsContent>
    </Details>
  );
}
