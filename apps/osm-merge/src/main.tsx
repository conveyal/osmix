import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import App from "./app"
// import "./main.css"

const rootEl = document.getElementById("root")
if (!rootEl) throw new Error("Root element not found")

createRoot(rootEl).render(
	<StrictMode>
		<App />
	</StrictMode>,
)
