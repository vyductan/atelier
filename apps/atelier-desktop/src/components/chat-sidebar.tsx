import { useMemo, useState } from "react";

import type { SessionEntry, WorkspaceRecord } from "../lib/types";
import { useProjectsAndSessions } from "../hooks/use-projects-and-sessions";
import { useSessionOperations } from "../hooks/use-session-operations";
import { useWorkspaceSessions } from "../hooks/use-workspace-sessions";
import { atelierClient } from "../lib/atelier-client";
import {
  buildWorkspaceSidebarItems,
  findWorkspaceSession,
} from "../lib/workspace-session-model";
import { useSessionStore } from "../store/session-store";
import { useToastStore } from "../store/toast-store";
import { DeleteDialog } from "./delete-dialog";
import { UnifiedSidebar } from "./unified-sidebar";
import { buildSessionSidebarState } from "./session-sidebar-state";
import { buildUnifiedSidebarState } from "../lib/unified-sidebar-state";
import type { TaskRecord } from "../lib/tasks";

import { updateWorkspacePath } from "../lib/tauri";
import { useQueryClient } from "@tanstack/react-query";

function getWorkspacePath(group: {
  escapedPath: string;
  sessions: Array<{ projectPath: string }>;
}): string {
  return group.sessions[0]?.projectPath ?? group.escapedPath;
}

interface ChatSidebarProps {
  allTasks: TaskRecord[];
  selectedTaskId: string | null;
  onSelectTask: (taskId: string) => void;
}

