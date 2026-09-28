import {
  appOrigin,
  NominatimSearch,
  OsmDatasetCard,
  OsmLoadFailurePanel,
  OsmPbfFileInput,
  SaveToDiskNotice,
  useMap,
  useMapPadding,
} from "@osmix/app-components";
import {
  useTasks,
  useOsmFile,
  mapBoundsAtom,
  selectOsmEntityAtom,
  osmLoadingAbortControllerAtom,
  useOsmixRemote,
} from "@osmix/app-core";
import {
  ActionButton,
  Alert,
  Button,
  Card,
  CardContent,
  Checkbox,
  CheckboxLabel,
  Field,
  FieldDescription,
  FieldLabel,
  InfoTooltip,
  Input,
  Radio,
  RadioCard,
  Spinner,
  Step,
} from "@osmix/ui";
import { useAtom, useAtomValue, useSetAtom, useStore } from "jotai";
import { DownloadIcon } from "lucide-react";
import type { ExtractStrategy, GeoBbox2D } from "osmix";
import { useId, useRef, useState } from "react";

import ExtractTagFilterEditor, {
  conveyalTagFilterEditorState,
  rulesFromEditorState,
  type TagFilterEditorState,
} from "./components/extract-tag-filter-editor";
import {
  bboxesOverlap,
  boundsLikeToBbox,
  headerBboxToGeoBbox,
  isValidBbox,
  parseBboxString,
} from "./lib/extract-bbox";
import { OSM_KEY } from "./settings";
import {
  extractBboxAtom,
  type FileBounds,
  fileBoundsAtom,
  useFileBoundsAtom,
} from "./state/extract";

const STRATEGY_OPTIONS: {
  value: ExtractStrategy;
  label: string;
  hint: string;
}[] = [
  {
    value: "simple",
    label: "Simple",
    hint:
      "Strict bbox cut; geometries may be incomplete at the boundary. Loads with the Auto " +
      "profile: the full node index when it fits in memory, otherwise a lighter view index.",
  },
  {
    value: "complete_ways",
    label: "Complete ways",
    hint:
      "Keep full way geometry; includes nodes outside the bbox when needed. Requires the " +
      "full node index, so the file loads in Full mode.",
  },
  {
    value: "smart",
    label: "Smart",
    hint:
      "Like complete ways, and resolves multipolygon relations completely. Requires the " +
      "full node index, so the file loads in Full mode.",
  },
];

function FileBoundsDescription({ fileBounds }: { fileBounds: FileBounds }) {
  switch (fileBounds.status) {
    case "none":
      return <>Select a PBF file in step 1 first</>;
    case "reading":
      return (
        <span className="flex items-center gap-2">
          <Spinner /> Reading the file header…
        </span>
      );
    case "missing":
      return <>This file's header doesn't record its bounds; draw a bounding box instead</>;
    case "error":
      return <>Couldn't read this file's header: {fileBounds.message}</>;
    case "ok":
      return (
        <>
          From the file header: <span className="font-mono">{fileBounds.bbox.join(", ")}</span>
        </>
      );
  }
}

