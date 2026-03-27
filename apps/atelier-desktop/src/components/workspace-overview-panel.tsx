import type { ReactElement } from "react";

interface WorkspaceOverviewPanelProps {
  workspaceId: string;
}

export function WorkspaceOverviewPanel({
  workspaceId,
}: WorkspaceOverviewPanelProps): ReactElement {
  const label = workspaceId.split("/").findLast(Boolean) ?? workspaceId;

  return (
    <section className="flex h-full flex-col justify-center px-6 py-8">
      <h2 className="text-sm font-semibold">{label}</h2>
      <p className="text-muted-foreground mt-2 text-sm">
        Select a session to continue, or start a new session in this workspace.
      </p>
    </section>
  );
}
