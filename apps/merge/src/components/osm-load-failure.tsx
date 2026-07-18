import { AlertTriangleIcon, RotateCcwIcon, XIcon } from "lucide-react";

import type { OsmLoadFailure } from "../lib/osm-load-failure";
import { Button } from "./ui/button";

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
  const { stack, ...fields } = failure.technical;
  const entries = Object.entries(fields).filter((entry) => entry[1] !== undefined);
  return (
    <section
      role="alert"
      aria-live="assertive"
      className="m-2 rounded border border-destructive/40 bg-destructive/10 p-3 text-foreground"
    >
      <div className="flex items-start gap-2">
        <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="font-medium text-destructive">{failure.title}</div>
          <p>{failure.summary}</p>
          <p className="text-muted-foreground">{failure.suggestion}</p>
          <div className="flex flex-wrap gap-2">
            {failure.action === "reload-view" && onReloadView ? (
              <Button size="sm" variant="outline" onClick={() => void onReloadView()}>
                <RotateCcwIcon aria-hidden />
                Reload using View
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={onDismiss}>
              <XIcon aria-hidden />
              Dismiss
            </Button>
          </div>
          <details className="rounded border border-destructive/20 bg-background/70">
            <summary className="cursor-pointer px-2 py-1 font-medium">Technical details</summary>
            <div className="border-t border-destructive/20 p-2">
              <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
                {entries.map(([key, value]) => (
                  <div className="contents" key={key}>
                    <dt className="text-muted-foreground">{labelForTechnicalKey(key)}</dt>
                    <dd className="min-w-0 break-all">{String(value)}</dd>
                  </div>
                ))}
              </dl>
              {stack ? (
                <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap border-t pt-2 text-muted-foreground">
                  {stack}
                </pre>
              ) : null}
            </div>
          </details>
        </div>
      </div>
    </section>
  );
}
