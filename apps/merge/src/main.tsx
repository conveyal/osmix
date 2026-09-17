import { createOsmixAppRuntime, OsmixAppShell } from "@osmix/app-components";
import { type OsmixAppRemote, osmDatasetVersionAtomFamily } from "@osmix/app-core";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";

import MergeNav from "./components/nav";
import MergePage from "./pages/merge";
import { BASE_OSM_KEY, PATCH_OSM_KEY } from "./settings";
import { updateMergeOutcomeAtom } from "./state/merge-outcome";

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

  // Replacing or clearing either merge input invalidates the merge outcome.
  for (const osmKey of [BASE_OSM_KEY, PATCH_OSM_KEY]) {
    store.sub(osmDatasetVersionAtomFamily(osmKey), () => {
      store.set(updateMergeOutcomeAtom, { type: "reset" });
    });
  }

  createRoot(rootEl).render(
    <OsmixAppShell store={store} nav={<MergeNav />}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<MergePage />} />
          <Route path="/extract" element={<MergePage />} />
        </Routes>
      </BrowserRouter>
    </OsmixAppShell>,
  );
}

void bootstrap();
