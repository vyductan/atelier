

import type { WorkspaceSidebarItem } from "../lib/workspace-session-model";

export interface SessionSidebarItemViewModel {
  sessionId: string;
  title: string;
  subtitle: string;
  timestampLabel: string;
  providerLabel: string;
  isSelected: boolean;
  sortDate: number;
}

export interface SessionSidebarWorkspaceViewModel {
  name: string;
  workspacePath: string;
  sessionCount: number;
  isCollapsed: boolean;
  emptyStateLabel?: string;
  errorLabel?: string;
  isSelected: boolean;
  sessions: SessionSidebarItemViewModel[];
  isMissing?: boolean;
}

function getProviderLabel(
  provider: WorkspaceSidebarItem["sessions"][number]["provider"],
): string {
  switch (provider) {
    case "claude": {
      return "Claude";
    }
    case "openclaw": {
      return "OpenClaw";
    }
    default: {
      return provider;
    }
  }
}

export function buildSessionSidebarState(
  items: WorkspaceSidebarItem[],
): SessionSidebarWorkspaceViewModel[] {
  return items.map((item) => {
    const sessions = item.sessions.map(
      (session) =>
        ({
          sessionId: session.id,
          title: session.title,
          subtitle: session.subtitle,
          timestampLabel: session.timestampLabel,
          providerLabel: getProviderLabel(session.provider),
          isSelected: session.isSelected,
          sortDate: new Date(session.updatedAt).getTime(),
        }) satisfies SessionSidebarItemViewModel,
    );

    return {
      name: item.workspace.path.split(/[/\\]/).findLast(Boolean) || item.workspace.path,
      workspacePath: item.workspace.path,
      sessionCount: sessions.length,
      isCollapsed: !item.isExpanded,
      ...(sessions.length === 0 ? { emptyStateLabel: "No sessions yet" } : {}),
      isSelected: item.isSelectedWorkspace,
      sessions,
      isMissing: false,
    } satisfies SessionSidebarWorkspaceViewModel;
  });
}
