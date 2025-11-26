import { StrictMode, Suspense } from "react"
import { createRoot } from "react-dom/client"
import { MapProvider } from "react-map-gl/maplibre"
import { ErrorBoundary } from "./components/error-boundary"
import Nav from "./components/nav"
import InspectPage from "./pages/inspect"

function RootLayout() {
	return (
		<MapProvider>
			<div className="h-screen w-screen flex flex-col">
				<Nav />
				<Suspense fallback={<div>Loading...</div>}>
					<InspectPage />
				</Suspense>
			</div>
		</MapProvider>
	)
}

const rootEl = document.getElementById("root")
if (!rootEl) throw new Error("Root element not found")

createRoot(rootEl).render(
	<StrictMode>
		<ErrorBoundary fallback={<div>Error</div>}>
			<RootLayout />
		</ErrorBoundary>
	</StrictMode>,
)
