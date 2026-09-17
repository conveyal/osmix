import { ErrorBoundary } from "@osmix/ui";
import { StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { MapProvider } from "react-map-gl/maplibre";
import { BrowserRouter, Outlet, Route, Routes } from "react-router";

import MergeNav from "./components/nav";
import "./lib/maplibre-worker";
import MergePage from "./pages/merge";
import { Log } from "./state/log";

function RootLayout() {
  return (
    <MapProvider>
      <div className="h-screen w-screen flex flex-col">
        <MergeNav />
        <Suspense fallback={<div>Loading...</div>}>
          <Outlet />
        </Suspense>
      </div>
    </MapProvider>
  );
}

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element not found");

createRoot(rootEl).render(
  <StrictMode>
    <ErrorBoundary
      fallback={<div>Error</div>}
      onError={(error) => Log.addMessage(error.message, "error")}
    >
      <BrowserRouter>
        <Routes>
          <Route path={"/"} element={<RootLayout />}>
            <Route path="" element={<MergePage />} />
            <Route path="extract" element={<MergePage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
);
