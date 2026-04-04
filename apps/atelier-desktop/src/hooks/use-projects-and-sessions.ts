import type { QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";

import type { SessionEntry } from "../lib/types";
import { getProjectSessions, listProjects } from "../lib/tauri";
import {
  buildProjectGroupResult,
  getChangedProjectEscapedPath,
  shouldInvalidateProjectsAndSessions,
} from "./use-projects-and-sessions-state";

export interface ProjectGroup {
  name: string;
  escapedPath: string;
  sessions: SessionEntry[];
  error?: string;
  isMissing: boolean;
}

export interface UseProjectsAndSessionsResult {
  groups: ProjectGroup[];
  isLoading: boolean;
  error?: string;
}

interface ProjectSummary {
  name: string;
  escapedPath: string;
  isMissing: boolean;
}

let projectsAndSessionsListenerPromise: Promise<(() => void) | void> | null =
  null;
let projectsAndSessionsListenerUsers = 0;
const latestProjectRefreshRequestIds = new Map<string, number>();
let allSessionsDataVersion = 0;

function shouldIncludeProjectGroup(group: ProjectGroup): boolean {
  return group.sessions.length > 0 || Boolean(group.error);
}

function orderProjectGroups(
  projects: ProjectSummary[],
  groups: ProjectGroup[],
): ProjectGroup[] {
  const groupsByEscapedPath = new Map(
    groups.map((group) => [group.escapedPath, group] as const),
  );

  return projects
    .map((project) => groupsByEscapedPath.get(project.escapedPath) ?? null)
    .filter((group): group is ProjectGroup => group !== null);
}

async function loadProjectGroup(
  project: ProjectSummary,
): Promise<ProjectGroup> {
  try {
    const index = await getProjectSessions(project.escapedPath, {
      includeSidechains: false,
      includeUnindexed: true,
    });
    return buildProjectGroupResult({
      name: project.name,
      escapedPath: project.escapedPath,
      sessionsResult: { ok: true, sessions: index.entries },
      isMissing: project.isMissing,
    });
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : `Failed to load sessions for ${project.name}`;

    return buildProjectGroupResult({
      name: project.name,
      escapedPath: project.escapedPath,
      sessionsResult: { ok: false, error: message },
      isMissing: project.isMissing,
    });
  }
}

function ensureProjectsAndSessionsListener(queryClient: QueryClient) {
  if (!projectsAndSessionsListenerPromise) {
    projectsAndSessionsListenerPromise = listen<{ path: string; kind: string }>(
      "sessions-changed",
      (event) => {
        if (!shouldInvalidateProjectsAndSessions(event.payload)) {
          return;
        }

        const changedProjectEscapedPath = getChangedProjectEscapedPath(
          event.payload,
        );
        if (!changedProjectEscapedPath) {
          void queryClient.invalidateQueries({ queryKey: ["all-sessions"] });
          return;
        }

        const projects = queryClient.getQueryData<ProjectSummary[]>([
          "projects",
        ]);
        if (!projects) {
          void queryClient.invalidateQueries({ queryKey: ["all-sessions"] });
          return;
        }

        const changedProject = projects.find(
          (project) => project.escapedPath === changedProjectEscapedPath,
        );

        if (!changedProject) {
          void queryClient.invalidateQueries({ queryKey: ["all-sessions"] });
          return;
        }

        const nextRequestId =
          (latestProjectRefreshRequestIds.get(changedProjectEscapedPath) ?? 0) +
          1;
        latestProjectRefreshRequestIds.set(
          changedProjectEscapedPath,
          nextRequestId,
        );

        void loadProjectGroup(changedProject).then((nextGroup) => {
          if (
            latestProjectRefreshRequestIds.get(changedProjectEscapedPath) !==
            nextRequestId
          ) {
            return;
          }

          allSessionsDataVersion += 1;

          queryClient.setQueryData<ProjectGroup[]>(
            ["all-sessions", projects.map((project) => project.escapedPath)],
            (currentGroups) => {
              const currentProjectGroups = currentGroups ?? [];
              const remainingGroups = currentProjectGroups.filter(
                (group) => group.escapedPath !== changedProjectEscapedPath,
              );
              const updatedGroups = shouldIncludeProjectGroup(nextGroup)
                ? [...remainingGroups, nextGroup]
                : remainingGroups;

              return orderProjectGroups(projects, updatedGroups);
            },
          );
        });
      },
    );
  }

  projectsAndSessionsListenerUsers += 1;

  return () => {
    projectsAndSessionsListenerUsers -= 1;

    if (
      projectsAndSessionsListenerUsers === 0 &&
      projectsAndSessionsListenerPromise
    ) {
      const listenerPromise = projectsAndSessionsListenerPromise;
      projectsAndSessionsListenerPromise = null;
      void listenerPromise.then((unlisten) => unlisten?.());
    }
  };
}

/**
 * Fetches all projects and their sessions, returns flat groups for the sidebar.
 * Auto-refreshes via file system watcher events from the Rust backend.
 */
export function useProjectsAndSessions(): UseProjectsAndSessionsResult {
  const queryClient = useQueryClient();

  useEffect(
    () => ensureProjectsAndSessionsListener(queryClient),
    [queryClient],
  );

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: listProjects,
    staleTime: 30_000,
    refetchOnMount: true,
  });

  const projects = projectsQuery.data ?? [];

  const sessionQueries = useQuery({
    queryKey: ["all-sessions", projects.map((p) => p.escapedPath)],
    queryFn: async (): Promise<ProjectGroup[]> => {
      const queryDataVersion = allSessionsDataVersion;
      const results = await Promise.all(
        projects.map((project) => loadProjectGroup(project)),
      );
      const nextGroups = results.filter((group) =>
        shouldIncludeProjectGroup(group),
      );

      if (queryDataVersion !== allSessionsDataVersion) {
        return (
          queryClient.getQueryData<ProjectGroup[]>([
            "all-sessions",
            projects.map((project) => project.escapedPath),
          ]) ?? nextGroups
        );
      }

      return nextGroups;
    },
    enabled: projects.length > 0,
    staleTime: 30_000,
  });

  const projectsError =
    projectsQuery.error instanceof Error && projectsQuery.error.message
      ? projectsQuery.error.message
      : projectsQuery.error
        ? "Failed to load projects"
        : undefined;

  return {
    groups: sessionQueries.data ?? [],
    isLoading: projectsQuery.isLoading || sessionQueries.isLoading,
    error: projectsError,
  };
}
