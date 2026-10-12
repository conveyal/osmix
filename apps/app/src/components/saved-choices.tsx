import { ActionButton, Alert, Button, SidebarSection, useTaskLock } from "@osmix/ui";
import { DownloadIcon, HistoryIcon, UploadIcon } from "lucide-react";

const choices = (count: number) =>
  `${count.toLocaleString()} ${count === 1 ? "choice" : "choices"}`;

/**
 * The review's choices outside this page: saved in this browser for the two input files as
 * they are made, offered back when the same files are planned again, and exported to or
 * imported from a file.
 */
export function SavedChoices({
  disabled,
  offered,
  onDiscardOffer,
  onExport,
  onImport,
  onRestore,
}: {
  /** Row choices wait to be applied; restoring, exporting or importing would miss or replace them. */
  disabled: boolean;
  /** Choices saved from an earlier review of these files, not restored yet. */
  offered: number | null;
  onDiscardOffer: () => unknown;
  onExport: () => unknown;
  onImport: () => unknown;
  onRestore: () => unknown;
}) {
  const taskLocked = useTaskLock();
  return (
    <SidebarSection title="Your choices">
      <div className="flex flex-col gap-2">
        {offered ? (
          <Alert role="status" className="flex flex-col gap-2">
            <p>
              {choices(offered)} saved from your last review of these files. Restoring replans once;
              making a choice instead replaces them.
            </p>
            <div className="flex flex-wrap gap-2">
              <ActionButton
                size="sm"
                icon={<HistoryIcon />}
                disabled={disabled}
                onAction={async () => onRestore()}
              >
                Restore {choices(offered)}
              </ActionButton>
              <Button
                size="sm"
                variant="ghost"
                disabled={taskLocked}
                onClick={() => void onDiscardOffer()}
              >
                Discard
              </Button>
            </div>
          </Alert>
        ) : null}
        <p className="text-muted-foreground">
          Choices are saved in this browser for these two files as you make them. Export them to
          continue elsewhere or share the review.
        </p>
        <div className="flex flex-wrap gap-2">
          <ActionButton
            size="sm"
            variant="outline"
            icon={<DownloadIcon />}
            disabled={disabled}
            onAction={async () => onExport()}
          >
            Export choices (.json)
          </ActionButton>
          <ActionButton
            size="sm"
            variant="outline"
            icon={<UploadIcon />}
            disabled={disabled}
            onAction={async () => onImport()}
          >
            Import choices
          </ActionButton>
        </div>
      </div>
    </SidebarSection>
  );
}
