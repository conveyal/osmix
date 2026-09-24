import { fetchOsmFileFromUrl, Log } from "@osmix/app-core";
import {
  ActionButton,
  Button,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Item,
  Select,
} from "@osmix/ui";
import { ChevronDownIcon, FilesIcon, LinkIcon, XIcon } from "lucide-react";
import type { OsmFileType, OsmLoadProfile } from "osmix";
import { useId, useState } from "react";

/** File type options with labels and accepted extensions */
const FILE_TYPE_OPTIONS: {
  type: OsmFileType;
  label: string;
  description: string;
  accept: string;
}[] = [
  {
    type: "pbf",
    label: "OSM PBF",
    description: "OpenStreetMap Protocol Buffer format",
    accept: ".pbf,.osm.pbf",
  },
  {
    type: "geojson",
    label: "GeoJSON",
    description: "GeoJSON feature collection",
    accept: ".geojson,.json",
  },
  {
    type: "shapefile",
    label: "Shapefile (ZIP)",
    description: "ESRI Shapefile in ZIP archive",
    accept: ".zip",
  },
  {
    type: "geoparquet",
    label: "GeoParquet",
    description: "Apache Parquet with geometry",
    accept: ".parquet",
  },
  {
    type: "gtfs",
    label: "GTFS (ZIP)",
    description: "General Transit Feed Specification in ZIP archive",
    accept: ".zip",
  },
];

export default function OsmPbfFileInput({
  disabled,
  file,
  loadProfile,
  onLoadProfileChange,
  pbfOnly,
  setFile,
}: {
  disabled?: boolean;
  file?: File | null;
  loadProfile?: OsmLoadProfile;
  onLoadProfileChange?: (profile: OsmLoadProfile) => void;
  pbfOnly?: boolean;
  setFile: (file: File | null, fileType?: OsmFileType) => Promise<void>;
}) {
  return (
    <div className="flex flex-1 flex-col gap-2">
      <div className="flex items-center gap-2">
        {!file ? (
          <OsmPbfSelectFileButton disabled={disabled} pbfOnly={pbfOnly} setFile={setFile} />
        ) : (
          <OsmPbfClearFileButton disabled={disabled} clearFile={() => setFile(null)} />
        )}
      </div>
      {loadProfile && onLoadProfileChange ? (
        <OsmLoadProfileSelector
          disabled={disabled}
          value={loadProfile}
          onChange={onLoadProfileChange}
        />
      ) : null}
    </div>
  );
}

const LOAD_PROFILE_OPTIONS: Array<{
  value: OsmLoadProfile;
  label: string;
  description: string;
}> = [
  {
    value: "auto",
    label: "Auto",
    description: "Choose Full when it fits; otherwise use View.",
  },
  {
    value: "full",
    label: "Full",
    description: "Build every index for merge, complete extracts, and routing.",
  },
  {
    value: "view",
    label: "View",
    description: "Skip the all-node index to reduce memory use.",
  },
];

export function OsmLoadProfileSelector({
  disabled,
  onChange,
  value,
}: {
  disabled?: boolean;
  onChange: (profile: OsmLoadProfile) => void;
  value: OsmLoadProfile;
}) {
  const id = useId();
  const descriptionId = useId();
  const selected = LOAD_PROFILE_OPTIONS.find((option) => option.value === value)!;
  return (
    <Item variant="outline" className="flex-col items-stretch gap-1 bg-muted/50">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="font-medium">
          Advanced load profile
        </label>
        <Select
          id={id}
          className="w-auto"
          aria-describedby={descriptionId}
          disabled={disabled}
          items={LOAD_PROFILE_OPTIONS}
          value={value}
          onValueChange={onChange}
        />
      </div>
      <div id={descriptionId} className="text-muted-foreground">
        {selected.description}
      </div>
    </Item>
  );
}

