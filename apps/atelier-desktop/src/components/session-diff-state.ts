import type {
  WorkspaceFileContent,
  WorkspaceStatusFile,
} from "../lib/workspace";

export interface SessionDiffFileItem {
  path: string;
  fileName: string;
  directory: string;
  status: WorkspaceStatusFile["status"];
  statusLabel: string;
}

export type SessionInspectionMode = "diff" | "preview";

export function getDefaultSessionInspectionMode(): SessionInspectionMode {
  return "diff";
}

export function reconcileSelectedDiffFile(
  currentPath: string | null,
  files: WorkspaceStatusFile[],
): string | null {
  if (currentPath && files.some((file) => file.path === currentPath)) {
    return currentPath;
  }

  return files[0]?.path ?? null;
}

export function formatWorkspaceFileStatus(
  status: WorkspaceStatusFile["status"],
): string {
  switch (status) {
    case "added": {
      return "Added";
    }
    case "deleted": {
      return "Deleted";
    }
    case "modified": {
      return "Modified";
    }
    case "renamed": {
      return "Renamed";
    }
    case "untracked": {
      return "Untracked";
    }
  }
}

export function mapWorkspaceFilesToDiffItems(
  files: WorkspaceStatusFile[],
): SessionDiffFileItem[] {
  return files.map((file) => ({
    path: file.path,
    fileName: getPathFileName(file.path),
    directory: getPathDirectory(file.path),
    status: file.status,
    statusLabel: formatWorkspaceFileStatus(file.status),
  }));
}

export function buildSessionDiffEmptyStateMessage(
  isGitRepo: boolean,
  files: WorkspaceStatusFile[],
): string | null {
  if (!isGitRepo) {
    return "No git workspace available.";
  }

  if (files.length === 0) {
    return "No changed files in this workspace.";
  }

  return null;
}

export function buildSessionPreviewMessage(
  preview: WorkspaceFileContent | null,
): string | null {
  if (!preview) {
    return "Loading preview…";
  }

  if (!preview.exists) {
    return "File is no longer available.";
  }

  if (preview.isBinary) {
    return "Preview unavailable for this file type.";
  }

  if (preview.tooLarge) {
    return "Preview too large to display.";
  }

  return null;
}

function getPathFileName(path: string): string {
  const segments = path.split("/").filter(Boolean);
  return segments.at(-1) ?? path;
}

function getPathDirectory(path: string): string {
  const segments = path.split("/").filter(Boolean);

  if (segments.length <= 1) {
    return ".";
  }

  return segments.slice(0, -1).join("/");
}
