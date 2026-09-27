import {
  Alert,
  Card,
  CardContent,
  CardHeader,
  Details,
  DetailsContent,
  DetailsSummary,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@osmix/ui";
import type { MergePlanOverview } from "osmix";

import { OUTCOME_HELP, OUTCOME_LABEL, OUTCOMES } from "../lib/merge-plan-workflow";
import { ConflationRoutingDiagnostics } from "./conflation-routing-diagnostics";

/** What the plan does, by imported feature, and anything that stops it from applying. */
export function PlanSummary({ overview }: { overview: MergePlanOverview }) {
  const { summary, diagnostics } = overview;
  return (
    <>
      {diagnostics.integrity.length > 0 ? (
        <Alert variant="destructive" title="This plan would break routing and cannot be applied">
          <ul className="list-disc pl-4">
            {diagnostics.integrity.slice(0, 5).map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
          {diagnostics.integrity.length > 5 ? (
            <p>And {(diagnostics.integrity.length - 5).toLocaleString()} more.</p>
          ) : null}
          <p>Reject the proposals involved, or fix the inputs, then review again.</p>
        </Alert>
      ) : null}
      {overview.staleDecisions.length > 0 ? (
        <Alert title="Some decisions no longer apply">
          <p>
            {overview.staleDecisions.length.toLocaleString()} saved{" "}
            {overview.staleDecisions.length === 1 ? "decision names" : "decisions name"} proposals
            this plan no longer has, usually because another decision changed it. They are kept in
            case the proposals return.
          </p>
        </Alert>
      ) : null}
      <Card role="region" aria-labelledby="plan-summary-title">
        <CardHeader id="plan-summary-title">Plan summary</CardHeader>
        <CardContent className="p-0">
          <Table aria-label="Imported features by outcome">
            <TableHeader>
              <TableRow>
                <TableHead>Outcome</TableHead>
                <TableHead>Features</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {OUTCOMES.filter((outcome) => summary.features[outcome] > 0).map((outcome) => (
                <TableRow key={outcome} title={OUTCOME_HELP[outcome]}>
                  <TableCell>{OUTCOME_LABEL[outcome]}</TableCell>
                  <TableCell>{summary.features[outcome].toLocaleString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {diagnostics.demoted.length > 0 ? (
            <p className="border-t p-inset text-muted-foreground">
              {diagnostics.demoted.length.toLocaleString()} automatic{" "}
              {diagnostics.demoted.length === 1 ? "connection needs" : "connections need"} review
              because they would change the drivable network.
            </p>
          ) : null}
        </CardContent>
      </Card>
      <Details defaultOpen={false}>
        <DetailsSummary>Routing topology</DetailsSummary>
        <DetailsContent>
          <ConflationRoutingDiagnostics diagnostics={diagnostics.routing} scope="plan" />
        </DetailsContent>
      </Details>
    </>
  );
}
