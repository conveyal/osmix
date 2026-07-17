/** Cross-runtime worker creation and Comlink endpoint helpers. */

import * as Comlink from "comlink";
import type { Endpoint } from "comlink";

import { getWorkerRuntime, type WorkerRuntime } from "./capabilities.ts";
import { OsmixWorker } from "./worker.ts";

const NODE_WORKER_THREADS_SPECIFIER = "node:worker_threads";

async function importNodeWorkerThreads(): Promise<typeof import("node:worker_threads")> {
  // Keep the Node builtin out of browser bundles. This branch is reached only
  // after runtime detection selects Node.
  return import(/* @vite-ignore */ NODE_WORKER_THREADS_SPECIFIER);
}

interface NodeEndpointTarget {
  postMessage(message: unknown, transfer?: readonly Transferable[]): void;
  on(type: "message", listener: (data: unknown) => void): unknown;
  off(type: "message", listener: (data: unknown) => void): unknown;
  start?(): void;
}

interface ManagedWebEndpoint extends Endpoint {
  clear(): void;
}

/** Track Comlink's anonymous message listener so server runtimes can release their event loop. */
function webEndpoint(target: Worker): ManagedWebEndpoint {
  const listeners = new Map<
    EventListenerOrEventListenerObject,
    EventListenerOrEventListenerObject
  >();
  return {
    postMessage: (message, transfer) =>
      target.postMessage(message, transfer ? { transfer } : undefined),
    addEventListener: (type, listener) => {
      target.addEventListener(type, listener);
      listeners.set(listener, listener);
    },
    removeEventListener: (type, listener) => {
      const registered = listeners.get(listener);
      if (!registered) return;
      target.removeEventListener(type, registered);
      listeners.delete(listener);
    },
    clear() {
      for (const listener of listeners.values()) target.removeEventListener("message", listener);
      listeners.clear();
    },
  };
}

/** Comlink's Node adapter, kept local so browser consumers do not resolve a Node-only subpath. */
function nodeEndpoint(target: NodeEndpointTarget): Endpoint {
  const listeners = new WeakMap<EventListenerOrEventListenerObject, (data: unknown) => void>();
  return {
    postMessage: (message, transfer) => target.postMessage(message, transfer),
    addEventListener: (_type, listener) => {
      const wrapped = (data: unknown) => {
        const event = { data } as MessageEvent;
        if ("handleEvent" in listener) listener.handleEvent(event);
        else listener(event);
      };
      target.on("message", wrapped);
      listeners.set(listener, wrapped);
    },
    removeEventListener: (_type, listener) => {
      const wrapped = listeners.get(listener);
      if (!wrapped) return;
      target.off("message", wrapped);
      listeners.delete(listener);
    },
    start: target.start ? () => target.start?.() : undefined,
  };
}

export type WorkerConnectionRuntime = Exclude<WorkerRuntime, "none"> | "in-process";
type WebWorkerRuntime = Exclude<WorkerRuntime, "node" | "none">;

/** A remote proxy paired with the underlying worker lifecycle. */
export interface OsmixWorkerConnection<T extends object> {
  readonly remote: Comlink.Remote<T>;
  readonly runtime: WorkerConnectionRuntime;
  onFailure(listener: (error: Error) => void): () => void;
  terminate(): Promise<void>;
}

/** Options for creating one browser, Bun, Deno, Node, or in-process worker connection. */
export interface CreateOsmixWorkerConnectionOptions<T extends object> {
  workerUrl?: URL;
  runtime?: WorkerRuntime | "auto";
  inProcessWorker?: T;
}

/** Resolve the default worker entry beside the current source or built module. */
export function defaultOsmixWorkerUrl(moduleUrl: string | URL = import.meta.url): URL {
  const base = new URL(moduleUrl);
  const ext = base.pathname.endsWith(".ts") ? "ts" : "js";
  return new URL(`./osmix.worker.${ext}`, base);
}

function errorFrom(value: unknown, fallback: string): Error {
  if (value instanceof Error) return value;
  if (
    typeof value === "object" &&
    value &&
    "message" in value &&
    typeof value.message === "string" &&
    value.message.length > 0
  ) {
    return new Error(value.message);
  }
  return new Error(fallback);
}

function createInProcessConnection<T extends object>(worker: T): OsmixWorkerConnection<T> {
  // In-process mode is explicitly blocking, so an RPC bridge only adds lifecycle
  // races without providing isolation. Awaiting direct method results remains
  // compatible with the Comlink.Remote surface used by callers.
  const remote = worker as unknown as Comlink.Remote<T>;
  let terminated = false;
  return {
    remote,
    runtime: "in-process",
    onFailure: () => () => undefined,
    async terminate() {
      if (terminated) return;
      terminated = true;
    },
  };
}

