import { AlertTriangle, ExternalLink } from "lucide-react";

export function NotTauriError() {
  return (
    <div className="bg-background flex h-screen items-center justify-center p-8">
      <div className="max-w-md text-center">
        <AlertTriangle className="mx-auto mb-4 h-16 w-16 text-amber-500" />
        <h1 className="mb-2 text-2xl font-bold">Not Running in Tauri</h1>
        <p className="text-muted-foreground mb-6">
          This app must be run through Tauri, not directly in the browser.
        </p>

        <div className="bg-muted mb-6 rounded-lg p-4 text-left">
          <p className="mb-2 text-sm font-medium">To run the app:</p>
          <code className="bg-background block rounded p-2 font-mono text-sm">
            cd apps/atelier-desktop
            <br />
            pnpm atelier:dev
          </code>
        </div>

        <p className="text-muted-foreground text-sm">
          Don't use{" "}
          <code className="bg-muted rounded px-1 py-0.5">pnpm dev</code> - that
          only starts the Vite server.
        </p>

        <a
          href="http://localhost:1420"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary mt-4 inline-flex items-center gap-2 text-sm hover:underline"
        >
          Open in Tauri (if running)
          <ExternalLink className="h-4 w-4" />
        </a>
      </div>
    </div>
  );
}
