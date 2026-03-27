import type { SessionEntry } from "../lib/types";

export interface ProjectGroupResult {
  name: string;
  escapedPath: string;
  sessions: SessionEntry[];
  error?: string;
  isMissing: boolean;
}

export interface SessionsChangedPayload {
  path: string;
  kind: string;
}

export type ProjectSessionsResult =
  | { ok: true; sessions: SessionEntry[] }
  | { ok: false; error: string };

export function sortSessionEntriesByModified(
  entries: SessionEntry[],
): SessionEntry[] {
  return entries.toSorted(
    (a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime(),
  );
}

export function shouldInvalidateProjectsAndSessions(
  payload: SessionsChangedPayload,
): boolean {
  return (
    payload.path.endsWith(".jsonl") ||
    payload.path.endsWith("sessions-index.json")
  );
}

export function getChangedProjectEscapedPath(
  payload: SessionsChangedPayload,
): string | null {
  const normalizedPath = payload.path.replaceAll("\\", "/");
  const marker = "/.claude/projects/";
  const startIndex = normalizedPath.indexOf(marker);

  if (startIndex === -1) {
    return null;
  }

  const projectPath = normalizedPath.slice(startIndex + marker.length);
  const [escapedPath] = projectPath.split("/");
  return escapedPath || null;
}

export function buildProjectGroupResult(input: {
  name: string;
  escapedPath: string;
  sessionsResult: ProjectSessionsResult;
  isMissing: boolean;
}): ProjectGroupResult {
  if (!input.sessionsResult.ok) {
    return {
      name: input.name,
      escapedPath: input.escapedPath,
      sessions: [],
      error: input.sessionsResult.error,
      isMissing: input.isMissing,
    };
  }

  return {
    name: input.name,
    escapedPath: input.escapedPath,
    sessions: sortSessionEntriesByModified(input.sessionsResult.sessions),
    isMissing: input.isMissing,
  };
}
