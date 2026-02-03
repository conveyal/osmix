/**
 * Osmix Worker for the docs site.
 *
 * Exposes the standard OsmixWorker for client-side OSM processing.
 */

import * as Comlink from "comlink"
import { OsmixWorker } from "osmix"

Comlink.expose(new OsmixWorker())
