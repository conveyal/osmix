import * as React from "react"
import { Log } from "../state/log"

export class ErrorBoundary extends React.Component<
	{
		fallback: React.ReactNode
		children: React.ReactNode
	},
	{
		error: Error | null
		info: React.ErrorInfo | null
	}
> {
	constructor(props: { fallback: React.ReactNode; children: React.ReactNode }) {
		super(props)
		this.state = { error: null, info: null }
	}

	static getDerivedStateFromError(error: Error, info: React.ErrorInfo) {
		// Update state so the next render will show the fallback UI.
		return { error, info }
	}

	componentDidCatch(error: Error, info: React.ErrorInfo) {
		Log.addMessage(error.message, "error")
		console.error(
			error,
			// Example "componentStack":
			//   in ComponentThatThrows (created by App)
			//   in ErrorBoundary (created by App)
			//   in div (created by App)
			//   in App
			info.componentStack,
			// Warning: `captureOwnerStack` is not available in production.
			React.captureOwnerStack(),
		)
	}

	render() {
		if (this.state.error) {
			// You can render any custom fallback UI
			return (
				<pre className="p-8 border-2 mx-auto mt-8 w-md rounded shadow text-red-600">
					Error: {this.state.error.message}
				</pre>
			)
		}

		return this.props.children
	}
}
