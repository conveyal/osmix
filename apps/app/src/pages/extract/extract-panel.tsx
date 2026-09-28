import {
  NominatimSearch,
  OsmDatasetSection,
  OsmInfoTable,
  OsmLoadDetails,
  OsmLoadFailurePanel,
  OsmPbfFileInput,
  pagePath,
  SaveToDiskNotice,
  StoredOsmList,
  useFlyToOsmBounds,
  useMap,
  useMapPadding,
} from "@osmix/app-components";
import {
  useLoadFromUrl,
  useTasks,
  useOsmFile,
  mapBoundsAtom,
  selectOsmEntityAtom,
  osmLoadingAbortControllerAtom,
  type UseOsmFileReturn,
  useOsmixRemote,
} from "@osmix/app-core";
import {
  ActionButton,
  Alert,
  Button,
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
import { DownloadIcon, XIcon } from "lucide-react";
import type { ExtractStrategy, GeoBbox2D, OsmInfo } from "osmix";
import { useId, useRef, useState } from "react";
import { Link } from "wouter";

import { EXTRACT_OSM_KEY, EXTRACT_SOURCE_OSM_KEY } from "../../settings";
import { type ExtractParameters, ExtractResultStats } from "./components/extract-result-stats";
import ExtractTagFilterEditor, {
  rulesFromEditorState,
} from "./components/extract-tag-filter-editor";
import { SourceFileInfo } from "./components/source-file-info";
import {
  bboxesEqual,
  bboxesOverlap,
  boundsLikeToBbox,
  headerBboxToGeoBbox,
  isValidBbox,
  parseBboxString,
} from "./lib/extract-bbox";
import {
  automaticBboxAtom,
  bboxBeforeFileBoundsAtom,
  extractBboxAtom,
  extractParametersAtom,
  extractSourceFileAtom,
  extractSourceHeaderAtom,
  extractStrategyAtom,
  extractTagFilterEditorAtom,
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
          {fileBounds.from === "header" ? "From the file header" : "The dataset's extent"}:{" "}
          <span className="font-mono">{fileBounds.bbox.join(", ")}</span>
        </>
      );
  }
}

/** Why the last extract failed, if it did. */
function ExtractLoadFailure({ extract }: { extract: UseOsmFileReturn }) {
  if (!extract.loadFailure) return null;
  return <OsmLoadFailurePanel failure={extract.loadFailure} onDismiss={extract.clearLoadFailure} />;
}

