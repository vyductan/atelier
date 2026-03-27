import { invoke } from "@tauri-apps/api/core";

export interface WorkspaceStatusFile {
  path: string;
  status: "modified" | "added" | "deleted" | "renamed" | "untracked";
}

export interface WorkspaceStatus {
  isGitRepo: boolean;
  branch: string | null;
  worktreeLabel: string | null;
  totalChanged: number;
  changedFiles: WorkspaceStatusFile[];
}

export interface WorkspaceDiff {
  isGitRepo: boolean;
  filePath: string | null;
  status: WorkspaceStatusFile["status"] | null;
  unifiedDiff: string;
}

export interface WorkspaceFileContent {
  filePath: string;
  content: string;
  exists: boolean;
  isBinary: boolean;
  tooLarge: boolean;
}

export async function getWorkspaceStatus(
  projectPath: string,
): Promise<WorkspaceStatus> {
  return invoke<WorkspaceStatus>("get_workspace_status", { projectPath });
}

export async function getWorkspaceDiff(
  projectPath: string,
  filePath: string,
): Promise<WorkspaceDiff> {
  return invoke<WorkspaceDiff>("get_workspace_diff", { projectPath, filePath });
}

export async function getWorkspaceFileContent(
  projectPath: string,
  filePath: string,
): Promise<WorkspaceFileContent> {
  return invoke<WorkspaceFileContent>("get_workspace_file_content", {
    projectPath,
    filePath,
  });
}
