import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { Info, SaveIcon } from "lucide-react";
import type { ExtractStrategy } from "osmix";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";

import ExtractTagFilterEditor, {
  conveyalTagFilterEditorState,
  rulesFromEditorState,
  type TagFilterEditorState,
} from "../components/extract-tag-filter-editor";
import OsmPbfFileInput from "../components/osm-pbf-file-input";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { useLog } from "../hooks/log";
import { useFlyToOsmBounds } from "../hooks/map";
import { useOsmFile } from "../hooks/osm";
import { boundsLikeToBbox, isValidBbox, parseBboxString } from "../lib/extract-bbox";
import { cn } from "../lib/utils";
import { BASE_OSM_KEY, EXTRACT_OSM_KEY, PATCH_OSM_KEY } from "../settings";
import { activeTabAtom, extractBboxAtom } from "../state/extract";
import { mapBoundsAtom } from "../state/map";
import { selectOsmEntityAtom } from "../state/osm";
import { osmLoadingAbortControllerAtom } from "../state/status";

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

function StrategyInfoTooltip({ label, description }: { label: string; description: string }) {
  return (
    <span className="relative inline-flex shrink-0 group">
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground rounded-full p-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`About ${label} extract strategy`}
      >
        <Info className="size-3.5" aria-hidden />
      </button>
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute right-full top-1/2 z-100 mr-1.5 w-56 -translate-y-1/2 rounded-md border bg-popover px-2.5 py-1.5  font-normal text-popover-foreground shadow-md",
          "opacity-0 invisible transition-opacity",
          "group-hover:opacity-100 group-hover:visible group-focus-within:opacity-100 group-focus-within:visible",
        )}
      >
        {description}
      </span>
    </span>
  );
}

