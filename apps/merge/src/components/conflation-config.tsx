import { useAtom, useSetAtom } from "jotai";

import { validateConflationForm } from "../lib/conflation-workflow";
import { conflationFormAtom, resetConflationReviewAtom } from "../state/conflation";
import { Card, CardContent, CardHeader } from "./ui/card";
import { Checkbox, CheckboxLabel } from "./ui/checkbox";
import { Input } from "./ui/input";

export function ConflationConfig() {
  const [form, setForm] = useAtom(conflationFormAtom);
  const resetReview = useSetAtom(resetConflationReviewAtom);
  const validationMessage = validateConflationForm(form);
  const updateForm = (update: (current: typeof form) => typeof form) => {
    setForm(update);
    resetReview();
  };

  return (
    <Card>
      <CardHeader>Match imported data</CardHeader>
      <CardContent className="flex flex-col gap-2">
        <CheckboxLabel>
          <Checkbox
            checked={form.enabled}
            onCheckedChange={(enabled) => {
              updateForm((current) => ({ ...current, enabled }));
            }}
          />
          Enable proximity matching
        </CheckboxLabel>

        <p className="text-muted-foreground">
          Opt in to match imported entities against nearby base OSM. Exact reconciliation remains
          the default when this is disabled.
        </p>

        {form.enabled ? (
          <div className="flex flex-col gap-2 border-t pt-2">
            <CheckboxLabel>
              <Checkbox
                checked={form.transferProperties}
                onCheckedChange={(transferProperties) => {
                  updateForm((current) => ({ ...current, transferProperties }));
                }}
              />
              Transfer selected properties
            </CheckboxLabel>

            <label className="flex flex-col gap-1" htmlFor="conflation-property-keys">
              <span>Property keys</span>
              <Input
                id="conflation-property-keys"
                disabled={!form.transferProperties}
                placeholder="name, surface, operator"
                value={form.propertyKeys}
                onChange={(event) => {
                  updateForm((current) => ({
                    ...current,
                    propertyKeys: event.target.value,
                  }));
                }}
              />
              <span className="text-muted-foreground">
                Recommended defaults target imported crossing and kerb accessibility data. Patch
                values win only for these keys.
              </span>
            </label>

            <CheckboxLabel>
              <Checkbox
                checked={form.attachNetwork}
                onCheckedChange={(attachNetwork) => {
                  updateForm((current) => ({ ...current, attachNetwork }));
                }}
              />
              Attach compatible imported network nodes
            </CheckboxLabel>

            <label className="flex flex-col gap-1" htmlFor="conflation-distance">
              <span>Maximum match distance (meters)</span>
              <Input
                id="conflation-distance"
                min="0.01"
                step="0.1"
                type="number"
                value={form.maxDistanceMeters}
                onChange={(event) => {
                  updateForm((current) => ({
                    ...current,
                    maxDistanceMeters: event.target.valueAsNumber,
                  }));
                }}
              />
            </label>

            <p className="text-muted-foreground">
              High-confidence matches apply automatically. Ambiguous, routing-affecting, and
              structurally uncertain candidates remain available for review.
            </p>

            {validationMessage ? (
              <p className="text-destructive" role="alert">
                {validationMessage}
              </p>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
