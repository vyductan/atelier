import { Button } from "@acme/ui/components/button";

import type {
  WorkspaceDiff,
  WorkspaceFileContent,
  WorkspaceStatus,
} from "../lib/workspace";
import type { SessionInspectionMode } from "./session-diff-state";
import {
  buildSessionDiffEmptyStateMessage,
  buildSessionPreviewMessage,
  mapWorkspaceFilesToDiffItems,
} from "./session-diff-state";

export type SessionDiffPanelState = "loading" | "ready" | "error";

interface SessionDiffPanelProps {
  state: SessionDiffPanelState;
  status: WorkspaceStatus | null;
  diff: WorkspaceDiff | null;
  preview?: WorkspaceFileContent | null;
  mode?: SessionInspectionMode;
  selectedPath: string | null;
  errorMessage?: string;
  onSelectFile: (path: string) => void;
  onModeChange?: (mode: SessionInspectionMode) => void;
}

export function SessionDiffPanel({
  state,
  status,
  diff,
  preview = null,
  mode = "diff",
  selectedPath,
  errorMessage,
  onSelectFile,
  onModeChange,
}: SessionDiffPanelProps) {
  const files = status ? mapWorkspaceFilesToDiffItems(status.changedFiles) : [];
  const emptyStateMessage = status
    ? buildSessionDiffEmptyStateMessage(status.isGitRepo, status.changedFiles)
    : null;
  const previewMessage =
    mode === "preview" ? buildSessionPreviewMessage(preview) : null;

  return (
    <section data-testid="session-diff-panel" className="border-b px-4 py-3">
      <div className="mb-2 text-xs font-semibold">Changes</div>

      {state === "loading" ? (
        <div className="text-muted-foreground text-xs">Loading changes…</div>
      ) : null}

      {state === "error" ? (
        <div className="text-destructive text-xs">
          {errorMessage ?? "Failed to load changes"}
        </div>
      ) : null}

      {state === "ready" && emptyStateMessage ? (
        <div className="text-muted-foreground text-xs">{emptyStateMessage}</div>
      ) : null}

      {state === "ready" && !emptyStateMessage ? (
        <div className="flex max-h-56 gap-3 overflow-hidden">
          <div className="min-w-0 flex-1 space-y-1 overflow-auto">
            {files.map((file) => {
              const isSelected = file.path === selectedPath;

              return (
                <button
                  key={file.path}
                  type="button"
                  onClick={() => onSelectFile(file.path)}
                  className={`block w-full rounded border px-2 py-1 text-left ${isSelected ? "bg-accent" : "bg-background"}`}
                >
                  <div className="truncate text-xs font-medium">
                    {file.fileName}
                  </div>
                  <div className="text-muted-foreground truncate text-[11px]">
                    {file.directory} · {file.statusLabel}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="min-w-0 flex-1 overflow-hidden">
            <div className="mb-2 flex gap-2">
              <Button
                type="button"
                variant={mode === "diff" ? "default" : "outline"}
                size="sm"
                onClick={() => onModeChange?.("diff")}
              >
                Diff
              </Button>
              <Button
                type="button"
                variant={mode === "preview" ? "default" : "outline"}
                size="sm"
                onClick={() => onModeChange?.("preview")}
              >
                Preview
              </Button>
            </div>

            <pre className="bg-muted min-w-0 overflow-auto rounded p-2 text-[11px] whitespace-pre-wrap">
              {mode === "diff"
                ? diff?.unifiedDiff ||
                  (selectedPath
                    ? (errorMessage ?? "Loading diff…")
                    : "Select a changed file to inspect its diff.")
                : (previewMessage ?? preview?.content)}
            </pre>
          </div>
        </div>
      ) : null}
    </section>
  );
}
