/**
 * Default OsmixWorker entry point.
 *
 * This file serves as the default worker entry point that exposes a standard OsmixWorker.
 * For custom workers, import from "osmix/worker-utils" instead to avoid the side effect.
 *
 * @example
 * // Using the default worker (via OsmixRemote with no workerUrl)
 * const remote = await OsmixRemote.connect()
 *
 * @example
 * // Custom worker - import from worker-utils to avoid side effects
 * import { OsmixWorker, exposeWorker } from "osmix/worker"
 *
 * class MyWorker extends OsmixWorker {
 *   myMethod() { ... }
 * }
 * exposeWorker(new MyWorker())
 */

import { exposeWorker } from "./utils"
import { OsmixWorker } from "./worker"

exposeWorker(new OsmixWorker())
