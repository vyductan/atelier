import { useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { ChevronDown, ChevronRight, Eye, Trash2 } from "lucide-react";

import type { SessionEntry } from "../lib/types";
import { useSessionOperations } from "../hooks/use-session-operations";
import { useSessions } from "../hooks/use-sessions";
import { useSessionStore } from "../store/session-store";
import { DeleteDialog } from "./delete-dialog";
import { EmptySearchResult, EmptySession, SelectProject } from "./empty-states";
import { SessionTableSkeleton } from "./skeletons";

export function SessionTable() {
  const {
    selectedProject,
    searchQuery,
    filterBranch,
    setSelectedSessionId,
    setPreviewOpen,
  } = useSessionStore();
  const {
    data: sessionIndex,
    isLoading,
    error,
  } = useSessions(selectedProject?.escapedPath || null);
  const { deleteSession, isDeleting } = useSessionOperations();
  const [sessionToDelete, setSessionToDelete] = useState<SessionEntry | null>(
    null,
  );
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(
    new Set(),
  );

  // Filter sessions based on search and filters
  const filteredSessions = useMemo(() => {
    if (!sessionIndex?.entries) return [];

    let sessions = sessionIndex.entries;

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      sessions = sessions.filter(
        (s) =>
          s.firstPrompt.toLowerCase().includes(query) ||
          s.summary?.toLowerCase().includes(query) ||
          s.gitBranch?.toLowerCase().includes(query),
      );
    }

    // Branch filter
    if (filterBranch) {
      sessions = sessions.filter((s) => s.gitBranch === filterBranch);
    }

    return sessions;
  }, [sessionIndex?.entries, searchQuery, filterBranch]);

  if (!selectedProject) {
    return <SelectProject />;
  }

  if (isLoading) {
    return <SessionTableSkeleton />;
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-destructive text-sm">
          Error loading sessions: {error.message}
        </div>
      </div>
    );
  }

  if (filteredSessions.length === 0) {
    return searchQuery || filterBranch ? (
      <EmptySearchResult />
    ) : (
      <EmptySession />
    );
  }

  const toggleExpand = (sessionId: string) => {
    setExpandedSessions((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(sessionId)) {
        newSet.delete(sessionId);
      } else {
        newSet.add(sessionId);
      }
      return newSet;
    });
  };

  const handleDeleteConfirm = (permanent: boolean) => {
    if (!sessionToDelete || !selectedProject) return;

    deleteSession(
      {
        sessionId: sessionToDelete.sessionId,
        escapedPath: selectedProject.escapedPath,
        permanent,
      },
      {
        onSuccess: () => {
          setSessionToDelete(null);
        },
      },
    );
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="bg-muted/50 border-b px-4 py-3">
        <h2 className="text-lg font-semibold">{selectedProject.name}</h2>
        <p className="text-muted-foreground text-sm">
          {filteredSessions.length} session
          {filteredSessions.length === 1 ? "" : "s"}
        </p>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full">
          <thead className="bg-background sticky top-0 border-b">
            <tr className="text-muted-foreground text-left text-sm font-medium">
              <th className="px-4 py-3">First Prompt</th>
              <th className="px-4 py-3">Summary</th>
              <th className="px-4 py-3">Branch</th>
              <th className="w-24 px-4 py-3">Messages</th>
              <th className="w-32 px-4 py-3">Modified</th>
              <th className="w-24 px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredSessions.map((session) => (
              <>
                <SessionRow
                  key={session.sessionId}
                  session={session}
                  depth={0}
                  isExpanded={expandedSessions.has(session.sessionId)}
                  onToggleExpand={() => toggleExpand(session.sessionId)}
                  onPreview={() => {
                    setSelectedSessionId(session.sessionId);
                    setPreviewOpen(true);
                  }}
                  onDelete={() => setSessionToDelete(session)}
                />
                {expandedSessions.has(session.sessionId) &&
                  session.children?.map((child) => (
                    <SessionRow
                      key={child.sessionId}
                      session={child}
                      depth={1}
                      isExpanded={false}
                      onToggleExpand={() => {
                        /* noop */
                      }}
                      onPreview={() => {
                        setSelectedSessionId(child.sessionId);
                        setPreviewOpen(true);
                      }}
                      onDelete={() => setSessionToDelete(child)}
                    />
                  ))}
              </>
            ))}
          </tbody>
        </table>
      </div>

      {/* Delete Dialog */}
      <DeleteDialog
        session={sessionToDelete}
        isOpen={!!sessionToDelete}
        onClose={() => setSessionToDelete(null)}
        onConfirm={handleDeleteConfirm}
        isDeleting={isDeleting}
      />
    </div>
  );
}

interface SessionRowProps {
  session: SessionEntry;
  depth: number;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onPreview: () => void;
  onDelete: () => void;
}

function SessionRow({
  session,
  depth,
  isExpanded,
  onToggleExpand,
  onPreview,
  onDelete,
}: SessionRowProps) {
  const modifiedDate = new Date(session.modified);
  const hasChildren = session.children && session.children.length > 0;

  return (
    <tr className="hover:bg-muted/50 border-b transition-colors">
      <td className="px-4 py-3">
        <div
          className="flex items-center gap-2"
          style={{ paddingLeft: `${depth * 24}px` }}
        >
          {hasChildren ? (
            <button
              onClick={onToggleExpand}
              className="hover:bg-accent rounded p-0.5"
              title={isExpanded ? "Collapse" : "Expand"}
            >
              {isExpanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>
          ) : (
            <div className="w-5" />
          )}
          <div className="max-w-md truncate text-sm">
            {session.firstPrompt}
            {hasChildren && (
              <span className="text-muted-foreground ml-2 text-xs">
                ({session.children?.length} subagent
                {session.children?.length === 1 ? "" : "s"})
              </span>
            )}
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="text-muted-foreground max-w-md truncate text-sm">
          {session.summary || "—"}
        </div>
      </td>
      <td className="px-4 py-3">
        {session.gitBranch ? (
          <span className="bg-secondary inline-flex items-center rounded-full px-2 py-1 text-xs font-medium">
            {session.gitBranch}
          </span>
        ) : (
          <span className="text-muted-foreground text-sm">—</span>
        )}
      </td>
      <td className="px-4 py-3 text-sm">{session.messageCount}</td>
      <td className="text-muted-foreground px-4 py-3 text-sm">
        {formatDistanceToNow(modifiedDate, { addSuffix: true })}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <button
            onClick={onPreview}
            className="text-muted-foreground hover:bg-accent hover:text-accent-foreground rounded p-1 transition-colors"
            title="Preview session"
          >
            <Eye className="h-4 w-4" />
          </button>
          <button
            onClick={onDelete}
            className="text-muted-foreground hover:bg-destructive hover:text-destructive-foreground rounded p-1 transition-colors"
            title="Delete session"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </td>
    </tr>
  );
}
