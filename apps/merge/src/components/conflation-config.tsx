import { useAtom, useSetAtom } from "jotai";

import { conflationFormErrors } from "../lib/conflation-workflow";
import { conflationFormAtom, resetConflationReviewAtom } from "../state/conflation";
import { InfoTooltip } from "./info-tooltip";
import { Card, CardContent, CardHeader } from "./ui/card";
import { Checkbox, CheckboxLabel } from "./ui/checkbox";
import { Input } from "./ui/input";

const CONTROL_FOCUS =
  "focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-solid forced-colors:focus-visible:outline-[CanvasText]";

export function ConflationConfig() {
  const [form, setForm] = useAtom(conflationFormAtom);
  const resetReview = useSetAtom(resetConflationReviewAtom);
  const errors = conflationFormErrors(form);
  const updateForm = (update: (current: typeof form) => typeof form) => {
    setForm(update);
    resetReview();
  };

  return (
    <Card role="region" aria-labelledby="conflation-settings-title">
      <CardHeader id="conflation-settings-title">Match imported data</CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div className="flex items-center gap-1">
          <CheckboxLabel className="min-h-8">
            <Checkbox
              className={CONTROL_FOCUS}
              checked={form.enabled}
              id="conflation-enabled"
              aria-describedby="conflation-enabled-help"
              onCheckedChange={(enabled) => {
                updateForm((current) => ({ ...current, enabled }));
              }}
            />
            Enable proximity matching
          </CheckboxLabel>
          <InfoTooltip label="About proximity matching" side="right" align="start">
            Opt in to match imported entities against nearby base OSM. Exact reconciliation remains
            the default when this is disabled.
          </InfoTooltip>
        </div>

        <p id="conflation-enabled-help" className="text-muted-foreground">
          Find possible matches between imported features and the nearby base dataset.
        </p>

        {form.enabled ? (
          <div className="flex flex-col gap-2 border-t pt-2">
            <p>
              OSM tags are feature attributes, such as surface type or kerb height. Choose copying,
              connecting, or both.
            </p>
            <div className="flex items-center gap-1">
              <CheckboxLabel className="min-h-8">
                <Checkbox
                  className={CONTROL_FOCUS}
                  checked={form.transferProperties}
                  id="conflation-property-transfer"
                  aria-describedby={`conflation-copy-help${errors.actions ? " conflation-actions-error" : ""}`}
                  aria-invalid={errors.actions ? true : undefined}
                  onCheckedChange={(transferProperties) => {
                    updateForm((current) => ({ ...current, transferProperties }));
                  }}
                />
                Copy tags
              </CheckboxLabel>
              <InfoTooltip label="About property transfer" side="right" align="start">
                Copy only the selected OSM tags from an accepted imported match onto its base
                entity. Imported geometry stays intact, including matched ways and their connecting
                nodes. Missing imported values leave base tags unchanged. Direct merge and exact
                reconciliation apply their own rules separately.
              </InfoTooltip>
            </div>

            <p id="conflation-copy-help" className="text-muted-foreground">
              Copy selected attributes to base features. Imported geometry stays intact; missing
              imported values leave base attributes unchanged.
            </p>

            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1">
                <label htmlFor="conflation-property-keys">OSM tag keys to copy</label>
                <InfoTooltip label="About transferable OSM tags" side="right" align="start">
                  Separate keys with commas or spaces. The defaults focus on crossing and kerb
                  accessibility data. Imported values replace base values only for these keys;
                  structural tags such as layer, bridge, tunnel, and area are protected, while
                  routing-affecting tags require review.
                </InfoTooltip>
              </div>
              <Input
                className={CONTROL_FOCUS}
                id="conflation-property-keys"
                name="matching-tag-keys"
                spellCheck={false}
                aria-describedby={`conflation-keys-help${errors.propertyKeys ? " conflation-keys-error" : ""}`}
                aria-invalid={errors.propertyKeys ? true : undefined}
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
              <p id="conflation-keys-help" className="text-muted-foreground">
                Use attribute names, separated by commas or spaces. Only selected keys are copied.
              </p>
              {errors.propertyKeys ? (
                <p id="conflation-keys-error" className="text-destructive">
                  {errors.propertyKeys}
                </p>
              ) : null}
            </div>

            <div className="flex items-center gap-1">
              <CheckboxLabel className="min-h-8">
                <Checkbox
                  className={CONTROL_FOCUS}
                  checked={form.attachNetwork}
                  id="conflation-network-attachment"
                  aria-describedby={`conflation-network-help${errors.actions ? " conflation-actions-error" : ""}`}
                  aria-invalid={errors.actions ? true : undefined}
                  onCheckedChange={(attachNetwork) => {
                    updateForm((current) => ({ ...current, attachNetwork }));
                  }}
                />
                Connect network
              </CheckboxLabel>
              <InfoTooltip label="About network attachment" side="right" align="start">
                Connect accepted imported ways by rewriting only patch-created way references to
                preserved base nodes. Base coordinates, base way references, and relation membership
                remain authoritative.
              </InfoTooltip>
            </div>

            <p id="conflation-network-help" className="text-muted-foreground">
              Join eligible imported paths to existing base points. This changes how the paths
              connect.
            </p>
            {errors.actions ? (
              <p id="conflation-actions-error" className="text-destructive">
                {errors.actions}
              </p>
            ) : null}

            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1">
                <label htmlFor="conflation-distance">Candidate search radius (meters)</label>
                <InfoTooltip label="About candidate search radius" side="right" align="start">
                  Nearby entities within this radius become candidates. Distance alone never
                  guarantees acceptance; geometry, routing context, grade separation, and ambiguity
                  checks still apply.
                </InfoTooltip>
              </div>
              <Input
                className={CONTROL_FOCUS}
                id="conflation-distance"
                name="matching-search-radius"
                aria-describedby={`conflation-distance-help${errors.maxDistanceMeters ? " conflation-distance-error" : ""}`}
                aria-invalid={errors.maxDistanceMeters ? true : undefined}
                min="0"
                step="any"
                type="number"
                inputMode="decimal"
                value={Number.isFinite(form.maxDistanceMeters) ? form.maxDistanceMeters : ""}
                onChange={(event) => {
                  updateForm((current) => ({
                    ...current,
                    maxDistanceMeters: event.target.valueAsNumber,
                  }));
                }}
              />
              <p id="conflation-distance-help" className="text-muted-foreground">
                Search nearby features within this distance in meters. Proximity alone does not
                establish a match.
              </p>
              {errors.maxDistanceMeters ? (
                <p id="conflation-distance-error" className="text-destructive">
                  {errors.maxDistanceMeters}
                </p>
              ) : null}
            </div>

            <div className="flex items-center gap-1 text-muted-foreground">
              Automatic decisions
              <InfoTooltip label="About automatic matching decisions" side="right" align="start">
                High-confidence actions are scheduled for the next preview. The dataset changes when
                you apply that preview. Ambiguous, routing-affecting, and structurally uncertain
                candidates remain available for review.
              </InfoTooltip>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
