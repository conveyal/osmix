import { StrictMode, Suspense } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter, Outlet, Route, Routes } from "react-router"
import Nav from "./components/nav"
import { useSubscribeOsmWorkerToLog } from "./hooks/log"
import InspectPage from "./pages/inspect"
import MergePage from "./pages/merge"

function RootLayout() {
	useSubscribeOsmWorkerToLog()
	return (
		<div className="h-screen w-screen flex flex-col">
			<Nav />
			<Suspense fallback={<div>Loading...</div>}>
				<Outlet />
			</Suspense>
		</div>
	)
}

const rootEl = document.getElementById("root")
if (!rootEl) throw new Error("Root element not found")

createRoot(rootEl).render(
	<StrictMode>
		<BrowserRouter>
			<Routes>
				<Route
					path={process.env.NODE_ENV === "production" ? "/osm.ts" : "/"}
					element={<RootLayout />}
				>
					<Route path="" element={<InspectPage />} />
					<Route path="merge" element={<MergePage />} />
					<Route path="inspect" element={<InspectPage />} />
				</Route>
			</Routes>
		</BrowserRouter>
	</StrictMode>,
)
