import {
  Alert,
  Button,
  Details,
  DetailsContent,
  DetailsSummary,
  SidebarSection,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@osmix/ui";
import type { MergePlanOverview } from "osmix";

import { OUTCOME_HELP, OUTCOME_LABEL, OUTCOMES } from "../lib/merge-plan-workflow";
import { RoutingTopology } from "./conflation-routing-diagnostics";

/**
 * What the plan does, by imported feature, and anything that stops it from applying. Each
 * integrity issue that concerns an imported feature offers **Show**, which opens that feature.
 */
export function PlanSummary({
  overview,
  onShowFeature,
}: {
  overview: MergePlanOverview;
  onShowFeature?: (featureKey: string) => unknown;
}) {
  const { summary, diagnostics } = overview;
  return (
    <SidebarSection flush title="Plan summary">
      {diagnostics.integrity.length > 0 || overview.staleDecisions.length > 0 ? (
        <div className="flex flex-col gap-2 px-inset pb-inset">
          {diagnostics.integrity.length > 0 ? (
            <Alert
              variant="destructive"
              title="This plan would break routing and cannot be applied"
            >
              <ul className="flex flex-col gap-1">
                {diagnostics.integrity.slice(0, 5).map(({ description, featureKey }) => (
                  <li key={description} className="flex items-start justify-between gap-2">
                    <span className="min-w-0 wrap-break-word">{description}</span>
                    {featureKey && onShowFeature ? (
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`Show the feature: ${description}`}
                        onClick={() => void onShowFeature(featureKey)}
                      >
                        Show
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
              {diagnostics.integrity.length > 5 ? (
                <p>And {(diagnostics.integrity.length - 5).toLocaleString()} more.</p>
              ) : null}
              <p>Leave out the proposals involved, or fix the inputs, then review again.</p>
            </Alert>
          ) : null}
          {overview.staleDecisions.length > 0 ? (
            <Alert title="Some decisions no longer apply">
              <p>
                {overview.staleDecisions.length.toLocaleString()} saved{" "}
                {overview.staleDecisions.length === 1 ? "decision names" : "decisions name"}{" "}
                proposals this plan no longer has, usually because another decision changed it. They
                are kept in case the proposals return.
              </p>
            </Alert>
          ) : null}
        </div>
      ) : null}
      <Table aria-label="Imported features by outcome">
        <TableHeader>
          <TableRow>
            <TableHead>Outcome</TableHead>
            <TableHead numeric>Features</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {OUTCOMES.filter((outcome) => summary.features[outcome] > 0).map((outcome) => (
            <TableRow key={outcome} title={OUTCOME_HELP[outcome]}>
              <TableCell>{OUTCOME_LABEL[outcome]}</TableCell>
              <TableCell numeric>{summary.features[outcome].toLocaleString()}</TableCell>
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
      <Details defaultOpen={false}>
        <DetailsSummary>Routing topology impact</DetailsSummary>
        <DetailsContent>
          <RoutingTopology diagnostics={diagnostics.routing} />
        </DetailsContent>
      </Details>
    </SidebarSection>
  );
}
