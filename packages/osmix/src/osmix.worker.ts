/**
 * Default OsmixWorker entry point.
 *
 * This file serves as the default worker entry point that exposes a standard OsmixWorker.
 * For custom workers, import from "osmix/worker" instead to avoid the side effect.
 *
 * @example
 * // Using the default worker (via OsmixRemote with no workerUrl)
 * const remote = await OsmixRemote.connect()
 *
 * @example
 * // Custom worker - import from worker to avoid side effects
 * import { OsmixWorker } from "osmix/worker"
 * import { expose } from "comlink"
 *
 * class MyWorker extends OsmixWorker {
 *   myMethod() { ... }
 * }
 * expose(new MyWorker())
 */

import { expose } from "comlink"
import { OsmixWorker } from "./worker"

expose(new OsmixWorker())
