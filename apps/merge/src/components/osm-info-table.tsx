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
  const info = osm.info();
  const diagnostics = info.loadDiagnostics;
  const nodeIndexes = [
    info.spatialIndexes.nodes.tagged ? "tagged" : null,
    info.spatialIndexes.nodes.all ? "all" : null,
  ]
    .filter(Boolean)
    .join(", ");
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
              <TableCell>load profile</TableCell>
              <TableCell>
                {diagnostics
                  ? `${diagnostics.selectedProfile} (requested ${diagnostics.requestedProfile})`
                  : "not recorded"}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>node indexes</TableCell>
              <TableCell>{nodeIndexes || "none"}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>way / relation indexes</TableCell>
              <TableCell>
                {info.spatialIndexes.ways ? "yes" : "no"} /{" "}
                {info.spatialIndexes.relations ? "yes" : "no"}
              </TableCell>
            </TableRow>
            {diagnostics ? (
              <>
                <TableRow>
                  <TableCell>resident typed buffers</TableCell>
                  <TableCell>{bytesSizeToHuman(diagnostics.bytes.residentTypedBuffers)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>projected peak</TableCell>
                  <TableCell>
                    {bytesSizeToHuman(diagnostics.bytes.projectedTypedBufferPeak)}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>largest planned allocation</TableCell>
                  <TableCell>
                    {bytesSizeToHuman(diagnostics.bytes.largestPlannedAllocation)}
                  </TableCell>
                </TableRow>
                {diagnostics.bytes.storageBytes !== undefined ? (
                  <TableRow>
                    <TableCell>storable transfer</TableCell>
                    <TableCell>{bytesSizeToHuman(diagnostics.bytes.storageBytes)}</TableCell>
                  </TableRow>
                ) : null}
                {diagnostics.reasons.map((reason) => (
                  <TableRow key={`${reason.code}:${reason.message}`}>
                    <TableCell>
                      {reason.level === "warning" ? "load warning" : "selection"}
                    </TableCell>
                    <TableCell>{reason.message}</TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell>
                    <SectionTitle>Phase timings (ms)</SectionTitle>
                  </TableCell>
                  <TableCell />
                </TableRow>
                <ObjectToTableRows object={diagnostics.phaseTimingsMs} />
              </>
            ) : null}
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
