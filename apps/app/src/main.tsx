import { createOsmixAppRuntime, OsmixAppShell } from "@osmix/app-components";
import { type OsmixAppRemote, osmDatasetVersionAtomFamily } from "@osmix/app-core";
import { createRoot } from "react-dom/client";

import { App } from "./app";
import { BASE_OSM_KEY, PATCH_OSM_KEY } from "./settings";
import { updateMergeOutcomeAtom } from "./state/merge-outcome";
import { resetMergePlanAtom } from "./state/merge-plan";

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

  // Replacing or clearing either merge input, here or from another page, invalidates the plan
  // and the merge outcome, and returns Merge to its first step.
  for (const osmKey of [BASE_OSM_KEY, PATCH_OSM_KEY]) {
    store.sub(osmDatasetVersionAtomFamily(osmKey), () => {
      store.set(updateMergeOutcomeAtom, { type: "reset" });
      store.set(resetMergePlanAtom);
    });
  }

  createRoot(rootEl).render(
    <OsmixAppShell store={store}>
      <App />
    </OsmixAppShell>,
  );
}

void bootstrap();
