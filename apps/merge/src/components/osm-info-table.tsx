import type { Osm } from "osmix";

import { bytesSizeToHuman } from "../utils";
import type { StoredFileInfo } from "../workers/osm.worker";
import { Details, DetailsContent, DetailsSummary } from "./details";
import ObjectToTableRows from "./object-to-table";
import { SectionTitle } from "./section";
import { Table, TableBody, TableCell, TableRow } from "./ui/table";

export default function OsmInfoTable({
  defaultOpen,
  osm,
  file,
  fileInfo,
}: {
  defaultOpen?: boolean;
  osm: Osm | null;
  file?: File | null;
  /** Alternative to file - used when loading from storage */
  fileInfo?: StoredFileInfo | null;
}) {
  // Get file name and size from either file or fileInfo
  const fileSize = file?.size ?? fileInfo?.fileSize;

  if (!osm || (!file && !fileInfo)) return null;
  return (
    <Details defaultOpen={defaultOpen}>
      <DetailsSummary>File info</DetailsSummary>
      <DetailsContent className="overflow-auto">
        <Table>
          <TableBody>
            {fileSize != null && (
              <TableRow>
                <TableCell>size</TableCell>
                <TableCell>{bytesSizeToHuman(fileSize)}</TableCell>
              </TableRow>
            )}
            <TableRow>
              <TableCell>nodes</TableCell>
              <TableCell>{osm.nodes.size.toLocaleString()}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>ways</TableCell>
              <TableCell>{osm.ways.size.toLocaleString()}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>relations</TableCell>
              <TableCell>{osm.relations.size.toLocaleString()}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>bbox</TableCell>
              <TableCell>{osm.bbox()?.join(",")}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>
                <SectionTitle>Header</SectionTitle>
              </TableCell>
              <TableCell />
            </TableRow>
            <ObjectToTableRows object={osm.header} />
          </TableBody>
        </Table>
      </DetailsContent>
    </Details>
  );
}
