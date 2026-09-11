import { type Osm, OSM_CONTENT_HASH_VERSION } from "@osmix/core";

import type { OsmChangesetInputIdentity } from "./types.ts";

/** Capture only finalized inputs; ordinary in-memory changesets also support unbuilt indexes. */
export function changesetInputIdentity(osm: Osm): OsmChangesetInputIdentity | undefined {
  if (!osm.isReady()) return undefined;
  return {
    id: osm.id,
    contentHash: osm.contentHash(),
    contentHashVersion: OSM_CONTENT_HASH_VERSION,
  };
}

export function requireChangesetInputIdentity(
  identity: OsmChangesetInputIdentity | undefined,
  label: string,
): OsmChangesetInputIdentity {
  if (!identity) {
    throw Error(
      `Cannot serialize changeset: buildIndexes() must run on the original ${label} before generating changes`,
    );
  }
  return identity;
}

export function assertChangesetInputIdentity(
  osm: Osm,
  expected: OsmChangesetInputIdentity,
  label: string,
) {
  const actual = changesetInputIdentity(osm);
  if (
    !actual ||
    expected?.id !== actual.id ||
    expected.contentHashVersion !== actual.contentHashVersion ||
    expected.contentHash !== actual.contentHash
  ) {
    throw Error(
      `Changeset ${label} input context mismatch: restore the original indexed input with the recorded ID and content`,
    );
  }
}
