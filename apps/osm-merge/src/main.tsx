import { StrictMode, Suspense } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter, Route, Routes, Outlet } from "react-router"
import Nav from "./components/nav"
import ViewPage from "./components/view-page"
import MergePage from "./components/merge-page"

function RootLayout() {
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
					<Route path="" element={<ViewPage />} />
					<Route path="merge" element={<MergePage />} />
					<Route path="view" element={<ViewPage />} />
				</Route>
			</Routes>
		</BrowserRouter>
	</StrictMode>,
)
