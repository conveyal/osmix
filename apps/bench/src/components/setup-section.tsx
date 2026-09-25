import { loadStatements } from "../engines/duckdb-sql";
import { OSMIX_LOAD_CALL } from "../engines/osmix-engine";
import type { BenchReport } from "../harness/runner";
import { ENGINE_NAMES } from "../harness/runner";
import { formatBytes, formatMs, formatRatio } from "./format";

export function EnvironmentSection({ report }: { report: BenchReport }) {
  const { environment, setup, file } = report;
  return (
    <section>
      <h2>Environment</h2>
      <table>
        <tbody>
          <tr>
            <th>Browser</th>
            <td colSpan={2}>
              {environment.userAgent}
              <br />
              {environment.hardwareConcurrency} logical cores; cross-origin isolated:{" "}
              {environment.crossOriginIsolated ? "yes" : "no"}
            </td>
          </tr>
          <tr>
            <th>Dataset</th>
            <td colSpan={2}>
              {file.name}, {formatBytes(file.bytes)}.{" "}
              {setup.Osmix.load.counts.nodes.toLocaleString()} nodes,{" "}
              {setup.Osmix.load.counts.ways.toLocaleString()} ways,{" "}
              {setup.Osmix.load.counts.relations.toLocaleString()} relations.
            </td>
          </tr>
          {ENGINE_NAMES.map((name) => {
            const { info } = setup[name];
            return (
              <tr key={name}>
                <th>{name}</th>
                <td>
                  {info.version}
                  <br />
                  {info.threads} thread{info.threads === 1 ? "" : "s"}
                </td>
                <td>
                  <ul>
                    {info.notes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

export function SetupSection({ report }: { report: BenchReport }) {
  const { setup } = report;
  return (
    <section>
      <h2>Setup</h2>
      <p>
        Setup runs once per engine, cold. Load means &quot;ready to answer every query below&quot;:
        parsed, with the indexes each engine's queries rely on.
      </p>
      <table>
        <thead>
          <tr>
            <th>Step</th>
            <th>Osmix</th>
            <th>DuckDB</th>
            <th>Comparison</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              Initialize
              <div className="hint">
                Osmix: start the worker pool. DuckDB: start its worker, instantiate wasm, download
                and load the spatial and json extensions.
              </div>
            </td>
            <td>{formatMs(setup.Osmix.initializeMs)}</td>
            <td>{formatMs(setup.DuckDB.initializeMs)}</td>
            <td>Not comparable: DuckDB's includes network time</td>
          </tr>
          <tr>
            <td>Load</td>
            {ENGINE_NAMES.map((name) => (
              <td key={name}>
                <details>
                  <summary>{formatMs(setup[name].loadMs)}</summary>
                  <table className="phases">
                    <tbody>
                      {setup[name].load.phases.map((phase) => (
                        <tr key={phase.name}>
                          <td>{phase.name}</td>
                          <td>{formatMs(phase.ms)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              </td>
            ))}
            <td>{formatRatio(setup.Osmix.loadMs, setup.DuckDB.loadMs)}</td>
          </tr>
          <tr>
            <td>Memory after load</td>
            {ENGINE_NAMES.map((name) => (
              <td key={name}>
                {formatBytes(setup[name].memory.bytes)}
                <div className="hint">{setup[name].memory.source}</div>
              </td>
            ))}
            <td>Measured differently; see the sources</td>
          </tr>
        </tbody>
      </table>
      <details>
        <summary>Load code for each engine</summary>
        <dl>
          <dt>Osmix</dt>
          <dd>
            <pre>{OSMIX_LOAD_CALL}</pre>
          </dd>
          <dt>DuckDB</dt>
          <dd>
            {loadStatements(`/${report.file.name}`).map((statement) => (
              <pre key={statement.phase}>{`-- ${statement.phase}\n${statement.sql};`}</pre>
            ))}
          </dd>
        </dl>
      </details>
    </section>
  );
}
