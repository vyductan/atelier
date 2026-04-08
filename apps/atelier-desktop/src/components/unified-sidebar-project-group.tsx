import { ChevronDown, ChevronRight, Folder, Plus } from "lucide-react";
import { Button } from "@acme/ui/components/button";
import { Badge } from "@acme/ui/components/badge";

import type { SessionEntry } from "../lib/types";
import type { UnifiedSidebarWorkspaceViewModel } from "../lib/unified-sidebar-state";
import { SessionSidebarItem } from "./session-sidebar-item";
import { TaskListItem } from "./task-list-item";

interface UnifiedSidebarProjectGroupProps {
  group: UnifiedSidebarWorkspaceViewModel;
  sessionsById: Map<string, SessionEntry>;
  renamingSessionId: string | null;
  selectedTaskId: string | null;
  selectedWorkspaceId: string | null;
  onToggleExpanded: (workspacePath: string) => void;
  onSelectWorkspace: (workspacePath: string) => void;
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

export function UnifiedSidebarProjectGroup({
  group,
  sessionsById,
  renamingSessionId,
  selectedTaskId,
  selectedWorkspaceId,
  onToggleExpanded,
  onSelectWorkspace,
  onCreateSession,
  onSelectTask,
  onSelectSession,
  onRenameStart,
  onRenameCancel,
  onRenameSubmit,
  onRenameError,
  onDeleteSession,
  onReconnect,
}: UnifiedSidebarProjectGroupProps) {
  return (
    <div key={group.workspacePath} className="flex flex-col">
      <div className="group flex items-center justify-between px-3 py-1 text-sm font-medium hover:bg-muted/50 rounded-md">
        <button
          className="flex flex-1 items-center gap-2 overflow-hidden text-left"
          data-selected={group.workspacePath === selectedWorkspaceId}
          onClick={() => onSelectWorkspace(group.workspacePath)}
        >
          {group.isCollapsed ? (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate">{group.name}</span>
          <Badge variant="secondary" className="px-1 text-[10px] font-normal">
            {group.itemCount}
          </Badge>
        </button>

        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpanded(group.workspacePath);
          }}
          title={group.isCollapsed ? "Expand workspace" : "Collapse workspace"}
        >
          {group.isCollapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </Button>

        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {group.isMissing ? (
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2 text-xs text-destructive"
              onClick={(e) => {
                e.stopPropagation();
                onReconnect(group.workspacePath);
              }}
              title="Locate workspace directory"
            >
              <Folder className="mr-1 h-3 w-3" />
              Locate
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={(e) => {
                e.stopPropagation();
                if (group.isCollapsed) {
                  onToggleExpanded(group.workspacePath);
                  setTimeout(() => onCreateSession(group.workspacePath), 0);
                } else {
                  onCreateSession(group.workspacePath);
                }
              }}
              title="New session"
            >
              <Plus className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {!group.isCollapsed && (
        <div className="mt-1 flex flex-col gap-1 px-3 pl-8">
          {group.items.map((item) => {
            if (item.type === "session") {
              const session = sessionsById.get(item.item.sessionId);
              if (!session) return null;

              return (
                <SessionSidebarItem
                  key={item.item.sessionId}
                  item={item.item}
                  session={session}
                  isRenaming={renamingSessionId === item.item.sessionId}
                  onSelect={() => onSelectSession(item.item.sessionId)}
                  onRename={() => onRenameStart(session)}
                  onRenameCancel={onRenameCancel}
                  onRenameSubmit={onRenameSubmit}
                  onRenameError={onRenameError}
                  onDelete={() => onDeleteSession(session)}
                />
              );
            }

            if (item.type === "task") {
              return (
                <TaskListItem
                  key={item.item.id}
                  task={item.item}
                  isSelected={item.item.id === selectedTaskId}
                  onSelectTask={onSelectTask}
                />
              );
            }

            return null;
          })}

          {group.emptyStateLabel && (
            <p className="py-2 text-xs text-muted-foreground">
              {group.emptyStateLabel}
            </p>
          )}

          {group.errorLabel && (
            <p className="py-2 text-xs text-destructive">{group.errorLabel}</p>
          )}
        </div>
      )}
    </div>
  );
}
