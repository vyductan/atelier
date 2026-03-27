import type { WorkspaceStatus } from "../lib/workspace";

export type WorkbenchStatusBarState = "loading" | "ready" | "error";

interface WorkbenchStatusBarProps {
  state: WorkbenchStatusBarState;
  status: WorkspaceStatus | null;
}

export function WorkbenchStatusBar({ state, status }: WorkbenchStatusBarProps) {
  let label = "Workspace unavailable";

  if (state === "loading") {
    label = "Loading workspace…";
  } else if (state === "ready") {
    if (status?.isGitRepo) {
      const branch = status.branch ?? status.worktreeLabel ?? "Workspace";
      label =
        status.totalChanged > 0
          ? `${branch} · ${status.totalChanged} changed`
          : `${branch} · Clean`;
    } else {
      label = "No git workspace";
    }
  }

  return (
    <div
      data-testid="workbench-status-bar"
      className="text-muted-foreground min-w-0 flex-1 truncate text-xs"
    >
      {label}
    </div>
  );
}
