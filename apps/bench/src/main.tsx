import "./maplibre-worker";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";

import { MapCompare } from "./components/map-compare";
import { QuerySection } from "./components/query-section";
import { EnvironmentSection, SetupSection } from "./components/setup-section";
import { type BenchReport, runBench } from "./harness/runner";

const METHODOLOGY_URL = "https://github.com/conveyal/osmix/blob/main/apps/bench/METHODOLOGY.md";

type RunState =
  | { status: "idle" }
  | { status: "running"; log: string[] }
  | { status: "error"; log: string[]; error: string }
  | { status: "done"; report: BenchReport };

async function loadExampleFile() {
  const response = await fetch("/monaco.pbf");
  if (!response.ok) throw Error(`Could not fetch monaco.pbf: ${response.status}`);
  return new File([await response.blob()], "monaco.pbf");
}

function App() {
  const [file, setFile] = useState<File | null>(null);
  const [singleThread, setSingleThread] = useState(false);
  const [state, setState] = useState<RunState>({ status: "idle" });
  const running = state.status === "running";

  const run = async (selected: File) => {
    const log: string[] = [];
    setState({ status: "running", log });
    try {
      const report = await runBench({
        file: selected,
        ...(singleThread ? { osmixWorkers: 1 } : {}),
        onProgress: (message) => {
          log.push(message);
          setState({ status: "running", log: [...log] });
        },
      });
      setState({ status: "done", report });
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : String(error);
      setState({ status: "error", log, error: message });
    }
  };

  return (
    <main>
      <h1>Osmix vs DuckDB-wasm</h1>
      <p>
        Both engines load the same OSM PBF in the browser and answer the same queries. Each query
        has one written definition, and a row is only timed after both engines return the same
        answer. DuckDB runs the way its spatial docs recommend: normalized geometry tables with
        RTREE indexes, and the SQL for every query is shown below. Read the{" "}
        <a href={METHODOLOGY_URL}>methodology</a> for what each side does and where the comparison
        has limits. If you can make the DuckDB side faster, please open a pull request.
      </p>
      <p>
        This is <strong>duckdb-wasm</strong>, not native DuckDB. Native DuckDB is multi-threaded and
        has no 4 GB memory limit.
      </p>

      <fieldset disabled={running}>
        <legend>Run</legend>
        <input
          type="file"
          accept=".pbf,.osm.pbf"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
        {import.meta.env.DEV && (
          <button type="button" onClick={() => void loadExampleFile().then(setFile)}>
            Use monaco.pbf
          </button>
        )}
        <label>
          <input
            type="checkbox"
            checked={singleThread}
            onChange={(event) => setSingleThread(event.target.checked)}
          />{" "}
          Single-threaded Osmix (1 worker, matching DuckDB-wasm)
        </label>
        <button type="button" disabled={!file} onClick={() => file && void run(file)}>
          Run benchmark{file ? ` on ${file.name}` : ""}
        </button>
      </fieldset>

      {(state.status === "running" || state.status === "error") && (
        <pre className="log">
          {state.status === "error" ? `Failed: ${state.error}\n\n` : ""}
          {state.log.toReversed().join("\n")}
        </pre>
      )}

      {state.status === "done" && <Report report={state.report} />}
    </main>
  );
}

function Report({ report }: { report: BenchReport }) {
  return (
    <>
      <EnvironmentSection report={report} />
      <SetupSection report={report} />
      <QuerySection operations={report.operations} config={report.config} />
      {report.geojson ? (
        <MapCompare texts={report.geojson} bbox={report.setup.Osmix.load.bbox} />
      ) : (
        <section>
          <h2>GeoJSON exports</h2>
          <p>
            The exports are too large to draw here. The GeoJSON row above already compares every
            feature's ID and coordinate count.
          </p>
        </section>
      )}
    </>
  );
}

const rootElement = document.getElementById("root");
if (!rootElement) throw Error("Root element not found");

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
