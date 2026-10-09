import { Checkbox, CheckboxLabel, InfoTooltip, Input, SidebarSection } from "@osmix/ui";
import { useAtom, useSetAtom } from "jotai";

import { conflationFormErrors } from "../lib/conflation-workflow";
import { conflationFormAtom, resetMergePlanAtom } from "../state/merge-plan";

export function ConflationConfig() {
  const [form, setForm] = useAtom(conflationFormAtom);
  const resetReview = useSetAtom(resetMergePlanAtom);
  const errors = conflationFormErrors(form);
  const updateForm = (update: (current: typeof form) => typeof form) => {
    setForm(update);
    resetReview();
  };

  return (
    <SidebarSection title="Match imported data">
      <div className="flex items-center gap-1">
        <CheckboxLabel className="min-h-8">
          <Checkbox
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
            OSM tags are feature attributes, such as surface type or kerb height. Copy tags, connect
            paths, review geometry removal, and replace base ways independently.
          </p>
          <div className="flex items-center gap-1">
            <CheckboxLabel className="min-h-8">
              <Checkbox
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
              Copy only the selected OSM tags from an included imported match onto its base entity.
              Imported geometry stays intact, including matched ways and their connecting nodes.
              Missing imported values leave base tags unchanged. Direct merge and exact
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
                routing-affecting tags wait for review unless the automation level is Aggressive.
              </InfoTooltip>
            </div>
            <Input
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
              Connect included imported ways by rewriting only patch-created way references to
              preserved base nodes. Base coordinates, base way references, and relation membership
              remain authoritative.
            </InfoTooltip>
          </div>

          <p id="conflation-network-help" className="text-muted-foreground">
            Join eligible imported paths to existing base points. This changes how the paths
            connect.
          </p>
          <div className="flex flex-col gap-1">
            <label htmlFor="conflation-trace-length">Treat as the same path after (m)</label>
            <Input
              id="conflation-trace-length"
              name="matching-trace-length"
              aria-describedby={`conflation-trace-length-help${errors.traceLengthMeters ? " conflation-trace-length-error" : ""}`}
              aria-invalid={errors.traceLengthMeters ? true : undefined}
              disabled={!form.attachNetwork}
              min="0"
              step="any"
              type="number"
              inputMode="decimal"
              value={Number.isFinite(form.traceLengthMeters) ? form.traceLengthMeters : ""}
              onChange={(event) => {
                updateForm((current) => ({
                  ...current,
                  traceLengthMeters: event.target.valueAsNumber,
                }));
              }}
            />
            <p id="conflation-trace-length-help" className="text-muted-foreground">
              An imported path that runs this far along a base path is a copy of it; its points
              aren't connected to that path.
            </p>
            {errors.traceLengthMeters ? (
              <p id="conflation-trace-length-error" className="text-destructive">
                {errors.traceLengthMeters}
              </p>
            ) : null}
          </div>
          <CheckboxLabel className="min-h-8">
            <Checkbox
              checked={form.allowWayRemoval}
              id="conflation-way-removal"
              aria-describedby={`conflation-removal-help${errors.actions ? " conflation-actions-error" : ""}`}
              aria-invalid={errors.actions ? true : undefined}
              onCheckedChange={(allowWayRemoval) => {
                updateForm((current) => ({ ...current, allowWayRemoval }));
              }}
            />
            Review redundant way removal
          </CheckboxLabel>
          <p id="conflation-removal-help" className="text-muted-foreground">
            Propose removing an imported way that duplicates a base way. Each removal waits for its
            own Include in the review, at every automation level; nothing is removed automatically.
          </p>
          <CheckboxLabel className="min-h-8">
            <Checkbox
              checked={form.allowWayReplacement}
              id="conflation-way-replacement"
              aria-describedby={`conflation-replacement-help${errors.actions ? " conflation-actions-error" : ""}`}
              aria-invalid={errors.actions ? true : undefined}
              onCheckedChange={(allowWayReplacement) => {
                updateForm((current) => ({ ...current, allowWayReplacement }));
              }}
            />
            Replace base ways the import traces
          </CheckboxLabel>
          <p id="conflation-replacement-help" className="text-muted-foreground">
            Keep imported ways in place of the base ways they trace, deleting the base ways.
            Junctions and relations move to the imported ways. Waits for your review unless the
            automation level is Aggressive; a change of level or layer always waits.
          </p>
          <div className="flex flex-col gap-1">
            <label htmlFor="conflation-replacement-tolerance">Replacement tolerance (meters)</label>
            <Input
              id="conflation-replacement-tolerance"
              name="matching-replacement-tolerance"
              aria-describedby={`conflation-replacement-tolerance-help${errors.replacementToleranceMeters ? " conflation-replacement-tolerance-error" : ""}`}
              aria-invalid={errors.replacementToleranceMeters ? true : undefined}
              disabled={!form.allowWayReplacement}
              min="0"
              step="any"
              type="number"
              inputMode="decimal"
              value={
                Number.isFinite(form.replacementToleranceMeters)
                  ? form.replacementToleranceMeters
                  : ""
              }
              onChange={(event) => {
                updateForm((current) => ({
                  ...current,
                  replacementToleranceMeters: event.target.valueAsNumber,
                }));
              }}
            />
            <p id="conflation-replacement-tolerance-help" className="text-muted-foreground">
              How far apart an imported and a base way may be, everywhere along them.
            </p>
            {errors.replacementToleranceMeters ? (
              <p id="conflation-replacement-tolerance-error" className="text-destructive">
                {errors.replacementToleranceMeters}
              </p>
            ) : null}
          </div>
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
        </div>
      ) : null}
    </SidebarSection>
  );
}
