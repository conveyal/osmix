import { expose } from "comlink"
import { OsmixWorker } from "osmix"

console.log("Worker loaded")

expose(new OsmixWorker())
