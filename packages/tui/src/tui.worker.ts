import { expose } from "comlink";

import { TuiTileWorker } from "./tile-worker.ts";

// Index builders use console timers for development diagnostics. Worker output bypasses
// OpenTUI's console capture and would otherwise write directly into the alternate screen.
console.time = () => undefined;
console.timeEnd = () => undefined;

expose(new TuiTileWorker());
