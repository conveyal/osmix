import * as React from "react"
import { Log } from "@/state/log"

export class ErrorBoundary extends React.Component<
	{
		fallback: React.ReactNode
		children: React.ReactNode
	},
	{
		hasError: boolean
	}
> {
	constructor(props: { fallback: React.ReactNode; children: React.ReactNode }) {
		super(props)
		this.state = { hasError: false }
	}

	static getDerivedStateFromError(_: Error) {
		// Update state so the next render will show the fallback UI.
		return { hasError: true }
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
		if (this.state.hasError) {
			// You can render any custom fallback UI
			return this.props.fallback
		}

		return this.props.children
	}
}