async function createWebConnection<T extends object>(
  workerUrl: URL,
  runtime: WebWorkerRuntime,
): Promise<OsmixWorkerConnection<T>> {
  if (typeof Worker === "undefined") {
    throw new Error(`The ${runtime} Web Worker API is not available in this context`);
  }
  const worker = new Worker(workerUrl, { type: "module" });
  const endpoint = webEndpoint(worker);
  const remote = Comlink.wrap<T>(endpoint);
  const listeners = new Set<(error: Error) => void>();
  let terminated = false;
  let terminalFailure: Error | undefined;
  const notify = (error: Error) => {
    if (terminated || terminalFailure) return;
    terminalFailure = error;
    for (const listener of listeners) listener(error);
  };
  const onError = (event: ErrorEvent) => {
    const error = errorFrom(event.error ?? event, `Worker failed to start: ${workerUrl.href}`);
    notify(error);
  };
  const onMessageError = (event: MessageEvent) => {
    const error = errorFrom(event.data, "Worker message could not be deserialized");
    notify(error);
  };
  const onClose: EventListener = (event) => {
    const code = Reflect.get(event, "code");
    notify(new Error(`Bun Worker exited unexpectedly with code ${String(code ?? "unknown")}`));
  };
  worker.addEventListener("error", onError);
  worker.addEventListener("messageerror", onMessageError);
  if (runtime === "bun") worker.addEventListener("close", onClose);
  return {
    remote,
    runtime,
    onFailure(listener) {
      listeners.add(listener);
      if (terminalFailure) queueMicrotask(() => listener(terminalFailure!));
      return () => listeners.delete(listener);
    },
    async terminate() {
      if (terminated) return;
      terminated = true;
      worker.removeEventListener("error", onError);
      worker.removeEventListener("messageerror", onMessageError);
      if (runtime === "bun") worker.removeEventListener("close", onClose);
      listeners.clear();
      try {
        remote[Comlink.releaseProxy]();
      } catch {
        // A failed endpoint may already have released its proxy.
      } finally {
        endpoint.clear();
        worker.terminate();
      }
    },
  };
}

async function createNodeConnection<T extends object>(
  workerUrl: URL,
): Promise<OsmixWorkerConnection<T>> {
  const { Worker: NodeWorker } = await importNodeWorkerThreads();
  const worker = new NodeWorker(workerUrl);
  const remote = Comlink.wrap<T>(nodeEndpoint(worker as unknown as NodeEndpointTarget));
  const listeners = new Set<(error: Error) => void>();
  let terminated = false;
  let terminalFailure: Error | undefined;
  const notify = (error: Error) => {
    if (terminated || terminalFailure) return;
    terminalFailure = error;
    for (const listener of listeners) listener(error);
  };
  const onError = (error: Error) => notify(error);
  const onMessageError = (error: Error) =>
    notify(errorFrom(error, "Worker message could not be deserialized"));
  const onExit = (code: number) => {
    if (!terminated) notify(new Error(`Worker exited unexpectedly with code ${code}`));
  };
  worker.on("error", onError);
  worker.on("messageerror", onMessageError);
  worker.on("exit", onExit);
  return {
    remote,
    runtime: "node",
    onFailure(listener) {
      listeners.add(listener);
      if (terminalFailure) queueMicrotask(() => listener(terminalFailure!));
      return () => listeners.delete(listener);
    },
    async terminate() {
      if (terminated) return;
      terminated = true;
      worker.off("error", onError);
      worker.off("messageerror", onMessageError);
      worker.off("exit", onExit);
      listeners.clear();
      try {
        remote[Comlink.releaseProxy]();
      } catch {
        // A failed endpoint may already have released its proxy.
      } finally {
        await worker.terminate();
      }
    },
  };
}

/** Create a Comlink worker connection in browsers, Bun, Deno, Node, or in-process. */
export async function createOsmixWorkerConnection<T extends object = OsmixWorker>({
  workerUrl = defaultOsmixWorkerUrl(),
  runtime = "auto",
  inProcessWorker,
}: CreateOsmixWorkerConnectionOptions<T> = {}): Promise<OsmixWorkerConnection<T>> {
  if (inProcessWorker) return createInProcessConnection(inProcessWorker);
  const selected = runtime === "auto" ? getWorkerRuntime() : runtime;
  if (selected === "web" || selected === "bun" || selected === "deno") {
    return createWebConnection<T>(workerUrl, selected);
  }
  if (selected === "node") return createNodeConnection<T>(workerUrl);
  throw new Error(
    "Worker threads are not available in this runtime. Pass an inProcessWorker to run locally.",
  );
}

/** Expose an Osmix worker through a browser/Bun/Deno global or Node parent-port endpoint. */
export async function exposeOsmixWorker<T extends object>(worker: T): Promise<void> {
  const runtime = getWorkerRuntime();
  if (runtime === "node") {
    const { parentPort } = await importNodeWorkerThreads();
    if (!parentPort) throw new Error("exposeOsmixWorker must run inside a Node worker thread");
    Comlink.expose(worker, nodeEndpoint(parentPort as unknown as NodeEndpointTarget));
    return;
  }
  if (runtime === "none") {
    throw new Error("exposeOsmixWorker must run inside a supported worker context");
  }
  Comlink.expose(worker);
}
