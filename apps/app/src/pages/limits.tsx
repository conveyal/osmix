import {
  BulletList,
  FullPage,
  FullPageSection,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableRowHeader,
} from "@osmix/ui";

import {
  AUTO_PROFILE_RULES,
  DATA_LIMITS,
  FILE_SIZE_GUIDE,
  LIMITS_DOC_URL,
  MEASUREMENTS,
  MEMORY_RULES,
  ROUTER_LIMITS,
} from "../lib/limits";

/** Limits: which files Osmix can load and what works with them, then details for advanced users. */
export function LimitsPage() {
  return (
    <FullPage
      title="Limits"
      lead="Osmix keeps each dataset in your browser's memory. Memory, not disk space, sets the largest file that you can open."
      footer={
        <>
          Every limit, with its source in the code, is in{" "}
          <a href={LIMITS_DOC_URL} className="text-info underline">
            docs/limits.md
          </a>
          .
        </>
      }
    >
      <FullPageSection title="File sizes">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>PBF file size</TableHead>
              <TableHead>Example</TableHead>
              <TableHead>What to expect</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {FILE_SIZE_GUIDE.map((row) => (
              <TableRow key={row.size}>
                <TableCell>{row.size}</TableCell>
                <TableCell>{row.example}</TableCell>
                <TableCell>{row.expect}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </FullPageSection>
      <FullPageSection title="Memory">
        <BulletList items={MEMORY_RULES} />
      </FullPageSection>
      <FullPageSection title="Load modes">
        <p>
          Full builds every index, so every feature works. View leaves out the index of all nodes:
          the map, search and inspection work, but merge, deduplication, routing and complete
          extracts do not. Auto, the default, selects Full only when all of these are true:
        </p>
        <BulletList items={AUTO_PROFILE_RULES} />
      </FullPageSection>
      <FullPageSection title="Routing">
        <p>
          Routing uses the highway, oneway and maxspeed tags. It needs Full mode. It does not model:
        </p>
        <BulletList items={ROUTER_LIMITS} />
      </FullPageSection>
      <FullPageSection title="Data limits">
        <p>
          The storage format sets these limits. A way, relation or string that is too large stops
          the load with an error that names it.
        </p>
        <Table>
          <TableBody>
            {DATA_LIMITS.map((row) => (
              <TableRow key={row.limit}>
                <TableRowHeader>{row.limit}</TableRowHeader>
                <TableCell>{row.value}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </FullPageSection>
      <FullPageSection title="Measured memory">
        <p>Typed-array memory after a Full load, and the size of the routing graph.</p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Region</TableHead>
              <TableHead numeric>PBF</TableHead>
              <TableHead numeric>Nodes</TableHead>
              <TableHead numeric>Memory</TableHead>
              <TableHead numeric>Routing</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {MEASUREMENTS.map((row) => (
              <TableRow key={row.fixture}>
                <TableCell>{row.fixture}</TableCell>
                <TableCell numeric>{row.pbf}</TableCell>
                <TableCell numeric>{row.nodes}</TableCell>
                <TableCell numeric>{row.memory}</TableCell>
                <TableCell numeric>{row.routing}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </FullPageSection>
    </FullPage>
  );
}
