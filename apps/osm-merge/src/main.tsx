import MergePage from "@/routes/merge"
import ViewPage from "@/routes/view"
import { useAtomValue } from "jotai"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { workflowStepAtom } from "./atoms"
import Nav from "./components/nav"

const rootEl = document.getElementById("root")
if (!rootEl) throw new Error("Root element not found")

function Routes() {
	const workflowStep = useAtomValue(workflowStepAtom)
	if (workflowStep === "view") {
		return <ViewPage />
	}

	return <MergePage />
}

createRoot(rootEl).render(
	<StrictMode>
		<div className="h-screen w-screen flex flex-col">
			<Nav />
			<Routes />
		</div>
	</StrictMode>,
)
