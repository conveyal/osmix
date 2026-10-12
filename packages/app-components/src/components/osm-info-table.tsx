import type { StoredFileInfo } from "@osmix/app-core";
import {
  Alert,
  bytesSizeToHuman,
  Details,
  DetailsContent,
  DetailsSummary,
  ObjectToTableRows,
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
  TableRowHeader,
} from "@osmix/ui";
import type { Osm } from "osmix";

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
  // Local files retain their browser-provided name. Stored and URL-loaded files
  // use the metadata captured when the worker registered the dataset.
  const fileName = file?.name ?? fileInfo?.fileName;
  const fileSize = file?.size ?? fileInfo?.fileSize;

  if (!osm || (!file && !fileInfo)) return null;
  return (
    <Details defaultOpen={defaultOpen}>
      <DetailsSummary>File info</DetailsSummary>
      <DetailsContent>
        <Table aria-label="File info">
          <TableBody>
            {fileName ? (
              <TableRow>
                <TableRowHeader>file name</TableRowHeader>
                <TableCell>{fileName}</TableCell>
              </TableRow>
            ) : null}
            {fileSize != null && (
              <TableRow>
                <TableRowHeader>size</TableRowHeader>
                <TableCell>{bytesSizeToHuman(fileSize)}</TableCell>
              </TableRow>
            )}
            <TableRow>
              <TableRowHeader>nodes</TableRowHeader>
              <TableCell>{osm.nodes.size.toLocaleString()}</TableCell>
            </TableRow>
            <TableRow>
              <TableRowHeader>ways</TableRowHeader>
              <TableCell>{osm.ways.size.toLocaleString()}</TableCell>
            </TableRow>
            <TableRow>
              <TableRowHeader>relations</TableRowHeader>
              <TableCell>{osm.relations.size.toLocaleString()}</TableCell>
            </TableRow>
            <TableRow>
              <TableRowHeader>bbox</TableRowHeader>
              <TableCell>{osm.bbox()?.join(", ") ?? "empty"}</TableCell>
            </TableRow>
            <OsmLoadDetailsRows osm={osm} />
          </TableBody>
        </Table>
        <OsmLoadDiagnostics osm={osm} />
        <Table aria-label="PBF header">
          <TableHeader>
            <TableRow>
              <TableHead colSpan={2} className="pt-3">
                Header
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <ObjectToTableRows object={osm.header} />
          </TableBody>
        </Table>
      </DetailsContent>
    </Details>
  );
}

/**
 * How a dataset was loaded into memory: the load profile, its spatial indexes and the
 * typed-buffer sizes. Key/value rows for a `TableBody`; `OsmLoadDiagnostics` follows the table.
 */
export function OsmLoadDetailsRows({ osm }: { osm: Osm }) {
  const info = osm.info();
  const diagnostics = info.loadDiagnostics;
  const nodeIndexes = [
    info.spatialIndexes.nodes.tagged ? "tagged" : null,
    info.spatialIndexes.nodes.all ? "all" : null,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <>
      <TableRow>
        <TableRowHeader>load profile</TableRowHeader>
        <TableCell>
          {diagnostics
            ? `${diagnostics.selectedProfile} (requested ${diagnostics.requestedProfile})`
            : "not recorded"}
        </TableCell>
      </TableRow>
      <TableRow>
        <TableRowHeader>node indexes</TableRowHeader>
        <TableCell>{nodeIndexes || "none"}</TableCell>
      </TableRow>
      <TableRow>
        <TableRowHeader>way / relation indexes</TableRowHeader>
        <TableCell>
          {info.spatialIndexes.ways ? "yes" : "no"} / {info.spatialIndexes.relations ? "yes" : "no"}
        </TableCell>
      </TableRow>
      {diagnostics ? (
        <>
          <TableRow>
            <TableRowHeader>resident typed buffers</TableRowHeader>
            <TableCell>{bytesSizeToHuman(diagnostics.bytes.residentTypedBuffers)}</TableCell>
          </TableRow>
          <TableRow>
            <TableRowHeader>projected peak</TableRowHeader>
            <TableCell>{bytesSizeToHuman(diagnostics.bytes.projectedTypedBufferPeak)}</TableCell>
          </TableRow>
          <TableRow>
            <TableRowHeader>largest planned allocation</TableRowHeader>
            <TableCell>{bytesSizeToHuman(diagnostics.bytes.largestPlannedAllocation)}</TableCell>
          </TableRow>
          {diagnostics.bytes.storageBytes !== undefined ? (
            <TableRow>
              <TableRowHeader>storable transfer</TableRowHeader>
              <TableCell>{bytesSizeToHuman(diagnostics.bytes.storageBytes)}</TableCell>
            </TableRow>
          ) : null}
        </>
      ) : null}
    </>
  );
}

const TIMING_FORMAT = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/**
 * Why the load profile was chosen, as sentences (warnings as an `Alert`), then the load phase
 * timings as a right-aligned number column with the total in the footer. Nothing without
 * recorded diagnostics.
 */
export function OsmLoadDiagnostics({ osm }: { osm: Osm }) {
  const diagnostics = osm.info().loadDiagnostics;
  if (!diagnostics) return null;
  const { total, ...phases } = diagnostics.phaseTimingsMs;
  const warnings = diagnostics.reasons.filter((reason) => reason.level === "warning");
  const notes = diagnostics.reasons.filter((reason) => reason.level !== "warning");
  return (
    <>
      {diagnostics.reasons.length > 0 ? (
        <div className="flex flex-col gap-2 border-t p-inset">
          {warnings.map((reason) => (
            <Alert key={`${reason.code}:${reason.message}`} variant="warning">
              {reason.message}
            </Alert>
          ))}
          {notes.map((reason) => (
            <p key={`${reason.code}:${reason.message}`} className="text-muted-foreground">
              {reason.message}
            </p>
          ))}
        </div>
      ) : null}
      <Table aria-label="Load phase timings">
        <TableHeader>
          <TableRow>
            <TableHead className="pt-3">Phase</TableHead>
            <TableHead numeric className="pt-3">
              ms
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Object.entries(phases).map(([phase, ms]) => (
            <TableRow key={phase}>
              <TableRowHeader>{phase}</TableRowHeader>
              <TableCell numeric>{TIMING_FORMAT.format(ms)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
        {total !== undefined ? (
          <TableFooter>
            <TableRow>
              <TableRowHeader className="font-semibold text-foreground">total</TableRowHeader>
              <TableCell numeric>{TIMING_FORMAT.format(total)}</TableCell>
            </TableRow>
          </TableFooter>
        ) : null}
      </Table>
    </>
  );
}

/** Load details in a collapsed "Load details" section, for a dataset that is not a file. */
export function OsmLoadDetails({ osm, defaultOpen = false }: { osm: Osm; defaultOpen?: boolean }) {
  return (
    <Details defaultOpen={defaultOpen}>
      <DetailsSummary>Load details</DetailsSummary>
      <DetailsContent>
        <Table aria-label="Load details">
          <TableBody>
            <OsmLoadDetailsRows osm={osm} />
          </TableBody>
        </Table>
        <OsmLoadDiagnostics osm={osm} />
      </DetailsContent>
    </Details>
  );
}
