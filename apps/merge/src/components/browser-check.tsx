import { useEffect, useMemo, useState } from "react";

import {
  type BrowserLoadCapabilities,
  getBrowserLoadCapabilities,
} from "../lib/browser-capabilities";
import { bytesSizeToHuman } from "../utils";
import { StatusDot } from "./status-dot";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { Spinner } from "./ui/spinner";

type SystemIssue = {
  id: "secure-context" | "cross-origin-isolated" | "device-memory";
  title: string;
  detail: string;
};

function useSystemIssues() {
  const [secure, setSecure] = useState(false);
  const [crossOriginIsolated, setCrossOriginIsolated] = useState(false);
  const [deviceMemory, setDeviceMemory] = useState<number | null>(null);

  useEffect(() => {
    setSecure(window.isSecureContext);
    setCrossOriginIsolated(window.crossOriginIsolated);
    setDeviceMemory(
      "deviceMemory" in navigator
        ? Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 0)
        : null,
    );
  }, []);

  const issues = useMemo<SystemIssue[]>(() => {
    const next: SystemIssue[] = [];
    if (!secure) {
      next.push({
        id: "secure-context",
        title: "No secure context",
        detail:
          "The app is not running in a secure context (HTTPS/localhost), which can block required browser APIs such as reliable file handling and storage behavior.",
      });
    }
    if (!crossOriginIsolated) {
      next.push({
        id: "cross-origin-isolated",
        title: "Not cross origin isolated",
        detail:
          "Cross-origin isolation is disabled, which prevents high-performance features (for example SharedArrayBuffer) used by heavy worker-based processing.",
      });
    }
    if (deviceMemory != null && deviceMemory < 1) {
      next.push({
        id: "device-memory",
        title: "Less than 1 GiB device memory available",
        detail:
          "Low reported device memory can cause slowdowns or failures when loading and merging larger OSM datasets.",
      });
    }
    return next;
  }, [secure, crossOriginIsolated, deviceMemory]);

  return {
    secure,
    crossOriginIsolated,
    deviceMemory,
    issues,
  };
}

export default function BrowserCheck() {
  const { issues } = useSystemIssues();
  const hoverText =
    issues.length === 0
      ? "No system issues detected"
      : issues.map((i) => `• ${i.title}: ${i.detail}`).join("\n");

  return (
    <Dialog>
      <DialogTrigger render={<Button size="sm" variant="link" />}>
        <span className="inline-flex items-center gap-2">
          Check system
          {issues.length > 0 ? (
            <StatusDot className="inline-block" status="error" title={hoverText} />
          ) : null}
        </span>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>System</DialogTitle>
          <DialogDescription>
            {issues.length > 0
              ? `Detected ${issues.length} potential issue${issues.length === 1 ? "" : "s"}.`
              : "No issues detected."}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          {issues.length > 0 ? (
            <div className="rounded-md border border-destructive/20 bg-destructive/10 p-2 text-destructive">
              <div className="font-bold">Potential issues</div>
              <ul className="mt-1 list-disc pl-5">
                {issues.map((issue) => (
                  <li key={issue.id}>
                    <span className="font-medium">{issue.title}:</span> {issue.detail}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <SecureContext />
          <DeviceMemory />
          <StorageEstimate />
          <MaxArraySizes />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SecureContext() {
  const [secure, setSecure] = useState(false);
  const [crossOriginIsolated, setCrossOriginIsolated] = useState(false);
  const [hardwareConcurrency, setHardwareConcurrency] = useState(0);

  useEffect(() => {
    setSecure(window.isSecureContext);
    setCrossOriginIsolated(window.crossOriginIsolated);
    setHardwareConcurrency(navigator.hardwareConcurrency);
  }, []);

  return (
    <div>
      <div className="font-bold">Secure context</div>
      <div>{secure ? "yes" : "no"}</div>
      <div className="font-bold">Cross origin isolated</div>
      <div>{crossOriginIsolated ? "yes" : "no"}</div>
      <div className="font-bold">Hardware concurrency</div>
      <div>{hardwareConcurrency}</div>
    </div>
  );
}

function DeviceMemory() {
  const [memory, setMemory] = useState("unknown");

  useEffect(() => {
    setMemory("deviceMemory" in navigator ? `${String(navigator.deviceMemory)}GiB` : "unknown");
  }, []);

  return (
    <div>
      <div className="font-bold">Reported device memory class</div>
      <div>{memory}</div>
    </div>
  );
}

function StorageEstimate() {
  const [storage, setStorage] = useState({
    quota: 0,
    usage: 0,
  });

  useEffect(() => {
    void navigator.storage.estimate().then((estimate) => {
      setStorage({
        quota: estimate.quota ?? 0,
        usage: estimate.usage ?? 0,
      });
    });
  }, []);

  return (
    <div>
      <div className="font-bold">Storage</div>
      <div>Usage: {(storage.usage / 1024 / 1024).toFixed(2)} MB</div>
      <div>Quota: {(storage.quota / 1024 / 1024).toFixed(2)} MB</div>
      <div>
        Percentage:{" "}
        {storage.quota === 0 ? "unknown" : `${((storage.usage / storage.quota) * 100).toFixed(2)}%`}
      </div>
    </div>
  );
}

const TypedArrays = [
  Float64Array,
  Float32Array,
  Uint32Array,
  Int32Array,
  Uint16Array,
  Int16Array,
  Uint8Array,
  Int8Array,
];
function MaxArraySizes() {
  const [capabilities, setCapabilities] = useState<BrowserLoadCapabilities | null>(null);
  const [probeError, setProbeError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    void getBrowserLoadCapabilities().then(
      (result) => {
        if (!disposed) setCapabilities(result);
      },
      (error: unknown) => {
        if (!disposed) setProbeError(error instanceof Error ? error.message : String(error));
      },
    );
    return () => {
      disposed = true;
    };
  }, []);

  const activeCeiling =
    capabilities?.activeBufferType === "shared-array-buffer"
      ? capabilities.sharedArrayBufferMaxBytes
      : capabilities?.arrayBufferMaxBytes;

  return (
    <div>
      <div className="font-bold">Tested buffer ceilings</div>
      {capabilities ? (
        <>
          <div>ArrayBuffer: {bytesSizeToHuman(capabilities.arrayBufferMaxBytes)}</div>
          <div>
            SharedArrayBuffer:{" "}
            {capabilities.sharedArrayBufferMaxBytes === undefined
              ? "unavailable"
              : bytesSizeToHuman(capabilities.sharedArrayBufferMaxBytes)}
          </div>
          <div>
            Active storage:{" "}
            {capabilities.activeBufferType === "shared-array-buffer"
              ? "SharedArrayBuffer"
              : "ArrayBuffer"}
          </div>
          <div className="font-bold">Derived active-buffer element counts</div>
          {TypedArrays.map((arrayType) => (
            <div key={arrayType.name}>
              {arrayType.name}:{" "}
              {Math.floor((activeCeiling ?? 0) / arrayType.BYTES_PER_ELEMENT).toLocaleString()}
            </div>
          ))}
        </>
      ) : probeError ? (
        <div className="text-destructive">Probe failed: {probeError}</div>
      ) : (
        <Spinner />
      )}
    </div>
  );
}
