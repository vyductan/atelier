import { formatDistance } from "date-fns";

import type { WorkspaceRecord } from "./tasks";
import type { ProviderSession } from "./types";

export interface WorkspaceSessionTimelineItem extends ProviderSession {
  timestampLabel: string;
  isSelected: boolean;
}

export interface WorkspaceSidebarItem {
  workspace: WorkspaceRecord;
  sessions: WorkspaceSessionTimelineItem[];
  isExpanded: boolean;
  isSelectedWorkspace: boolean;
}

function getSessionUpdatedAtTimestamp(session: ProviderSession): number {
  return new Date(session.updatedAt).getTime();
}

function matchesWorkspaceSearch(
  session: ProviderSession,
  normalizedSearchQuery: string,
): boolean {
  if (!normalizedSearchQuery) {
    return true;
  }

  return [session.title, session.subtitle, session.source.projectPath].some(
    (value) => value.toLowerCase().includes(normalizedSearchQuery),
  );
}

export function buildWorkspaceSidebarItems(input: {
  workspaces: WorkspaceRecord[];
  sessions: ProviderSession[];
  selectedSessionId: string | null;
  selectedWorkspaceId: string | null;
  expandedWorkspaceIds?: Set<string>;
  searchQuery: string;
  now?: Date;
}): WorkspaceSidebarItem[] {
  const now = input.now ?? new Date();
  const normalizedSearchQuery = input.searchQuery.trim().toLowerCase();
  const hasSearchQuery = normalizedSearchQuery.length > 0;

  return input.workspaces
    .map((workspace) => {
      const sessions = input.sessions
        .filter((session) => session.workspaceId === workspace.id)
        .filter((session) =>
          matchesWorkspaceSearch(session, normalizedSearchQuery),
        )
        .toSorted(
          (left, right) =>
            getSessionUpdatedAtTimestamp(right) -
            getSessionUpdatedAtTimestamp(left),
        )
        .map(
          (session) =>
            ({
              ...session,
              timestampLabel: formatDistance(new Date(session.updatedAt), now, {
                addSuffix: true,
              }),
              isSelected: session.id === input.selectedSessionId,
            }) satisfies WorkspaceSessionTimelineItem,
        );

      if (hasSearchQuery && sessions.length === 0) {
        return null;
      }

      const hasSelectedSession = sessions.some((session) => session.isSelected);

      return {
        workspace,
        sessions,
        isExpanded:
          hasSearchQuery ||
          hasSelectedSession ||
          Boolean(input.expandedWorkspaceIds?.has(workspace.id)),
        isSelectedWorkspace: workspace.id === input.selectedWorkspaceId,
      } satisfies WorkspaceSidebarItem;
    })
    .filter((item): item is WorkspaceSidebarItem => item !== null)
    .toSorted((left, right) => {
      const leftTimestamp = left.sessions[0]
        ? getSessionUpdatedAtTimestamp(left.sessions[0])
        : Number.NEGATIVE_INFINITY;
      const rightTimestamp = right.sessions[0]
        ? getSessionUpdatedAtTimestamp(right.sessions[0])
        : Number.NEGATIVE_INFINITY;

      return rightTimestamp - leftTimestamp;
    });
}

export function findWorkspaceSession(
  sessions: ProviderSession[],
  sessionId: string,
): ProviderSession | null {
  return sessions.find((session) => session.id === sessionId) ?? null;
}
