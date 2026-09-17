import { createOsmixAppRuntime, OsmixAppShell } from "@osmix/app-components";
import type { OsmixAppRemote } from "@osmix/app-core";
import { createRoot } from "react-dom/client";

import { ExtractApp } from "./app";
import { ExtractNav } from "./nav";

declare global {
  interface Window {
    osmWorker: OsmixAppRemote;
  }
}

async function bootstrap() {
  const rootEl = document.getElementById("root");
  if (!rootEl) throw new Error("Root element not found");

  const { store, remote } = await createOsmixAppRuntime();
  window.osmWorker = remote;

  createRoot(rootEl).render(
    <OsmixAppShell store={store} nav={<ExtractNav />}>
      <ExtractApp />
    </OsmixAppShell>,
  );
}

void bootstrap();
