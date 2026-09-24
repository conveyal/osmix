import { appOrigin, OsmLoadFailurePanel, OsmPbfFileInput } from "@osmix/app-components";
import {
  useLog,
  useOsmFile,
  mapBoundsAtom,
  selectOsmEntityAtom,
  osmLoadingAbortControllerAtom,
} from "@osmix/app-core";
import {
  ActionButton,
  Alert,
  Button,
  Card,
  CardContent,
  InfoTooltip,
  Input,
  Radio,
  RadioCard,
  Step,
} from "@osmix/ui";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { DownloadIcon, SaveIcon } from "lucide-react";
import type { ExtractStrategy } from "osmix";
import { useEffect, useState } from "react";

import ExtractTagFilterEditor, {
  conveyalTagFilterEditorState,
  rulesFromEditorState,
  type TagFilterEditorState,
} from "./components/extract-tag-filter-editor";
import { boundsLikeToBbox, isValidBbox, parseBboxString } from "./lib/extract-bbox";
import { OSM_KEY } from "./settings";
import { extractBboxAtom } from "./state/extract";

const STRATEGY_OPTIONS: {
  value: ExtractStrategy;
  label: string;
  hint: string;
}[] = [
  {
    value: "simple",
    label: "Simple",
    hint: "Strict bbox cut; geometries may be incomplete at the boundary.",
  },
  {
    value: "complete_ways",
    label: "Complete ways",
    hint: "Keep full way geometry; includes nodes outside the bbox when needed.",
  },
  {
    value: "smart",
    label: "Smart",
    hint: "Like complete ways, and resolves multipolygon relations completely.",
  },
];

