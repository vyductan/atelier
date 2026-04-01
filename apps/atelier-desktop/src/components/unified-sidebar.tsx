import { MessageSquare, Plus, Search } from "lucide-react";

import { Button } from "@acme/ui/components/button";
import { Input } from "@acme/ui/components/input";

import type { SessionEntry } from "../lib/types";
import type { UnifiedSidebarWorkspaceViewModel } from "../lib/unified-sidebar-state";
import { UnifiedSidebarProjectGroup } from "./unified-sidebar-project-group";

interface UnifiedSidebarProps {
  groups: UnifiedSidebarWorkspaceViewModel[];
  sessionsById: Map<string, SessionEntry>;
  isLoading: boolean;
  error?: string;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  renamingSessionId: string | null;
  selectedTaskId: string | null;
  onAddGeneralWorkspace: () => void;
  onAddWorkspace: () => void;
  onToggleWorkspace: (workspacePath: string) => void;
  onCreateSession: (workspacePath: string) => void;
  onSelectTask: (taskId: string) => void;
  onSelectSession: (sessionId: string) => void;
  onRenameStart: (session: SessionEntry) => void;
  onRenameCancel: () => void;
  onRenameSubmit: (session: SessionEntry, nextTitle: string) => Promise<void>;
  onRenameError: (message: string) => void;
  onDeleteSession: (session: SessionEntry) => void;
  onReconnect: (workspacePath: string) => void;
}

export function UnifiedSidebar({
  groups,
  sessionsById,
  isLoading,
  error,
  searchQuery,
  onSearchQueryChange,
  renamingSessionId,
  selectedTaskId,
  onAddGeneralWorkspace,
  onAddWorkspace,
  onToggleWorkspace,
  onCreateSession,
  onSelectTask,
  onSelectSession,
  onRenameStart,
  onRenameCancel,
  onRenameSubmit,
  onRenameError,
  onDeleteSession,
  onReconnect,
}: UnifiedSidebarProps) {
  return (
    <aside className="flex min-h-0 flex-1 w-80 shrink-0 flex-col overflow-hidden border-r">
      <div className="flex h-12 items-center justify-between border-b px-3">
        <span className="text-sm font-semibold">Workspaces</span>
        <div className="flex">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={onAddGeneralWorkspace}
            title="General Chat (~/.atelier)"
          >
            <MessageSquare className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={onAddWorkspace}
            title="Add Workspace"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="border-b px-3 py-2">
        <div className="relative">
          <Search className="text-muted-foreground absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2" />
          <Input
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            placeholder="Search tasks & sessions..."
            className="h-8 pl-8 text-xs"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {error ? (
          <div className="flex flex-col items-center justify-center p-4 text-center">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        ) : isLoading && groups.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-4 text-center">
            <p className="text-muted-foreground text-sm">Loading...</p>
          </div>
        ) : groups.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-4 text-center">
            {searchQuery ? (
              <p className="text-muted-foreground text-sm">No items found.</p>
            ) : (
              <>
                <p className="text-muted-foreground mb-4 text-sm">
                  No workspaces yet.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onAddWorkspace}
                  className="w-full max-w-[200px]"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add Workspace
                </Button>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-1">
            {groups.map((group) => (
              <UnifiedSidebarProjectGroup
                key={group.workspacePath}
                group={group}
                sessionsById={sessionsById}
                renamingSessionId={renamingSessionId}
                selectedTaskId={selectedTaskId}
                onToggleExpanded={onToggleWorkspace}
                onCreateSession={onCreateSession}
                onSelectTask={onSelectTask}
                onSelectSession={onSelectSession}
                onRenameStart={onRenameStart}
                onRenameCancel={onRenameCancel}
                onRenameSubmit={onRenameSubmit}
                onRenameError={onRenameError}
                onDeleteSession={onDeleteSession}
                onReconnect={onReconnect}
              />
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