export default function ExtractBlock() {
  const extract = useOsmFile(EXTRACT_OSM_KEY);
  const base = useOsmFile(BASE_OSM_KEY);
  const patch = useOsmFile(PATCH_OSM_KEY);
  const flyToOsmBounds = useFlyToOsmBounds();
  const selectEntity = useSetAtom(selectOsmEntityAtom);
  const setLoadingState = useSetAtom(osmLoadingAbortControllerAtom);
  const mapBounds = useAtomValue(mapBoundsAtom);
  const { activeTasks } = useLog();
  const navigate = useNavigate();
  const setActiveTab = useSetAtom(activeTabAtom);

  const [bbox, setBbox] = useAtom(extractBboxAtom);
  const [bboxText, setBboxText] = useState("");
  const [bboxInputs, setBboxInputs] = useState(() => bbox.map((v) => String(v)));
  const [strategy, setStrategy] = useState<ExtractStrategy>("complete_ways");
  const [tagFilterEditor, setTagFilterEditor] = useState<TagFilterEditorState>(
    conveyalTagFilterEditorState,
  );
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const isExtracting = activeTasks > 0;

  useEffect(() => {
    const [w, s, e, n] = bbox;
    setBboxInputs([String(w), String(s), String(e), String(n)]);
  }, [bbox]);

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
    setLoadingState({ controller: abortController, osmKey: EXTRACT_OSM_KEY });
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

  const useAsBase = () => {
    if (!hasExtractResult) return;
    base.copyStateFrom({
      file: extract.file,
      fileInfo: extract.fileInfo,
      osm: extract.osm,
      osmInfo: extract.osmInfo,
      isStored: extract.isStored,
    });
    setActiveTab("Inspect");
    void navigate("/", { replace: true });
    if (extract.osmInfo) flyToOsmBounds(extract.osmInfo);
  };

  const useAsPatch = () => {
    if (!hasExtractResult) return;
    patch.copyStateFrom({
      file: extract.file,
      fileInfo: extract.fileInfo,
      osm: extract.osm,
      osmInfo: extract.osmInfo,
      isStored: extract.isStored,
    });
    setActiveTab("Merge");
    void navigate("/", { replace: true });
    if (extract.osmInfo) flyToOsmBounds(extract.osmInfo);
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>1. Select bounding box</CardHeader>
        <CardContent className="flex flex-col gap-2">
          <p className="text-muted-foreground">
            Search on the map (top right), or edit coordinates below. The rectangle updates on the
            map.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <label className=" flex flex-col gap-1" htmlFor="extract-bbox-min-lon">
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
            <label className=" flex flex-col gap-1" htmlFor="extract-bbox-min-lat">
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
            <label className=" flex flex-col gap-1" htmlFor="extract-bbox-max-lon">
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
            <label className=" flex flex-col gap-1" htmlFor="extract-bbox-max-lat">
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
            <label className=" text-muted-foreground" htmlFor="extract-bbox-paste">
              Paste bbox{" "}
              <code className="bg-muted px-1 rounded">min_lon,min_lat,max_lon,max_lat</code>
            </label>
            <div className="flex gap-2">
              <Input
                id="extract-bbox-paste"
                value={bboxText}
                onChange={(e) => setBboxText(e.target.value)}
                placeholder="-122.5,47.2,-122.3,47.5"
                className="font-mono"
              />
              <Button type="button" variant="outline" onClick={applyParsedBboxString}>
                Parse
              </Button>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full"
            onClick={useMapViewAsBbox}
          >
            Use current map view as bbox
          </Button>
          {!isValidBbox(bbox) ? (
            <p className=" text-destructive mt-1">
              Bbox must have min &lt; max for both lon and lat.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>2. Extract strategy</CardHeader>
        <CardContent className="flex flex-col gap-2">
          <p className="text-muted-foreground">
            See the{" "}
            <a
              href="https://osmcode.org/osmium-tool/manual.html#creating-geographic-extracts"
              target="_blank"
              rel="noreferrer"
              className="text-info"
            >
              Osmium Tool Manual
            </a>{" "}
            for more information about each strategy. For usage with Conveyal, use "Complete ways".
          </p>
          {STRATEGY_OPTIONS.map((opt) => {
            const inputId = `extract-strategy-${opt.value}`;
            return (
              <div
                key={opt.value}
                className={cn(
                  "flex items-center gap-2 rounded border p-2 ",
                  strategy === opt.value && "border-primary",
                )}
              >
                <input
                  id={inputId}
                  type="radio"
                  name="extract-strategy"
                  checked={strategy === opt.value}
                  onChange={() => setStrategy(opt.value)}
                />
                <label htmlFor={inputId} className="font-medium flex-1 cursor-pointer">
                  {opt.label}
                </label>
                <StrategyInfoTooltip label={opt.label} description={opt.hint} />
              </div>
            );
          })}
          {strategy !== "simple" ? (
            <p className="text-muted-foreground">
              Complete ways and Smart require the Full node index, so this extract will load in Full
              mode.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>3. Tag filters</CardHeader>
        <CardContent>
          <ExtractTagFilterEditor state={tagFilterEditor} onChange={setTagFilterEditor} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>4. OSM PBF file</CardHeader>
        <CardContent className="flex gap-2 items-center">
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
          {pendingFile?.name}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-2">
          <Button
            type="button"
            size="lg"
            className="w-full"
            disabled={!canExtract}
            onClick={() => void runExtract()}
          >
            Extract
          </Button>
          <Button
            type="button"
            disabled={!extract.osm || isExtracting || !hasExtractResult}
            variant="outline"
            className="w-full"
            onClick={() => void extract.downloadOsm()}
          >
            Download extracted PBF
          </Button>
          {hasExtractResult && !extract.isStored && extract.canStore ? (
            <Button
              type="button"
              disabled={isExtracting}
              variant="outline"
              className="w-full"
              onClick={() => void extract.saveToStorage()}
            >
              <SaveIcon className="size-4" aria-hidden />
              Save to storage
            </Button>
          ) : null}
          <Button
            type="button"
            disabled={isExtracting || !hasExtractResult}
            variant="outline"
            className="w-full"
            onClick={useAsBase}
          >
            Use as base OSM
          </Button>
          <Button
            type="button"
            disabled={isExtracting || !hasExtractResult}
            variant="outline"
            className="w-full"
            onClick={useAsPatch}
          >
            Use as patch OSM
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