export function ChatSidebar({ allTasks, selectedTaskId, onSelectTask }: ChatSidebarProps) {
  const {
    selectedSessionId,
    setSelectedSessionId,
    selectedWorkspaceId,
    setSelectedWorkspaceId,
    expandedWorkspaceIds,
    toggleWorkspaceExpanded,
    searchQuery,
    setSearchQuery,
    setNewSessionProject,
    setNewSessionContextWindow,
  } = useSessionStore();
  const { groups, isLoading, error } = useProjectsAndSessions();
  const { sessions: workspaceSessions } = useWorkspaceSessions();
  const { deleteSession, isDeleting } = useSessionOperations();
  const addToast = useToastStore((state) => state.addToast);
  const [sessionToDelete, setSessionToDelete] = useState<SessionEntry | null>(
    null,
  );
  const [renamingSession, setRenamingSession] = useState<SessionEntry | null>(
    null,
  );
  const queryClient = useQueryClient();

  const handleReconnect = async (workspaceEscapedPath: string) => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        title: "Select the new directory for this workspace",
      });

      if (!selected || Array.isArray(selected)) {
        return;
      }

      const newPath = selected;
      await updateWorkspacePath(workspaceEscapedPath, newPath);
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      await queryClient.invalidateQueries({ queryKey: ["all-sessions"] });
      addToast("Workspace path updated successfully", "success");
    } catch (error_) {
      addToast(
        error_ instanceof Error ? error_.message : "Failed to update workspace path",
        "error"
      );
    }
  };

  const workspaces = useMemo<WorkspaceRecord[]>(
    () =>
      groups.map((group) => {
        const workspacePath = getWorkspacePath(group);

        return {
          id: workspacePath,
          path: workspacePath,
          repoRoot: workspacePath,
          branch: null,
          isWorktree: false,
          activeTaskIds: [],
        } satisfies WorkspaceRecord;
      }),
    [groups],
  );

  const sidebarGroups = useMemo(() => {
    const items = buildWorkspaceSidebarItems({
      workspaces,
      sessions: workspaceSessions,
      selectedSessionId,
      selectedWorkspaceId,
      expandedWorkspaceIds,
      searchQuery,
    });

    const groupsByWorkspacePath = new Map(
      groups.map((group) => [getWorkspacePath(group), group]),
    );

    const sessionSidebarState = buildSessionSidebarState(items).map((group) => {
      const sourceGroup = groupsByWorkspacePath.get(group.workspacePath);
      const isMissing = sourceGroup?.isMissing ?? false;
      const errorMsg = sourceGroup?.error;
      const sessionsLen = sourceGroup?.sessions?.length ?? 0;

      return {
        ...group,
        name: sourceGroup?.name ?? group.name,
        // Keep the existing isCollapsed state instead of forcing false
        emptyStateLabel: sessionsLen === 0 ? "No sessions yet" : undefined,
        errorLabel: errorMsg,
        isMissing,
      };
    });

    // Merge with tasks and sort
    return buildUnifiedSidebarState(sessionSidebarState, allTasks);
  }, [
    expandedWorkspaceIds,
    groups,
    searchQuery,
    selectedSessionId,
    selectedWorkspaceId,
    workspaces,
    workspaceSessions,
    allTasks,
  ]);

  const sessionsById = useMemo(
    () =>
      new Map(
        groups
          .flatMap((group) => group.sessions)
          .map((session) => [session.sessionId, session]),
      ),
    [groups],
  );

  const handleDeleteConfirm = (permanent: boolean) => {
    if (!sessionToDelete) {
      return;
    }

    const group = groups.find((candidate) =>
      candidate.sessions.some(
        (session) => session.sessionId === sessionToDelete.sessionId,
      ),
    );
    if (!group) {
      return;
    }

    deleteSession(
      {
        sessionId: sessionToDelete.sessionId,
        escapedPath: group.escapedPath,
        permanent,
      },
      { onSuccess: () => setSessionToDelete(null) },
    );
  };

  const handleAddGeneralWorkspace = () => {
    const generalPath = "~/.atelier";
    setSelectedWorkspaceId(generalPath);
    setNewSessionProject(generalPath);
    setNewSessionContextWindow(null);
    setSelectedSessionId(null);
  };

  const handleAddWorkspace = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        title: "Select Workspace Folder",
      });

      if (!selected || Array.isArray(selected)) {
        return;
      }

      setSelectedWorkspaceId(selected);
      setNewSessionProject(selected);
      setNewSessionContextWindow(null);
      setSelectedSessionId(null);
    } catch (error_) {
      addToast(
        error_ instanceof Error ? error_.message : "Failed to select workspace folder",
        "error"
      );
    }
  };

  return (
    <>
      <UnifiedSidebar
        groups={sidebarGroups}
        sessionsById={sessionsById}
        isLoading={isLoading}
        error={error}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        renamingSessionId={renamingSession?.sessionId ?? null}
        selectedTaskId={selectedTaskId}
        onAddGeneralWorkspace={handleAddGeneralWorkspace}
        onAddWorkspace={handleAddWorkspace}
        onToggleWorkspace={toggleWorkspaceExpanded}
        onCreateSession={(projectPath) => {
          setSelectedWorkspaceId(projectPath);
          setNewSessionProject(projectPath);
          setNewSessionContextWindow(null);
          setSelectedSessionId(null);
        }}
        onSelectTask={onSelectTask}
        onSelectSession={(sessionId) => {
          const session = findWorkspaceSession(workspaceSessions, sessionId);
          setSelectedWorkspaceId(session?.workspaceId ?? null);
          setSelectedSessionId(sessionId);
          setNewSessionProject(null);
        }}
        onRenameStart={setRenamingSession}
        onRenameCancel={() => setRenamingSession(null)}
        onRenameSubmit={async (session, nextTitle) => {
          await atelierClient.sessions.rename(session.fullPath, nextTitle);
        }}
        onRenameError={(message) => addToast(message, "error")}
        onDeleteSession={setSessionToDelete}
        onReconnect={(workspacePath) => {
          const originalGroup = groups.find(
            (g) => getWorkspacePath(g) === workspacePath
          );
          if (originalGroup) {
            void handleReconnect(originalGroup.escapedPath);
          }
        }}
      />

      <DeleteDialog
        session={sessionToDelete}
        isOpen={!!sessionToDelete}
        onClose={() => setSessionToDelete(null)}
        onConfirm={handleDeleteConfirm}
        isDeleting={isDeleting}
      />
    </>
  );
}