export function ExtractPanel() {
  const extract = useOsmFile(EXTRACT_OSM_KEY);
  // A source from storage (or another page) is loaded here; a PBF file is streamed instead.
  const source = useOsmFile(EXTRACT_SOURCE_OSM_KEY);
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
  // The form lives in atoms, so it survives navigating to another page and back.
  const [strategy, setStrategy] = useAtom(extractStrategyAtom);
  const [tagFilterEditor, setTagFilterEditor] = useAtom(extractTagFilterEditorAtom);
  const [pendingFile, setPendingFile] = useAtom(extractSourceFileAtom);
  const [sourceHeader, setSourceHeader] = useAtom(extractSourceHeaderAtom);
  const [extractParameters, setExtractParameters] = useAtom(extractParametersAtom);
  const flyToOsmBounds = useFlyToOsmBounds();
  const remote = useOsmixRemote();
  const map = useMap();
  const mapPadding = useMapPadding();
  const store = useStore();
  const [fileBounds, setFileBounds] = useAtom(fileBoundsAtom);
  const [useFileBounds, setUseFileBounds] = useAtom(useFileBoundsAtom);
  const [bboxBeforeFileBounds, setBboxBeforeFileBounds] = useAtom(bboxBeforeFileBoundsAtom);
  const headerRequest = useRef(0);
  const findPlaceId = useId();

  // Only one task runs at a time, so any running task locks the extract controls.
  const isExtracting = current !== null;

  const sourceDataset =
    source.osm && source.osmInfo && source.fileInfo
      ? { osmId: source.osmInfo.id, fileName: source.fileInfo.fileName }
      : null;
  const bboxMissesFile =
    fileBounds.status === "ok" && isValidBbox(bbox) && !bboxesOverlap(bbox, fileBounds.bbox);
  const canExtract =
    (pendingFile !== null || sourceDataset !== null) &&
    isValidBbox(bbox) &&
    !bboxMissesFile &&
    !isExtracting;
  const extractOsm = extract.osmInfo ? extract.osm : null;

  /** Turn off "use the file's bounds" and give back the bbox the user had before. */
  const stopUsingFileBounds = () => {
    if (!useFileBounds) return;
    if (bboxBeforeFileBounds) setBbox(bboxBeforeFileBounds);
    setBboxBeforeFileBounds(null);
    setUseFileBounds(false);
  };

  /** Show a new source's bounds, and start an unedited bbox from them. */
  const applySourceBounds = (sourceBbox: GeoBbox2D | null, from: "header" | "dataset") => {
    setFileBounds(sourceBbox ? { status: "ok", bbox: sourceBbox, from } : { status: "missing" });
    if (!sourceBbox) return;
    // Read the bbox from the store: the closure's value predates `stopUsingFileBounds`.
    const currentBbox = store.get(extractBboxAtom);
    if (bboxesEqual(currentBbox, store.get(automaticBboxAtom))) {
      // An unedited bbox starts from the file's bounds, ready to narrow. "Use the selected
      // file's bounds" stays off, so the coordinates remain editable.
      setBbox(sourceBbox);
      store.set(automaticBboxAtom, sourceBbox);
      map?.fitBounds(sourceBbox, { padding: mapPadding(40), maxDuration: 500 });
    } else if (isValidBbox(currentBbox) && !bboxesOverlap(currentBbox, sourceBbox)) {
      // An edited bbox that misses the file: show the file's outline and the warning together.
      map?.fitBounds(sourceBbox, { padding: mapPadding(40), maxDuration: 500 });
    }
  };

  /** Stream a PBF file as the source. Any source dataset is freed. */
  const selectFile = async (file: File | null) => {
    stopUsingFileBounds();
    setPendingFile(file);
    setSourceHeader(null);
    const request = ++headerRequest.current;
    if (source.osmInfo) await source.loadOsmFile(null);
    if (!file) {
      setFileBounds({ status: "none" });
      return;
    }
    setFileBounds({ status: "reading" });
    try {
      const header = await remote.readHeader(file);
      if (request !== headerRequest.current) return;
      setSourceHeader(header);
      applySourceBounds(headerBboxToGeoBbox(header.bbox), "header");
    } catch (error) {
      if (request !== headerRequest.current) return;
      const message = error instanceof Error ? error.message : String(error);
      setFileBounds({ status: "error", message });
    }
  };

  /**
   * Load a source dataset: a stored file, a URL, or a file in another format, which the extract
   * cannot stream. A selected PBF file is dropped.
   */
  const openSourceDataset = async (
    load: (controller: AbortController) => Promise<OsmInfo | null>,
  ) => {
    stopUsingFileBounds();
    ++headerRequest.current;
    setPendingFile(null);
    setSourceHeader(null);
    setFileBounds({ status: "none" });
    const controller = new AbortController();
    setLoadingState({ controller, osmKey: EXTRACT_SOURCE_OSM_KEY });
    try {
      const info = await load(controller);
      if (info) applySourceBounds(info.bbox, "dataset");
      return info;
    } finally {
      setLoadingState(null);
    }
  };

  // `?load=<hash>` opens a stored file as the source. Extract never opens one on its own.
  useLoadFromUrl({
    osmKey: EXTRACT_SOURCE_OSM_KEY,
    loadFromStorage: (storageId) =>
      openSourceDataset((controller) => source.loadFromStorage(storageId, controller)),
    fallbackToMostRecent: false,
  });

  const clearSourceDataset = async () => {
    stopUsingFileBounds();
    setFileBounds({ status: "none" });
    await source.loadOsmFile(null);
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
    const extractSource = pendingFile ?? sourceDataset;
    if (!extractSource || !canExtract) return;
    selectEntity(null, null);
    const abortController = new AbortController();
    setLoadingState({ controller: abortController, osmKey: EXTRACT_OSM_KEY });
    const parameters: ExtractParameters = {
      sourceName: extractSource instanceof File ? extractSource.name : extractSource.fileName,
      bbox,
      strategy,
      tagFilter: rulesFromEditorState(tagFilterEditor),
    };
    setExtractParameters(null);
    try {
      const loaded = await extract.loadExtract(
        extractSource,
        {
          extractBbox: parameters.bbox,
          extractStrategy: parameters.strategy,
          extractTagFilter: parameters.tagFilter,
        },
        abortController,
      );
      if (loaded) {
        setExtractParameters(parameters);
        flyToOsmBounds(loaded);
      }
    } finally {
      setLoadingState(null);
    }
  };

  const clearExtract = async () => {
    selectEntity(null, null);
    setExtractParameters(null);
    await extract.loadOsmFile(null);
  };

  return (
    <>
      {/* A finished extract replaces the form; clearing the result brings the form back. */}
      {extractOsm ? null : (
        <>
          {pendingFile ? (
            <Step number={1} title="Select OSM PBF file">
              <OsmPbfFileInput
                file={pendingFile}
                setFile={selectFile}
                pbfOnly
                disabled={isExtracting}
              />
              <SourceFileInfo file={pendingFile} header={sourceHeader} />
              <ExtractLoadFailure extract={extract} />
            </Step>
          ) : sourceDataset && source.osm ? (
            <Step
              number={1}
              title="Select OSM PBF file"
              flush
              action={
                <ActionButton
                  variant="ghost"
                  label="Clear source"
                  icon={<XIcon aria-hidden="true" />}
                  disabled={isExtracting}
                  onAction={clearSourceDataset}
                />
              }
            >
              <p className="truncate px-inset pb-2 font-mono text-muted-foreground">
                {sourceDataset.fileName}
              </p>
              <OsmInfoTable
                defaultOpen={false}
                osm={source.osm}
                file={source.file}
                fileInfo={source.fileInfo}
              />
              <div className="p-inset empty:hidden">
                <ExtractLoadFailure extract={extract} />
              </div>
            </Step>
          ) : (
            <Step number={1} title="Select OSM PBF file" flush>
              <p className="px-inset pb-2 text-muted-foreground">
                A PBF file is read as it is extracted, never loaded whole. A stored file, a URL or
                another format is loaded first.
              </p>
              <StoredOsmList
                osmKey={EXTRACT_SOURCE_OSM_KEY}
                loadFailure={source.loadFailure}
                onDismissLoadFailure={source.clearLoadFailure}
                onReloadView={source.reloadWithViewProfile}
                openOsmPbfUrl={(url) =>
                  openSourceDataset((controller) => source.loadOsmPbfUrl(url, controller))
                }
                openOsmFile={async (file, fileType) => {
                  if (typeof file === "string") {
                    return openSourceDataset((controller) =>
                      source.loadFromStorage(file, controller),
                    );
                  }
                  if (fileType === undefined || fileType === "pbf") {
                    await selectFile(file);
                    return null;
                  }
                  return openSourceDataset((controller) =>
                    source.loadOsmFile(file, fileType, controller),
                  );
                }}
              />
              <div className="p-inset empty:hidden">
                <ExtractLoadFailure extract={extract} />
              </div>
            </Step>
          )}

          <Step number={2} title="Select bounding box">
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
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={useMapViewAsBbox}
                >
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
                It doesn't overlap the file's bounds, so the extract would be empty. Move the box
                over the file's area or use the file's bounds.
              </Alert>
            ) : null}
          </Step>

          <Step number={3} title="Extract strategy">
            <p className="text-muted-foreground">
              See the{" "}
              <a
                href="https://osmcode.org/osmium-tool/manual.html#creating-geographic-extracts"
                target="_blank"
                rel="noreferrer"
              >
                Osmium Tool manual
              </a>{" "}
              for more information about each strategy. For usage with Conveyal, use "Complete
              ways".
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
          </Step>

          <Step number={4} title="Tag filters">
            <ExtractTagFilterEditor state={tagFilterEditor} onChange={setTagFilterEditor} />
          </Step>

          <div className="p-inset">
            <ActionButton
              type="button"
              size="lg"
              className="w-full"
              disabled={!canExtract}
              onAction={runExtract}
            >
              Extract
            </ActionButton>
          </div>
        </>
      )}

      {extractOsm ? (
        <OsmDatasetSection
          title="Extract result"
          name="extract result"
          osmFile={extract}
          actions={{ download: false }}
          onClear={clearExtract}
          details={
            <>
              <ExtractResultStats osm={extractOsm} parameters={extractParameters} />
              <OsmLoadDetails osm={extractOsm} defaultOpen />
            </>
          }
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
              To merge this extract, save it to storage, then open it from the stored files in{" "}
              <Link href={pagePath("merge")} className="text-info underline">
                Merge
              </Link>
              .
            </p>
            <p className="text-muted-foreground">
              To change the file, bounding box, strategy or tag filters, clear this result. The
              settings you used are kept.
            </p>
          </div>
        </OsmDatasetSection>
      ) : null}
    </>
  );
}
