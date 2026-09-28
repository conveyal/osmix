import { getSaveFileSupport, type SaveFileSupport } from "@osmix/app-core";
import { Alert } from "@osmix/ui";
import { useEffect, useState } from "react";

/**
 * Explains, next to an export button, that this browser builds the whole file in memory before
 * saving it. Renders nothing where the native save picker writes straight to disk.
 */
export function SaveToDiskNotice() {
  const [support, setSupport] = useState<SaveFileSupport | null>(null);

  useEffect(() => {
    let disposed = false;
    void getSaveFileSupport().then((next) => {
      if (!disposed) setSupport(next);
    });
    return () => {
      disposed = true;
    };
  }, []);

  if (support === null || support === "native") return null;
  return (
    <Alert variant="info" title="Exports are built in memory first">
      {support === "brave-disabled" ? (
        <p>
          Brave turns off saving straight to disk, so the whole PBF is held in memory before the
          file is saved. To save large files directly, open{" "}
          <code className="font-mono">brave://flags/#file-system-access-api</code>, enable File
          System Access API, and relaunch Brave.
        </p>
      ) : (
        <p>
          This browser can't save straight to disk, so the whole PBF is held in memory before the
          file is saved. For large files, use Chrome or Edge.
        </p>
      )}
    </Alert>
  );
}
