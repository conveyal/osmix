import { Alert, Checkbox, CheckboxLabel, useTaskLock } from "@osmix/ui";
import type { PatchIdMode } from "osmix";

/**
 * Patch IDs follow the OSM convention: a positive ID edits the base entity with that ID. When
 * a plan would replace base entities, say how many, and offer to read every patch feature as
 * new instead (MP-I1).
 */
export function PatchIdNotice({
  mode,
  onChange,
  replacesBase,
}: {
  mode: PatchIdMode;
  onChange: (mode: PatchIdMode) => unknown;
  replacesBase: number;
}) {
  const taskLocked = useTaskLock();
  if (replacesBase === 0 && mode === "osm") return null;
  const count = replacesBase.toLocaleString();
  return (
    <Alert
      variant="warning"
      title={
        mode === "new"
          ? "Every patch feature is read as new"
          : `${count} patch ${replacesBase === 1 ? "entity replaces a base entity" : "entities replace base entities"}`
      }
    >
      <p>
        {mode === "new"
          ? "Positive patch IDs are not treated as edits, so no base entity is replaced."
          : "Their positive IDs name existing base entities, so the patch versions replace them. If these IDs were not meant as edits, read every patch feature as new."}
      </p>
      <CheckboxLabel className="min-h-8">
        <Checkbox
          checked={mode === "new"}
          disabled={taskLocked}
          onCheckedChange={(checked) => void onChange(checked ? "new" : "osm")}
        />
        Treat all as new
      </CheckboxLabel>
    </Alert>
  );
}
