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
 * import { OsmixWorker, exposeWorker } from "osmix/worker-utils"
 *
 * class MyWorker extends OsmixWorker {
 *   myMethod() { ... }
 * }
 * exposeWorker(new MyWorker())
 */

// Re-export utilities for backwards compatibility with "osmix/worker" imports
export { exposeWorker, OsmixWorker } from "./worker-utils"

// Default worker entry point - expose a standard OsmixWorker instance
import { exposeWorker, OsmixWorker } from "./worker-utils"

exposeWorker(new OsmixWorker())
