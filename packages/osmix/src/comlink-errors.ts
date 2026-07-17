import { transferHandlers, type TransferHandler } from "comlink";

const STRUCTURED_THROW_HANDLER = Symbol.for("osmix.comlink.structured-throw-handler");
const RESERVED_ERROR_FIELDS = new Set(["message", "name", "stack"]);

interface StructuredSerializedError {
  osmixErrorVersion: 1;
  message: string;
  name: string;
  stack?: string;
  fields: Record<string, unknown>;
}

type InstalledTransferHandler = TransferHandler<unknown, unknown> & {
  [STRUCTURED_THROW_HANDLER]?: true;
};

function isObject(value: unknown): value is Record<PropertyKey, unknown> {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

function isStructuredSerializedError(value: unknown): value is StructuredSerializedError {
  return isObject(value) && value["osmixErrorVersion"] === 1;
}

function getThrownValue(value: unknown): unknown {
  return isObject(value) ? value["value"] : undefined;
}

function serializeError(error: Error): StructuredSerializedError {
  const fields = Object.fromEntries(
    Object.entries(error).filter(([key]) => !RESERVED_ERROR_FIELDS.has(key)),
  );
  return {
    osmixErrorVersion: 1,
    message: error.message,
    name: error.name,
    stack: error.stack,
    fields,
  };
}

function deserializeError(serialized: StructuredSerializedError): Error {
  const error = new Error(serialized.message);
  error.name = serialized.name;
  if (serialized.stack !== undefined) error.stack = serialized.stack;
  for (const [key, value] of Object.entries(serialized.fields)) {
    Object.defineProperty(error, key, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
  }
  return error;
}

/**
 * Preserve structured fields on errors crossing a Comlink boundary.
 *
 * Comlink's built-in throw handler only serializes `name`, `message`, and
 * `stack`. This idempotent wrapper retains the existing handler's private
 * thrown-value detection and delegates non-Error values unchanged.
 */
export function installStructuredComlinkErrorTransferHandler(): void {
  const existing = transferHandlers.get("throw") as InstalledTransferHandler | undefined;
  if (!existing) throw new Error("Comlink's throw transfer handler is unavailable");
  if (existing[STRUCTURED_THROW_HANDLER]) return;

  const handler: InstalledTransferHandler = {
    [STRUCTURED_THROW_HANDLER]: true,
    canHandle: (value): value is unknown => existing.canHandle(value),
    serialize(value) {
      const thrownValue = getThrownValue(value);
      if (!(thrownValue instanceof Error)) return existing.serialize(value);
      return [serializeError(thrownValue), []];
    },
    deserialize(value): never {
      if (!isStructuredSerializedError(value)) return existing.deserialize(value) as never;
      throw deserializeError(value);
    },
  };

  transferHandlers.set("throw", handler);
}
