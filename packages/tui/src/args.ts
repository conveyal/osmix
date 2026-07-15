export const USAGE = `Usage: osmix <file.osm.pbf>

Open an OSM PBF file in an interactive terminal map viewer.

Controls:
  arrows / h j k l  Pan
  + / -              Zoom in or out
  mouse drag         Pan
  mouse wheel        Zoom in or out
  0                  Fit the dataset
  q / escape         Quit`;

export class CliUsageError extends Error {
  constructor(message: string) {
    super(`${message}\n\n${USAGE}`);
    this.name = "CliUsageError";
  }
}

export type CliArgs = { kind: "help" } | { kind: "view"; filePath: string };

/** Parse the single positional PBF path accepted by the CLI. */
export function parseCliArgs(args: string[]): CliArgs {
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    return { kind: "help" };
  }
  if (args.length === 0) throw new CliUsageError("Missing OSM PBF file path.");
  if (args.length > 1) throw new CliUsageError("Expected exactly one OSM PBF file path.");
  const filePath = args[0]!;
  if (filePath.startsWith("-")) throw new CliUsageError(`Unknown option: ${filePath}`);
  return { kind: "view", filePath };
}
