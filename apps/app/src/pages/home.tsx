import { pagePath } from "@osmix/app-components";
import { osmFileInfoAtomFamily } from "@osmix/app-core";
import { buttonVariants, FeatureSection, FullPage } from "@osmix/ui";
import { useAtomValue } from "jotai";
import { ArrowRightIcon } from "lucide-react";
import { Link } from "wouter";

import { extractSourceFileAtom } from "../pages/extract/state/extract";
import {
  BASE_OSM_KEY,
  EXTRACT_OSM_KEY,
  EXTRACT_SOURCE_OSM_KEY,
  INSPECT_OSM_KEY,
  PATCH_OSM_KEY,
} from "../settings";

/** A link to a page, styled as an outline button. */
function OpenPage({ page, label }: { page: Parameters<typeof pagePath>[0]; label: string }) {
  return (
    <Link href={pagePath(page)} className={buttonVariants({ variant: "outline" })}>
      {label}
      <ArrowRightIcon aria-hidden="true" />
    </Link>
  );
}

/** "Open now: …" for the files a page holds, or nothing. */
function openNow(parts: (string | null)[]) {
  const open = parts.filter((part) => part !== null);
  return open.length > 0 ? `Open now: ${open.join(", ")}` : undefined;
}

/** Home: what each page does, with a link to it and what it has open. */
export function HomePage() {
  const base = useAtomValue(osmFileInfoAtomFamily(BASE_OSM_KEY));
  const patch = useAtomValue(osmFileInfoAtomFamily(PATCH_OSM_KEY));
  const inspect = useAtomValue(osmFileInfoAtomFamily(INSPECT_OSM_KEY));
  const extract = useAtomValue(osmFileInfoAtomFamily(EXTRACT_OSM_KEY));
  const extractSourceFile = useAtomValue(extractSourceFileAtom);
  const extractSource = useAtomValue(osmFileInfoAtomFamily(EXTRACT_SOURCE_OSM_KEY));

  return (
    <FullPage
      title="Osmix"
      lead="Tools for OpenStreetMap PBF files that run entirely in your browser. A file you save to browser storage opens on every page."
      footer={
        <>
          Osmix is also a TypeScript library for loading, querying and merging OSM data:{" "}
          <a href="https://osmix.dev" className="text-info underline">
            osmix.dev
          </a>
          .
        </>
      }
    >
      <FeatureSection
        title="Merge"
        action={<OpenPage page="merge" label="Open Merge" />}
        features={[
          "Plan the merge, then review each imported feature: added, matched, connected or left out",
          "Match imported data to existing features to copy tags or connect networks, without rewriting the base",
          "Export the merged PBF, an osmChange file and a report",
        ]}
        status={openNow([
          base ? `base ${base.fileName}` : null,
          patch ? `patch ${patch.fileName}` : null,
        ])}
      >
        Combine an imported dataset (the patch) into an existing one (the base), and see every
        change before it is applied.
      </FeatureSection>
      <FeatureSection
        title="Inspect"
        action={<OpenPage page="inspect" label="Open Inspect" />}
        features={[
          "Search for places and entities, and inspect any node, way or relation",
          "Find and fix duplicate nodes and ways, then save or export the cleaned file",
          "Route between two points to check the network",
        ]}
        status={openNow([inspect?.fileName ?? null])}
      >
        Explore one dataset on the map and fix problems inside it.
      </FeatureSection>
      <FeatureSection
        title="Extract"
        action={<OpenPage page="extract" label="Open Extract" />}
        features={[
          "Draw a bounding box, search for a place, or use the file's own bounds",
          "Keep complete ways and relations, or cut strictly at the box, and filter by tag",
          "Save the result to open it in Inspect or Merge, or export it as a PBF",
        ]}
        status={openNow([
          extract
            ? extract.fileName
            : extractSourceFile
              ? `source ${extractSourceFile.name}`
              : extractSource
                ? `source ${extractSource.fileName}`
                : null,
        ])}
      >
        Cut a region out of a large PBF without loading the whole file.
      </FeatureSection>
    </FullPage>
  );
}
