import * as React from "react";

type ErrorBoundaryProps = {
  fallback: React.ReactNode;
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
    if (this.state.error) {
      // You can render any custom fallback UI
      return (
        <pre className="p-8 border-2 mx-auto mt-8 w-md rounded shadow text-destructive">
          Error: {this.state.error.message}
        </pre>
      );
    }

    return this.props.children;
  }
}
