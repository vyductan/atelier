import { ChevronDown, ChevronRight, Folder, Plus } from "lucide-react";

import { Button } from "@acme/ui/components/button";

import type { SessionEntry } from "../lib/types";
import type { SessionSidebarWorkspaceViewModel } from "./session-sidebar-state";
import { SessionSidebarItem } from "./session-sidebar-item";

interface SessionSidebarProjectGroupProps {
  group: SessionSidebarWorkspaceViewModel;
  sessionsById: Map<string, SessionEntry>;
  renamingSessionId: string | null;
  onToggle: (workspacePath: string) => void;
  onCreateSession: (workspacePath: string) => void;
  onSelectSession: (sessionId: string) => void;
  onRenameStart: (session: SessionEntry) => void;
  onRenameCancel: () => void;
  onRenameSubmit: (session: SessionEntry, nextTitle: string) => Promise<void>;
  onRenameError: (message: string) => void;
  onDeleteSession: (session: SessionEntry) => void;
  onReconnect?: (workspacePath: string) => void;
}

export function SessionSidebarProjectGroup({
  group,
  sessionsById,
  renamingSessionId,
  onToggle,
  onCreateSession,
  onSelectSession,
  onRenameStart,
  onRenameCancel,
  onRenameSubmit,
  onRenameError,
  onDeleteSession,
  onReconnect,
}: SessionSidebarProjectGroupProps) {
  return (
    <div className="mb-1">
      <div className="flex items-center gap-1 px-3 py-1">
        <button
          type="button"
          aria-expanded={!group.isCollapsed}
          onClick={() => onToggle(group.workspacePath)}
          className="hover:bg-muted/50 flex min-w-0 flex-1 items-center gap-1.5 rounded-sm px-0 py-0 text-left"
        >
          {group.isCollapsed ? (
            <ChevronRight className="text-muted-foreground h-3 w-3 shrink-0" />
          ) : (
            <ChevronDown className="text-muted-foreground h-3 w-3 shrink-0" />
          )}
          <Folder className="text-muted-foreground h-3 w-3 shrink-0" />
          <span className="text-muted-foreground flex-1 truncate text-xs font-medium">
            {group.name}
          </span>
          <span className="text-muted-foreground ml-1 text-xs">
            {group.sessionCount}
          </span>
        </button>
        {group.isMissing ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => onReconnect?.(group.workspacePath)}
            title="Update missing workspace path"
          >
            Update Path
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => onCreateSession(group.workspacePath)}
            title="New session in this workspace"
          >
            <Plus className="h-3 w-3" />
          </Button>
        )}
      </div>

      {group.isCollapsed ? null : (
        <div className="space-y-0.5 px-1">
          {group.errorLabel ? (
            <p className="text-muted-foreground px-3 py-2 text-xs">
              {group.errorLabel}
            </p>
          ) : null}
          {group.sessions.map((item) => {
            const session = sessionsById.get(item.sessionId);
            if (!session) {
              return null;
            }

            return (
              <SessionSidebarItem
                key={item.sessionId}
                item={item}
                session={session}
                isRenaming={renamingSessionId === item.sessionId}
                onSelect={() => onSelectSession(item.sessionId)}
                onRename={() => onRenameStart(session)}
                onRenameCancel={onRenameCancel}
                onRenameSubmit={onRenameSubmit}
                onRenameError={onRenameError}
                onDelete={() => onDeleteSession(session)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
