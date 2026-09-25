import { fetchOsmFileFromUrl, Tasks } from "@osmix/app-core";
import {
  ActionButton,
  Button,
  bytesSizeToHuman,
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
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
  NativeSelect,
  NativeSelectOption,
  useTaskLock,
} from "@osmix/ui";
import { ChevronDownIcon, FileIcon, FilesIcon, LinkIcon, XIcon } from "lucide-react";
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
    <div className="flex min-w-0 flex-1 flex-col gap-3">
      {!file ? (
        <OsmPbfSelectFileButton disabled={disabled} pbfOnly={pbfOnly} setFile={setFile} />
      ) : (
        <OsmPbfSelectedFile file={file} disabled={disabled} clearFile={() => setFile(null)} />
      )}
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

/** Narrow a `<select>` value to a known load profile; the options are the only source. */
function parseLoadProfile(value: string): OsmLoadProfile {
  const option = LOAD_PROFILE_OPTIONS.find((o) => o.value === value);
  if (!option) throw Error(`Unknown load profile: ${value}`);
  return option.value;
}

/** Narrow a `<select>` value to a known file type; the options are the only source. */
function parseFileType(value: string): OsmFileType {
  const option = FILE_TYPE_OPTIONS.find((o) => o.type === value);
  if (!option) throw Error(`Unknown file type: ${value}`);
  return option.type;
}

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
    <Field orientation="horizontal">
      <FieldContent>
        <FieldLabel htmlFor={id}>Load profile</FieldLabel>
        <FieldDescription id={descriptionId}>{selected.description}</FieldDescription>
      </FieldContent>
      <NativeSelect
        id={id}
        aria-describedby={descriptionId}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(parseLoadProfile(e.target.value))}
      >
        {LOAD_PROFILE_OPTIONS.map((option) => (
          <NativeSelectOption key={option.value} value={option.value}>
            {option.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </Field>
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
  const locked = useTaskLock();

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
        variant="outline"
        disabled={disabled || isLoading || locked}
        className="w-full"
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
      <MenuTrigger variant="outline" disabled={disabled || isLoading || locked} className="flex-1">
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
  const locked = useTaskLock();
  const [url, setUrl] = useState("");
  const [selectedFileType, setSelectedFileType] = useState<OsmFileType>("pbf");
  const fileTypeId = useId();
  const urlId = useId();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button className="flex-1" variant="outline" disabled={disabled || locked} />}
      >
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
            <NativeSelect
              id={fileTypeId}
              className="w-full"
              value={selectedFileType}
              onChange={(e) => setSelectedFileType(parseFileType(e.target.value))}
            >
              {FILE_TYPE_OPTIONS.map((option) => (
                <NativeSelectOption key={option.type} value={option.type}>
                  {option.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
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
              // The download is its own task; opening the file then starts the load task.
              const file = await Tasks.run(`Download ${url}`, () => fetchOsmFileFromUrl(url), {
                summary: (downloaded) => `Downloaded ${downloaded.name}`,
              });
              await setFile(file, selectedFileType);
              setOpen(false);
            }}
          >
            Download and open
          </ActionButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The chosen file, before it is loaded: name, size, and a clear action. */
export function OsmPbfSelectedFile({
  file,
  disabled,
  clearFile,
}: {
  file: File;
  disabled?: boolean;
  clearFile: () => Promise<void>;
}) {
  return (
    <Item variant="outline" size="sm" className="flex-nowrap">
      <ItemMedia variant="icon">
        <FileIcon aria-hidden="true" />
      </ItemMedia>
      <ItemContent className="min-w-0 gap-0">
        <ItemTitle className="w-full min-w-0">
          <span className="truncate font-mono" title={file.name}>
            {file.name}
          </span>
        </ItemTitle>
        <ItemDescription>{bytesSizeToHuman(file.size)}</ItemDescription>
      </ItemContent>
      <ItemActions>
        <OsmPbfClearFileButton disabled={disabled} clearFile={clearFile} />
      </ItemActions>
    </Item>
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
      label="Clear file"
      icon={<XIcon aria-hidden="true" />}
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
