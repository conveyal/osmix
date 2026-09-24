import type { OsmLoadFailure } from "@osmix/app-core";
import { Alert, Button, Details, DetailsContent, DetailsSummary } from "@osmix/ui";
import { RotateCcwIcon, XIcon } from "lucide-react";

function labelForTechnicalKey(key: string): string {
  return key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (letter) => letter.toUpperCase());
}

export function OsmLoadFailurePanel({
  failure,
  onDismiss,
  onReloadView,
}: {
  failure: OsmLoadFailure;
  onDismiss: () => void;
  onReloadView?: () => unknown;
}) {
  return (
    <Alert variant="destructive" aria-live="assertive" title={failure.title} className="m-2">
      <p>{failure.summary}</p>
      <p className="text-muted-foreground">{failure.suggestion}</p>
      <div className="flex flex-wrap gap-2">
        {failure.action === "reload-view" && onReloadView ? (
          <Button size="sm" variant="outline" onClick={() => void onReloadView()}>
            <RotateCcwIcon aria-hidden="true" />
            Reload using View
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          <XIcon aria-hidden="true" />
          Dismiss
        </Button>
      </div>
      <Details defaultOpen={false}>
        <DetailsSummary>Technical details</DetailsSummary>
        <DetailsContent className="flex flex-col gap-2 p-2">
          <OsmLoadFailureTechnicalDetails technical={failure.technical} />
        </DetailsContent>
      </Details>
    </Alert>
  );
}

/** The technical fields and stack of a load failure, shown collapsed under the failure. */
export function OsmLoadFailureTechnicalDetails({
  technical,
}: {
  technical: OsmLoadFailure["technical"];
}) {
  const { stack, ...fields } = technical;
  const entries = Object.entries(fields).filter((entry) => entry[1] !== undefined);
  return (
    <>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
        {entries.map(([key, value]) => (
          <div className="contents" key={key}>
            <dt className="text-muted-foreground">{labelForTechnicalKey(key)}</dt>
            <dd className="min-w-0 font-mono break-all">{String(value)}</dd>
          </div>
        ))}
      </dl>
      {stack ? (
        <pre className="max-h-40 overflow-auto border-t pt-2 font-mono whitespace-pre-wrap text-muted-foreground">
          {stack}
        </pre>
      ) : null}
    </>
  );
}