export function ExtractPanel() {
  const extract = useOsmFile(OSM_KEY);
  const selectEntity = useSetAtom(selectOsmEntityAtom);
  const setLoadingState = useSetAtom(osmLoadingAbortControllerAtom);
  const mapBounds = useAtomValue(mapBoundsAtom);
  const { activeTasks } = useLog();

  const [bbox, setBbox] = useAtom(extractBboxAtom);
  const [bboxText, setBboxText] = useState("");
  const [bboxInputs, setBboxInputs] = useState(() => bbox.map((v) => String(v)));
  const [inputsBbox, setInputsBbox] = useState(bbox);
  if (inputsBbox !== bbox) {
    setInputsBbox(bbox);
    setBboxInputs(bbox.map((v) => String(v)));
  }
  const [strategy, setStrategy] = useState<ExtractStrategy>("complete_ways");
  const [tagFilterEditor, setTagFilterEditor] = useState<TagFilterEditorState>(
    conveyalTagFilterEditorState,
  );
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const isExtracting = activeTasks > 0;

  useEffect(() => {
    if (strategy !== "simple" && extract.loadProfile !== "full") {
      extract.setLoadProfile("full");
    }
  }, [extract.loadProfile, extract.setLoadProfile, strategy, extract]);

  const canExtract = !!pendingFile && isValidBbox(bbox) && !isExtracting;
  const hasExtractResult = !!extract.osm && !!extract.osmInfo;

  const applyParsedBboxString = () => {
    const parsed = parseBboxString(bboxText);
    if (parsed) setBbox(parsed);
  };

  const useMapViewAsBbox = () => {
    const next = boundsLikeToBbox(mapBounds);
    if (next) setBbox(next);
  };

  const runExtract = async () => {
    if (!pendingFile || !canExtract) return;
    selectEntity(null, null);
    const abortController = new AbortController();
    setLoadingState({ controller: abortController, osmKey: OSM_KEY });
    try {
      await extract.loadExtractFromPbf(
        pendingFile,
        {
          extractBbox: bbox,
          extractStrategy: strategy,
          extractTagFilter: rulesFromEditorState(tagFilterEditor),
        },
        abortController.signal,
      );
    } finally {
      setLoadingState(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Step number={1} title="Select bounding box">
        <CardContent className="flex flex-col gap-2">
          <p className="text-muted-foreground">
            Search on the map (top right), or edit coordinates below. The rectangle updates on the
            map.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1" htmlFor="extract-bbox-min-lon">
              Min longitude
              <Input
                id="extract-bbox-min-lon"
                type="number"
                step="any"
                value={bboxInputs[0]}
                onChange={(e) => {
                  const v = e.target.value;
                  setBboxInputs((prev) => [v, prev[1], prev[2], prev[3]]);
                  const n = Number.parseFloat(v);
                  if (Number.isFinite(n)) setBbox((b) => [n, b[1], b[2], b[3]]);
                }}
              />
            </label>
            <label className="flex flex-col gap-1" htmlFor="extract-bbox-min-lat">
              Min latitude
              <Input
                id="extract-bbox-min-lat"
                type="number"
                step="any"
                value={bboxInputs[1]}
                onChange={(e) => {
                  const v = e.target.value;
                  setBboxInputs((prev) => [prev[0], v, prev[2], prev[3]]);
                  const n = Number.parseFloat(v);
                  if (Number.isFinite(n)) setBbox((b) => [b[0], n, b[2], b[3]]);
                }}
              />
            </label>
            <label className="flex flex-col gap-1" htmlFor="extract-bbox-max-lon">
              Max longitude
              <Input
                id="extract-bbox-max-lon"
                type="number"
                step="any"
                value={bboxInputs[2]}
                onChange={(e) => {
                  const v = e.target.value;
                  setBboxInputs((prev) => [prev[0], prev[1], v, prev[3]]);
                  const n = Number.parseFloat(v);
                  if (Number.isFinite(n)) setBbox((b) => [b[0], b[1], n, b[3]]);
                }}
              />
            </label>
            <label className="flex flex-col gap-1" htmlFor="extract-bbox-max-lat">
              Max latitude
              <Input
                id="extract-bbox-max-lat"
                type="number"
                step="any"
                value={bboxInputs[3]}
                onChange={(e) => {
                  const v = e.target.value;
                  setBboxInputs((prev) => [prev[0], prev[1], prev[2], v]);
                  const n = Number.parseFloat(v);
                  if (Number.isFinite(n)) setBbox((b) => [b[0], b[1], b[2], n]);
                }}
              />
            </label>
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-muted-foreground" htmlFor="extract-bbox-paste">
              Paste bbox <code className="font-mono">min_lon,min_lat,max_lon,max_lat</code>
            </label>
            <div className="flex gap-2">
              <Input
                id="extract-bbox-paste"
                value={bboxText}
                onChange={(e) => setBboxText(e.target.value)}
                placeholder="-122.5,47.2,-122.3,47.5"
              />
              <Button type="button" variant="outline" onClick={applyParsedBboxString}>
                Parse
              </Button>
            </div>
          </div>
          <Button type="button" variant="outline" className="w-full" onClick={useMapViewAsBbox}>
            Use current map view as bbox
          </Button>
          {!isValidBbox(bbox) ? (
            <Alert variant="destructive">
              Invalid bbox: the minimum must be less than the maximum for both longitude and
              latitude.
            </Alert>
          ) : null}
        </CardContent>
      </Step>

      <Step number={2} title="Extract strategy">
        <CardContent className="flex flex-col gap-2">
          <p className="text-muted-foreground">
            See the{" "}
            <a
              href="https://osmcode.org/osmium-tool/manual.html#creating-geographic-extracts"
              target="_blank"
              rel="noreferrer"
            >
              Osmium Tool manual
            </a>{" "}
            for more information about each strategy. For usage with Conveyal, use "Complete ways".
          </p>
          <fieldset className="flex flex-col gap-2">
            <legend className="sr-only">Extract strategy</legend>
            {STRATEGY_OPTIONS.map((opt) => {
              const labelId = `extract-strategy-${opt.value}-label`;
              return (
                <RadioCard key={opt.value}>
                  {/* Name the radio by its label only, not the tooltip trigger's label. */}
                  <Radio
                    name="extract-strategy"
                    aria-labelledby={labelId}
                    checked={strategy === opt.value}
                    onChange={() => setStrategy(opt.value)}
                  />
                  <span id={labelId} className="flex-1 font-medium">
                    {opt.label}
                  </span>
                  <InfoTooltip label={`About the ${opt.label} extract strategy`} side="left">
                    {opt.hint}
                  </InfoTooltip>
                </RadioCard>
              );
            })}
          </fieldset>
          {strategy !== "simple" ? (
            <p className="text-muted-foreground">
              Complete ways and Smart require the Full node index, so this extract will load in Full
              mode.
            </p>
          ) : null}
        </CardContent>
      </Step>

      <Step number={3} title="Tag filters">
        <CardContent>
          <ExtractTagFilterEditor state={tagFilterEditor} onChange={setTagFilterEditor} />
        </CardContent>
      </Step>

      <Step number={4} title="OSM PBF file">
        <CardContent className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <OsmPbfFileInput
              file={pendingFile}
              loadProfile={extract.loadProfile}
              onLoadProfileChange={extract.setLoadProfile}
              setFile={async (f) => {
                setPendingFile(f);
                return;
              }}
              pbfOnly
              disabled={isExtracting}
            />
            {pendingFile ? <span className="truncate font-mono">{pendingFile.name}</span> : null}
          </div>
          {extract.loadFailure ? (
            <OsmLoadFailurePanel
              failure={extract.loadFailure}
              onDismiss={extract.clearLoadFailure}
            />
          ) : null}
        </CardContent>
      </Step>

      <Card>
        <CardContent className="flex flex-col gap-2">
          <ActionButton
            type="button"
            size="lg"
            className="w-full"
            disabled={!canExtract}
            onAction={runExtract}
          >
            Extract
          </ActionButton>
          <ActionButton
            type="button"
            disabled={!extract.osm || isExtracting || !hasExtractResult}
            variant="outline"
            className="w-full"
            icon={<DownloadIcon aria-hidden="true" />}
            onAction={() => extract.downloadOsm()}
          >
            Download extracted PBF
          </ActionButton>
          {hasExtractResult && !extract.isStored && extract.canStore ? (
            <ActionButton
              type="button"
              disabled={isExtracting}
              variant="outline"
              className="w-full"
              icon={<SaveIcon aria-hidden="true" />}
              onAction={() => extract.saveToStorage()}
            >
              Save to storage
            </ActionButton>
          ) : null}
          <p className="text-muted-foreground">
            Each app keeps its own storage. To merge this extract, download it and open it in{" "}
            <a href={appOrigin("merge")}>Merge</a>.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
