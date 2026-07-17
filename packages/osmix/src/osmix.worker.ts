/**
 * Default OsmixWorker entry point.
 *
 * This file serves as the default worker entry point that exposes a standard OsmixWorker.
 * For custom workers, import {OsmixWorker} from "osmix" instead to avoid the side effect.
 *
 * @example
 * // Using the default worker (via OsmixRemote with no workerUrl)
 * const remote = await createRemote()
 *
 * @example
 * // Custom cross-runtime worker
 * import { exposeOsmixWorker, OsmixWorker } from "osmix"
 *
 * class MyWorker extends OsmixWorker {
 *   myMethod() { ... }
 * }
 * void exposeOsmixWorker(new MyWorker())
 */

import { exposeOsmixWorker } from "./worker-runtime.ts";
import { OsmixWorker } from "./worker.ts";

void exposeOsmixWorker(new OsmixWorker());