export function ExtractPanel() {
  const extract = useOsmFile(OSM_KEY);
  const selectEntity = useSetAtom(selectOsmEntityAtom);
  const setLoadingState = useSetAtom(osmLoadingAbortControllerAtom);
  const mapBounds = useAtomValue(mapBoundsAtom);
  const { current } = useTasks();

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
  const remote = useOsmixRemote();
  const map = useMap();
  const mapPadding = useMapPadding();
  const store = useStore();
  const [fileBounds, setFileBounds] = useAtom(fileBoundsAtom);
  const [useFileBounds, setUseFileBounds] = useAtom(useFileBoundsAtom);
  const [bboxBeforeFileBounds, setBboxBeforeFileBounds] = useState<GeoBbox2D | null>(null);
  const headerRequest = useRef(0);
  const findPlaceId = useId();

  // Only one task runs at a time, so any running task locks the extract controls.
  const isExtracting = current !== null;

  const bboxMissesFile =
    fileBounds.status === "ok" && isValidBbox(bbox) && !bboxesOverlap(bbox, fileBounds.bbox);
  const canExtract = !!pendingFile && isValidBbox(bbox) && !bboxMissesFile && !isExtracting;
  const hasExtractResult = !!extract.osm && !!extract.osmInfo;

  /** Turn off "use the file's bounds" and give back the bbox the user had before. */
  const stopUsingFileBounds = () => {
    if (!useFileBounds) return;
    if (bboxBeforeFileBounds) setBbox(bboxBeforeFileBounds);
    setBboxBeforeFileBounds(null);
    setUseFileBounds(false);
  };

  const selectFile = async (file: File | null) => {
    stopUsingFileBounds();
    setPendingFile(file);
    const request = ++headerRequest.current;
    if (!file) {
      setFileBounds({ status: "none" });
      return;
    }
    setFileBounds({ status: "reading" });
    try {
      const header = await remote.readHeader(file);
      if (request !== headerRequest.current) return;
      const headerBbox = headerBboxToGeoBbox(header.bbox);
      setFileBounds(headerBbox ? { status: "ok", bbox: headerBbox } : { status: "missing" });
      // When the bbox misses the file, show the file's outline and the warning together. Read
      // the bbox from the store: the closure's value predates `stopUsingFileBounds` above.
      const currentBbox = store.get(extractBboxAtom);
      if (headerBbox && isValidBbox(currentBbox) && !bboxesOverlap(currentBbox, headerBbox)) {
        map?.fitBounds(headerBbox, { padding: mapPadding(40), maxDuration: 500 });
      }
    } catch (error) {
      if (request !== headerRequest.current) return;
      const message = error instanceof Error ? error.message : String(error);
      setFileBounds({ status: "error", message });
    }
  };

  const changeUseFileBounds = (enabled: boolean) => {
    if (!enabled) {
      stopUsingFileBounds();
      return;
    }
    if (fileBounds.status !== "ok") return;
    setBboxBeforeFileBounds(bbox);
    setBbox(fileBounds.bbox);
    setUseFileBounds(true);
    map?.fitBounds(fileBounds.bbox, { padding: mapPadding(40), maxDuration: 500 });
  };

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
        abortController,
      );
    } finally {
      setLoadingState(null);
    }
  };

  const clearExtract = async () => {
    selectEntity(null, null);
    await extract.loadOsmFile(null);
  };

  return (
    <div className="flex flex-col gap-4">
      <Step number={1} title="Select OSM PBF file">
        <CardContent className="flex flex-col gap-2">
          <OsmPbfFileInput
            file={pendingFile}
            setFile={selectFile}
            pbfOnly
            disabled={isExtracting}
          />
          {extract.loadFailure ? (
            <OsmLoadFailurePanel
              failure={extract.loadFailure}
              onDismiss={extract.clearLoadFailure}
            />
          ) : null}
        </CardContent>
      </Step>

      <Step number={2} title="Select bounding box">
        <CardContent className="flex flex-col gap-2">
          <Field>
            <CheckboxLabel>
              <Checkbox
                checked={useFileBounds}
                disabled={fileBounds.status !== "ok" || isExtracting}
                aria-describedby="extract-file-bounds-help"
                onCheckedChange={changeUseFileBounds}
              />
              Use the selected file's bounds
            </CheckboxLabel>
            <FieldDescription id="extract-file-bounds-help">
              <FileBoundsDescription fileBounds={fileBounds} />
            </FieldDescription>
          </Field>
          {!useFileBounds ? (
            <>
              <p className="text-muted-foreground">
                Find a place, drag the corners on the map, or edit the coordinates below. The
                rectangle updates on the map.
              </p>
              <Field>
                <FieldLabel htmlFor={findPlaceId}>Find a place</FieldLabel>
                <NominatimSearch inputId={findPlaceId} label="Find a place" />
              </Field>
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
            </>
          ) : null}
          {!isValidBbox(bbox) ? (
            <Alert variant="destructive">
              Invalid bbox: the minimum must be less than the maximum for both longitude and
              latitude.
            </Alert>
          ) : null}
          {bboxMissesFile ? (
            <Alert variant="warning" title="The bounding box is outside this file">
              It doesn't overlap the file's bounds, so the extract would be empty. Move the box over
              the file's area or use the file's bounds.
            </Alert>
          ) : null}
        </CardContent>
      </Step>

      <Step number={3} title="Extract strategy">
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
        </CardContent>
      </Step>

      <Step number={4} title="Tag filters">
        <CardContent>
          <ExtractTagFilterEditor state={tagFilterEditor} onChange={setTagFilterEditor} />
        </CardContent>
      </Step>

      <Card>
        <CardContent>
          <ActionButton
            type="button"
            size="lg"
            className="w-full"
            disabled={!canExtract}
            onAction={runExtract}
          >
            Extract
          </ActionButton>
        </CardContent>
      </Card>

      {hasExtractResult ? (
        <OsmDatasetCard
          title="Extract result"
          name="extract result"
          osmFile={extract}
          actions={{ download: false }}
          onClear={clearExtract}
          primaryAction={
            <ActionButton
              type="button"
              disabled={isExtracting}
              className="w-full"
              icon={<DownloadIcon aria-hidden="true" />}
              onAction={() => extract.downloadOsm()}
            >
              Export extract as PBF
            </ActionButton>
          }
        >
          <div className="flex flex-col gap-2 p-inset">
            <SaveToDiskNotice />
            <p className="text-muted-foreground">
              To merge this extract, download it and open it in{" "}
              <a href={appOrigin("merge")}>Merge</a>.
            </p>
          </div>
        </OsmDatasetCard>
      ) : null}
    </div>
  );
}
