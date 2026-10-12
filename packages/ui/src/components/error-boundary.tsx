import * as React from "react";

import { Alert } from "./ui/alert.tsx";

type ErrorBoundaryProps = {
  /** Rendered instead of the children after an error. Defaults to a destructive `Alert`. */
  fallback?: (error: Error) => React.ReactNode;
  children: React.ReactNode;
  /** Called with the caught error before it is logged to the console. */
  onError?: (error: Error, info: React.ErrorInfo) => void;
};

export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  {
    error: Error | null;
    info: React.ErrorInfo | null;
  }
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error: Error, info: React.ErrorInfo) {
    // Update state so the next render will show the fallback UI.
    return { error, info };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo) {
    this.props.onError?.(error, info);
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
    );
  }

  override render() {
    const { error } = this.state;
    if (error) {
      if (this.props.fallback) return this.props.fallback(error);
      return (
        <div className="mx-auto mt-8 w-md max-w-full p-2">
          <Alert variant="destructive" title="Osmix stopped because of an unexpected error">
            <p>Reload the page to continue. Details: {error.message}</p>
          </Alert>
        </div>
      );
    }

    return this.props.children;
  }
}
