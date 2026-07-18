import type { OsmLoadCapabilities, OsmLoadProfile } from "osmix";

export type OsmLoadFailureAction = "reload-view";

export interface OsmLoadFailureTechnicalDetails {
  name: string;
  message: string;
  code?: string;
  stage?: string;
  entityType?: string;
  component?: string;
  operation?: string;
  typedArray?: string;
  bufferType?: string;
  elementCount?: number;
  bytesPerElement?: number;
  requiredBytes?: number;
  availableBytes?: number;
  stack?: string;
}

export interface OsmLoadFailure {
  title: string;
  summary: string;
  suggestion: string;
  activityMessage: string;
  action?: OsmLoadFailureAction;
  technical: OsmLoadFailureTechnicalDetails;
}

export interface OsmLoadFailureContext {
  sourceName: string;
  requestedProfile?: OsmLoadProfile;
  capabilities?: OsmLoadCapabilities;
  allowViewRetry?: boolean;
}

type ErrorRecord = Record<string, unknown>;

function asRecord(value: unknown): ErrorRecord | null {
  return typeof value === "object" && value !== null ? (value as ErrorRecord) : null;
}

function stringField(record: ErrorRecord | null, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" ? value : undefined;
}

function numberField(record: ErrorRecord | null, key: string): number | undefined {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function formatBytes(bytes: number): string {
  if (bytes >= 2 ** 30) return `${(bytes / 2 ** 30).toFixed(2)} GiB`;
  if (bytes >= 2 ** 20) return `${(bytes / 2 ** 20).toFixed(1)} MiB`;
  if (bytes >= 2 ** 10) return `${(bytes / 2 ** 10).toFixed(1)} KiB`;
  return `${bytes.toLocaleString()} bytes`;
}

function displayEntityComponent(entityType?: string, component?: string): string {
  const entity = entityType ?? "entity";
  if (component === "ids") return `${entity} ID column`;
  if (component === "tags") return `${entity} tag index`;
  if (component === "entity-data") return `${entity} data columns`;
  return `${entity} index`;
}

function displayBufferType(bufferType?: string): string {
  return bufferType === "shared-array-buffer" ? "SharedArrayBuffer" : "ArrayBuffer";
}

function activeBufferLimit(
  bufferType: string | undefined,
  capabilities: OsmLoadCapabilities | undefined,
): number | undefined {
  if (bufferType === "shared-array-buffer") return capabilities?.sharedArrayBufferMaxBytes;
  if (bufferType === "array-buffer") return capabilities?.arrayBufferMaxBytes;
  return capabilities?.activeBufferType === "shared-array-buffer"
    ? capabilities.sharedArrayBufferMaxBytes
    : capabilities?.arrayBufferMaxBytes;
}

function technicalDetails(error: unknown): OsmLoadFailureTechnicalDetails {
  const record = asRecord(error);
  const message = error instanceof Error ? error.message : String(error);
  const name =
    error instanceof Error ? error.name : (stringField(record, "name") ?? "UnknownError");
  return {
    name,
    message,
    code: stringField(record, "code"),
    stage: stringField(record, "stage"),
    entityType: stringField(record, "entityType"),
    component: stringField(record, "component"),
    operation: stringField(record, "operation"),
    typedArray: stringField(record, "typedArray"),
    bufferType: stringField(record, "bufferType"),
    elementCount: numberField(record, "elementCount"),
    bytesPerElement: numberField(record, "bytesPerElement"),
    requiredBytes: numberField(record, "requiredBytes"),
    availableBytes: numberField(record, "availableBytes") ?? numberField(record, "limitBytes"),
    stack: error instanceof Error ? error.stack : stringField(record, "stack"),
  };
}

/** Convert worker and browser failures into stable, actionable Merge UI copy. */
export function describeOsmLoadFailure(
  error: unknown,
  context: OsmLoadFailureContext,
): OsmLoadFailure {
  const technical = technicalDetails(error);
  const record = asRecord(error);
  const title = `Could not load ${context.sourceName}`;

  if (technical.code === "OSM_ENTITY_INDEX_BUILD_FAILED" && technical.requiredBytes !== undefined) {
    const component = displayEntityComponent(technical.entityType, technical.component);
    const buffer = displayBufferType(technical.bufferType);
    const availableBytes = activeBufferLimit(technical.bufferType, context.capabilities);
    const required = formatBytes(technical.requiredBytes);
    const elementDescription =
      technical.elementCount === undefined || technical.typedArray === undefined
        ? ""
        : ` (${technical.elementCount.toLocaleString()} ${technical.typedArray} elements)`;
    const capacityComparison =
      availableBytes === undefined
        ? `The browser could not allocate the required single ${buffer}.`
        : technical.requiredBytes > availableBytes
          ? `The tested browser limit is ${formatBytes(availableBytes)}, ${formatBytes(technical.requiredBytes - availableBytes)} less than required.`
          : `The allocation failed even though the tested browser limit is ${formatBytes(availableBytes)}; other resident memory may have reduced what was available.`;
    const summary = `The ${component} needs one ${required} ${buffer}${elementDescription}. ${capacityComparison}`;
    return {
      title,
      summary,
      suggestion:
        "Use a smaller regional extract. Auto, View, and Full all retain this core data, so changing the load profile will not avoid this limit.",
      activityMessage: `${context.sourceName} failed: ${component} requires one ${required} ${buffer}.`,
      technical: { ...technical, availableBytes },
    };
  }

  if (
    technical.code === "TYPED_BUFFER_ALLOCATION_FAILED" &&
    technical.requiredBytes !== undefined
  ) {
    const buffer = displayBufferType(technical.bufferType);
    const availableBytes = activeBufferLimit(technical.bufferType, context.capabilities);
    return {
      title,
      summary: `${technical.typedArray ?? "A typed array"} needs one ${formatBytes(technical.requiredBytes)} ${buffer}, but that allocation failed.`,
      suggestion:
        "Use a smaller input or reduce the operation size. Changing the load profile may not affect this required core allocation.",
      activityMessage: `${context.sourceName} failed: a ${formatBytes(technical.requiredBytes)} ${buffer} allocation failed.`,
      technical: { ...technical, availableBytes },
    };
  }

  if (technical.code === "OSM_LOAD_CAPACITY_EXCEEDED") {
    const required = technical.requiredBytes;
    const available = technical.availableBytes;
    const action =
      context.allowViewRetry !== false && stringField(record, "suggestedProfile") === "view"
        ? "reload-view"
        : undefined;
    return {
      title,
      summary:
        required !== undefined && available !== undefined
          ? `The selected spatial indexes need one ${formatBytes(required)} allocation, above the ${formatBytes(available)} safety limit.`
          : technical.message,
      suggestion:
        action === "reload-view"
          ? "Reload using View to omit the optional all-node spatial index."
          : "Choose a smaller input or a load profile with fewer indexes.",
      activityMessage: `${context.sourceName} failed: the selected spatial indexes exceed the browser allocation limit.`,
      action,
      technical,
    };
  }

  if (technical.code === "OSM_SPATIAL_INDEX_BUILD_FAILED") {
    return {
      title,
      summary: technical.message,
      suggestion:
        "Try the load again. If the all-node index was selected, View mode may avoid that optional index.",
      activityMessage: `${context.sourceName} failed while building a spatial index.`,
      technical,
    };
  }

  return {
    title,
    summary: technical.message || "The dataset load failed without an error message.",
    suggestion: "Try again. Open Technical details below when reporting a persistent failure.",
    activityMessage: `${context.sourceName} failed: ${technical.message || technical.name}.`,
    technical,
  };
}
