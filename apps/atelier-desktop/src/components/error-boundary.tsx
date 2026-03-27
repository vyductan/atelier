import type { ReactNode } from "react";
import { Component } from "react";
import { AlertTriangle } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="bg-background flex h-screen items-center justify-center p-8">
          <div className="max-w-md text-center">
            <AlertTriangle className="text-destructive mx-auto mb-4 h-12 w-12" />
            <h1 className="mb-2 text-2xl font-bold">Something went wrong</h1>
            <p className="text-muted-foreground mb-4">
              {this.state.error?.message || "An unexpected error occurred"}
            </p>
            <button
              onClick={() => globalThis.location.reload()}
              className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-4 py-2 text-sm font-medium"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
