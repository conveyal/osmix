import { querySql } from "../engines/duckdb-sql";
import type { EngineTiming, OperationResult } from "../harness/runner";
import { formatMs, formatRatio } from "./format";
import { InlineCode } from "./inline-code";

function TimingCells({ timing }: { timing: EngineTiming | undefined }) {
  if (!timing) return <td colSpan={3}>—</td>;
  return (
    <>
      <td>{formatMs(timing.median)}</td>
      <td>{formatMs(timing.p95)}</td>
      <td>{formatMs(timing.cold)}</td>
    </>
  );
}

function OperationRow({ result }: { result: OperationResult }) {
  const { operation, parity, error, timings, duckdbPlan } = result;
  const status = error
    ? "✗ Engine failed"
    : parity?.equal
      ? `✓ ${parity.osmix}`
      : "✗ Answers differ";
  return (
    <>
      <tr className={parity?.equal ? undefined : "mismatch"}>
        <td>
          <a href={`#${operation.id}`}>{operation.title}</a>
        </td>
        <TimingCells timing={timings?.Osmix} />
        <TimingCells timing={timings?.DuckDB} />
        <td>{timings ? formatRatio(timings.Osmix.median, timings.DuckDB.median) : "Not timed"}</td>
        <td>{status}</td>
      </tr>
      <tr className="detail-row">
        <td colSpan={9}>
          <details id={operation.id}>
            <summary>How each engine answers this</summary>
            <dl>
              <dt>Meaning</dt>
              <dd>
                <InlineCode text={operation.meaning} />
              </dd>
              <dt>Osmix</dt>
              <dd>
                <InlineCode text={operation.osmix} />
              </dd>
              <dt>DuckDB</dt>
              <dd>
                <InlineCode text={operation.duckdb} />
                <pre>{querySql(operation.spec)}</pre>
                {duckdbPlan && <div className="hint">Plan: {duckdbPlan}</div>}
              </dd>
              {operation.notes && (
                <>
                  <dt>Tradeoffs</dt>
                  <dd>
                    <InlineCode text={operation.notes} />
                  </dd>
                </>
              )}
              <dt>Answers</dt>
              {parity ? (
                <dd>
                  Osmix: {parity.osmix}
                  <br />
                  DuckDB: {parity.duckdb}
                  {parity.diff && <pre>{parity.diff}</pre>}
                </dd>
              ) : (
                <dd>
                  <pre className="mismatch">{error}</pre>
                </dd>
              )}
            </dl>
          </details>
        </td>
      </tr>
    </>
  );
}

export function QuerySection({
  operations,
  config,
}: {
  operations: OperationResult[];
  config: { warmups: number; runs: number };
}) {
  const mismatches = operations.filter((result) => !result.parity?.equal).length;
  return (
    <section>
      <h2>Queries</h2>
      <p>
        Each query runs once cold on each engine, and the answers are compared. Only matching
        answers get timed: {config.warmups} warmups, then {config.runs} timed runs per engine, with
        the engine order alternating each run. Times include the round trip from the page to the
        engine's worker and back.
      </p>
      {mismatches > 0 && (
        <p className="mismatch">
          {mismatches} quer{mismatches === 1 ? "y" : "ies"} failed or returned different answers and{" "}
          {mismatches === 1 ? "was" : "were"} not timed. Open the row for details.
        </p>
      )}
      <table className="queries">
        <thead>
          <tr>
            <th rowSpan={2}>Query</th>
            <th colSpan={3}>Osmix</th>
            <th colSpan={3}>DuckDB</th>
            <th rowSpan={2}>Median ratio</th>
            <th rowSpan={2}>Same answer</th>
          </tr>
          <tr>
            <th>median</th>
            <th>p95</th>
            <th>cold</th>
            <th>median</th>
            <th>p95</th>
            <th>cold</th>
          </tr>
        </thead>
        <tbody>
          {operations.map((result) => (
            <OperationRow key={result.operation.id} result={result} />
          ))}
        </tbody>
      </table>
    </section>
  );
}
