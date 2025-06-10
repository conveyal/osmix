import MergePage from "@/routes/merge"
// import { Provider } from "jotai"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

const rootEl = document.getElementById("root")
if (!rootEl) throw new Error("Root element not found")

createRoot(rootEl).render(
	<StrictMode>
		<MergePage />
	</StrictMode>,
)