export function OsmPbfSelectFileButton({
  disabled,
  pbfOnly,
  setFile,
}: {
  disabled?: boolean;
  /** Skip format menu and open only `.pbf` / `.osm.pbf`. */
  pbfOnly?: boolean;
  setFile: (file: File | null, fileType?: OsmFileType) => Promise<void>;
}) {
  const [isLoading, setIsLoading] = useState(false);

  const handleSelectFileType = async (fileType: OsmFileType) => {
    const option = FILE_TYPE_OPTIONS.find((opt) => opt.type === fileType);
    if (!option) return;

    setIsLoading(true);
    try {
      const selectedFile = await showFileSelector(option.accept);
      if (selectedFile) {
        await setFile(selectedFile, fileType);
      }
    } finally {
      setIsLoading(false);
    }
  };

  if (pbfOnly) {
    return (
      <Button
        type="button"
        disabled={disabled || isLoading}
        className="w-full flex-1"
        onClick={async () => {
          setIsLoading(true);
          try {
            const selectedFile = await showFileSelector(".pbf,.osm.pbf");
            if (selectedFile) await setFile(selectedFile, "pbf");
          } finally {
            setIsLoading(false);
          }
        }}
      >
        <FilesIcon aria-hidden="true" />
        Open file
      </Button>
    );
  }

  return (
    <Menu>
      <MenuTrigger disabled={disabled || isLoading} className="flex-1">
        <FilesIcon aria-hidden="true" />
        Open file
        <ChevronDownIcon aria-hidden="true" className="ml-auto" />
      </MenuTrigger>
      <MenuContent>
        {FILE_TYPE_OPTIONS.map((option) => (
          <MenuItem key={option.type} onClick={() => void handleSelectFileType(option.type)}>
            <span className="font-medium">{option.label}</span>
            <span className="text-muted-foreground">{option.description}</span>
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );
}

export function OsmPbfOpenUrlButton({
  disabled,
  openPbfUrl,
  setFile,
}: {
  disabled?: boolean;
  openPbfUrl?: (url: string) => Promise<unknown>;
  setFile: (file: File | null, fileType?: OsmFileType) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [selectedFileType, setSelectedFileType] = useState<OsmFileType>("pbf");
  const fileTypeId = useId();
  const urlId = useId();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button className="flex-1" variant="outline" disabled={disabled} />}>
        <LinkIcon aria-hidden="true" />
        Open from URL
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Open OSM from URL</DialogTitle>
          <DialogDescription>
            Provide a direct link to a <code>.pbf</code>, <code>.geojson</code>,<code>.json</code>,{" "}
            <code>.zip</code> (Shapefile or GTFS), or <code>.parquet</code> (GeoParquet) file. The
            server must allow browser downloads (CORS).
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label htmlFor={fileTypeId} className="font-medium">
              File type
            </label>
            <Select
              id={fileTypeId}
              items={FILE_TYPE_OPTIONS.map((option) => ({
                value: option.type,
                label: option.label,
              }))}
              value={selectedFileType}
              onValueChange={setSelectedFileType}
            />
            <div className="text-muted-foreground">
              {FILE_TYPE_OPTIONS.find((option) => option.type === selectedFileType)?.description}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor={urlId} className="font-medium">
              URL
            </label>
            <Input
              id={urlId}
              placeholder="https://example.com/data.osm.pbf"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              autoFocus
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <ActionButton
            disabled={disabled || url.trim().length === 0}
            icon={<LinkIcon aria-hidden="true" />}
            onAction={async () => {
              if (selectedFileType === "pbf" && openPbfUrl) {
                await openPbfUrl(url);
                setOpen(false);
                return;
              }
              const task = Log.startTask("Downloading file from URL…");
              try {
                const file = await fetchOsmFileFromUrl(url);
                task.end(`Downloaded ${file.name}`);
                await setFile(file, selectedFileType);
                setOpen(false);
              } catch (e) {
                const message = e instanceof Error ? e.message : "Unknown error";
                task.end(`Download failed: ${message}`, "error");
                throw e;
              }
            }}
          >
            Download and open
          </ActionButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function OsmPbfClearFileButton({
  disabled,
  clearFile,
}: {
  disabled?: boolean;
  clearFile: () => Promise<void>;
}) {
  return (
    <ActionButton
      disabled={disabled}
      onAction={clearFile}
      title="Clear file"
      icon={<XIcon aria-hidden="true" />}
      aria-label="Clear file"
      size="icon-sm"
      variant="ghost"
    />
  );
}

function showFileSelector(accept: string) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = accept;

  return new Promise<File | null>((resolve) => {
    const focusListener = () => {
      setTimeout(() => {
        resolve(null);
        removeListener();
      }, 300);
    };
    const removeListener = () => window.removeEventListener("focus", focusListener);
    input.onchange = () => {
      if (input.files !== null) {
        resolve(input.files[0]);
        removeListener();
      } else {
        resolve(null);
        removeListener();
      }
    };

    window.addEventListener("focus", focusListener);
    input.click();
  });
}
