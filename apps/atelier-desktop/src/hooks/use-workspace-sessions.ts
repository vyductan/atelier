import type { ProviderSession, SessionEntry } from "../lib/types";
import { useProjectsAndSessions } from "./use-projects-and-sessions";

export interface WorkspaceSession extends ProviderSession {
  providerLabel: "Claude";
  source: SessionEntry;
}

export interface UseWorkspaceSessionsResult {
  sessions: WorkspaceSession[];
  isLoading: boolean;
  error?: string;
}

export function useWorkspaceSessions(): UseWorkspaceSessionsResult {
  const { groups, isLoading, error } = useProjectsAndSessions();

  return {
    sessions: groups.flatMap((group) =>
      group.sessions.map((session) => ({
        id: session.sessionId,
        workspaceId: session.projectPath || null,
        provider: "claude",
        providerLabel: "Claude",
        title: session.summary ?? session.firstPrompt,
        subtitle: `${session.messageCount} messages`,
        updatedAt: session.modified,
        source: session,
      })),
    ),
    isLoading,
    error,
  };
}
