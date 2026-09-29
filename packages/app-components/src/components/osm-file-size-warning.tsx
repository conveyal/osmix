import type { OsmFileSizeGuidance } from "@osmix/app-core";
import { Alert, Button } from "@osmix/ui";
import { ScissorsIcon, XIcon } from "lucide-react";

/**
 * Shown before a large PBF loads: what the file's size predicts (View only, or a likely
 * failure), with a way to cut a region out of it in Extract, to load it anyway, or to cancel.
 */
export function OsmFileSizeWarning({
  className,
  fileName,
  guidance,
  onCancel,
  onLoadAnyway,
  onOpenInExtract,
}: {
  /** Layout only: margins that place the alert inside flush content. */
  className?: string;
  fileName: string;
  guidance: Exclude<OsmFileSizeGuidance, { level: "full" }>;
  onCancel: () => void;
  onLoadAnyway: () => unknown;
  onOpenInExtract?: () => unknown;
}) {
  return (
    <Alert
      variant={guidance.level === "too-large" ? "destructive" : "warning"}
      title={guidance.title}
      className={className}
    >
      <p>
        <span className="font-mono">{fileName}</span>: {guidance.detail}
      </p>
      <div className="flex flex-wrap gap-2">
        {onOpenInExtract ? (
          <Button size="sm" variant="outline" onClick={() => void onOpenInExtract()}>
            <ScissorsIcon aria-hidden="true" />
            Open in Extract
          </Button>
        ) : null}
        <Button size="sm" variant="outline" onClick={() => void onLoadAnyway()}>
          Load anyway
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          <XIcon aria-hidden="true" />
          Cancel
        </Button>
      </div>
    </Alert>
  );
}
