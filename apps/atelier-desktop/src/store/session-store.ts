import { create } from "zustand";

import type { ClaudeContextWindowValue } from "../lib/claude-model-capabilities";
import type { ProjectInfo, SessionEntry } from "../lib/types";

interface SessionStore {
  // Selected project
  selectedProject: ProjectInfo | null;
  setSelectedProject: (project: ProjectInfo | null) => void;

  // Sessions for current project
  sessions: SessionEntry[];
  setSessions: (sessions: SessionEntry[]) => void;

  // Search/filter state
  searchQuery: string;
  setSearchQuery: (query: string) => void;

  filterBranch: string | null;
  setFilterBranch: (branch: string | null) => void;

  // UI state
  selectedWorkspaceId: string | null;
  setSelectedWorkspaceId: (id: string | null) => void;

  expandedWorkspaceIds: Set<string>;
  setExpandedWorkspaceIds: (ids: Set<string>) => void;
  toggleWorkspaceExpanded: (workspaceId: string) => void;

  selectedSessionId: string | null;
  setSelectedSessionId: (id: string | null) => void;

  previewOpen: boolean;
  setPreviewOpen: (open: boolean) => void;

  newSessionProject: string | null;
  setNewSessionProject: (project: string | null) => void;

  newSessionPrompt: string | null;
  setNewSessionPrompt: (prompt: string | null) => void;

  newSessionContextWindow: ClaudeContextWindowValue | null;
  setNewSessionContextWindow: (
    value: ClaudeContextWindowValue | null,
  ) => void;

  // Helper to get selected session
  getSelectedSession: () => SessionEntry | null;
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  // Selected project
  selectedProject: null,
  setSelectedProject: (project) => set({ selectedProject: project }),

  // Sessions
  sessions: [],
  setSessions: (sessions) => set({ sessions }),

  // Search/filter
  searchQuery: "",
  setSearchQuery: (query) => set({ searchQuery: query }),

  filterBranch: null,
  setFilterBranch: (branch) => set({ filterBranch: branch }),

  // UI state
  selectedWorkspaceId: null,
  setSelectedWorkspaceId: (id) => set({ selectedWorkspaceId: id }),

  expandedWorkspaceIds: new Set<string>(),
  setExpandedWorkspaceIds: (ids) => set({ expandedWorkspaceIds: ids }),
  toggleWorkspaceExpanded: (workspaceId) =>
    set((state) => {
      const expandedWorkspaceIds = new Set(state.expandedWorkspaceIds);

      if (expandedWorkspaceIds.has(workspaceId)) {
        expandedWorkspaceIds.delete(workspaceId);
      } else {
        expandedWorkspaceIds.add(workspaceId);
      }

      return { expandedWorkspaceIds };
    }),

  selectedSessionId: null,
  setSelectedSessionId: (id) => set({ selectedSessionId: id }),

  previewOpen: false,
  setPreviewOpen: (open) => set({ previewOpen: open }),

  newSessionProject: null,
  setNewSessionProject: (project) => set({ newSessionProject: project }),

  newSessionPrompt: null,
  setNewSessionPrompt: (prompt) => set({ newSessionPrompt: prompt }),

  newSessionContextWindow: null,
  setNewSessionContextWindow: (value) => set({ newSessionContextWindow: value }),

  // Helper
  getSelectedSession: () => {
    const { sessions, selectedSessionId } = get();
    return sessions.find((s) => s.sessionId === selectedSessionId) || null;
  },
}));
