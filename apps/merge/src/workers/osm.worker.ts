/**
 * Re-export the default OsmixWorker for proper Vite bundling.
 * Vite needs the worker to be in the app's source tree to handle it correctly.
 */
import { expose } from "comlink"
import { OsmixWorker } from "osmix"

expose(new OsmixWorker())
