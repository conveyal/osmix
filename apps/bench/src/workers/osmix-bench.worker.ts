/**
 * Osmix worker with the bench queries. Queries run here, next to the data, and results
 * cross to the main thread the same way DuckDB's results cross from its worker.
 */

import { transfer } from "comlink";
import { exposeOsmixWorker, OsmixWorker } from "osmix";

import { resultTransferables, runOsmixQuery } from "../engines/osmix-queries";
import type { QueryResult, QuerySpec } from "../engines/types";

export class OsmixBenchWorker extends OsmixWorker {
  runQuery(osmId: string, spec: QuerySpec): QueryResult {
    const result = runOsmixQuery(this.get(osmId), spec);
    return transfer(result, resultTransferables(result));
  }
}

void exposeOsmixWorker(new OsmixBenchWorker());
