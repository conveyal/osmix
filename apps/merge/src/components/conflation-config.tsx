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
            aria-describedby="conflation-enabled-help"
            checked={form.enabled}
            id="conflation-enabled"
            onCheckedChange={(enabled) => {
              updateForm((current) => ({ ...current, enabled }));
            }}
          />
          Enable proximity matching
        </CheckboxLabel>

        <p className="text-muted-foreground" id="conflation-enabled-help">
          Opt in to match imported entities against nearby base OSM. Exact reconciliation remains
          the default when this is disabled.
        </p>

        {form.enabled ? (
          <div className="flex flex-col gap-2 border-t pt-2">
            <CheckboxLabel>
              <Checkbox
                aria-describedby="conflation-property-transfer-help"
                checked={form.transferProperties}
                id="conflation-property-transfer"
                onCheckedChange={(transferProperties) => {
                  updateForm((current) => ({ ...current, transferProperties }));
                }}
              />
              Transfer selected properties
            </CheckboxLabel>
            <p className="text-muted-foreground" id="conflation-property-transfer-help">
              Copy only the selected OSM tags from an accepted imported match onto its base entity.
              This does not move geometry, rewrite the imported network, or delete a base tag when
              the imported value is absent. After tags transfer, an equivalent one-to-one imported
              way may be suppressed. Cleanup removes only its newly imported, tagless nodes that are
              no longer referenced by any way or relation.
            </p>

            <label className="flex flex-col gap-1" htmlFor="conflation-property-keys">
              <span>OSM tag keys to transfer</span>
              <Input
                aria-describedby="conflation-property-keys-help"
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
              <span className="text-muted-foreground" id="conflation-property-keys-help">
                Separate keys with commas or spaces. The defaults focus on crossing and kerb
                accessibility data. Imported values replace base values only for these keys;
                structural tags such as layer, bridge, tunnel, and area are protected, while
                routing-affecting tags require review.
              </span>
            </label>

            <CheckboxLabel>
              <Checkbox
                aria-describedby="conflation-network-attachment-help"
                checked={form.attachNetwork}
                id="conflation-network-attachment"
                onCheckedChange={(attachNetwork) => {
                  updateForm((current) => ({ ...current, attachNetwork }));
                }}
              />
              Attach compatible imported network nodes
            </CheckboxLabel>
            <p className="text-muted-foreground" id="conflation-network-attachment-help">
              Connect accepted imported ways by rewriting only patch-created way references to
              preserved base nodes. Base coordinates, base way references, and relation membership
              remain authoritative.
            </p>

            <label className="flex flex-col gap-1" htmlFor="conflation-distance">
              <span>Candidate search radius (meters)</span>
              <Input
                aria-describedby="conflation-distance-help"
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
              <span className="text-muted-foreground" id="conflation-distance-help">
                Nearby entities within this radius become candidates. Distance alone never
                guarantees acceptance; geometry, routing context, grade separation, and ambiguity
                checks still apply.
              </span>
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
