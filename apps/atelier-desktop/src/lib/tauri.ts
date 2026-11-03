import { invoke } from "@tauri-apps/api/core";

import type { SkillUsageReport } from "./skills-client";

import type {
  ClaudeContextWindowValue,
  ClaudeModelOptions,
  PrimaryRemoteStatus,
  ProjectInfo,
  RepoMetadata,
  RsyncConflictExecutionRequest,
  SessionEntry,
  SessionIndex,
  SyncChangeType,
  SyncConflictDetail,
  SyncDirection,
  SyncPreviewResult,
  SyncProfile,
  SyncStatusResult,
} from "./types";

// Check if we're running in Tauri context
const isTauri = () => {
  return (
    globalThis.window !== undefined &&
    "__TAURI_INTERNALS__" in globalThis.window
  );
};

// Helper to ensure Tauri context
function ensureTauri() {
  if (!isTauri()) {
    throw new Error(
      "Not running in Tauri context. Please run 'pnpm atelier:dev' instead of 'pnpm dev'",
    );
  }
}

// Tauri command wrappers with type safety

export async function updateWorkspacePath(
  escapedPath: string,
  newPath: string,
): Promise<ProjectInfo[]> {
  ensureTauri();
  return await invoke<ProjectInfo[]>("update_workspace_path", {
    escapedPath,
    newPath,
  });
}

export async function listProjects(): Promise<ProjectInfo[]> {
  ensureTauri();
  return await invoke<ProjectInfo[]>("list_projects");
}

export interface GetProjectSessionsOptions {
  includeSidechains?: boolean;
  includeUnindexed?: boolean;
}

export async function getProjectSessions(
  escapedPath: string,
  options?: GetProjectSessionsOptions,
): Promise<SessionIndex> {
  ensureTauri();
  return await invoke<SessionIndex>("get_project_sessions", {
    escapedPath,
    includeSidechains: options?.includeSidechains,
    includeUnindexed: options?.includeUnindexed,
  });
}

export async function deleteSession(
  sessionId: string,
  escapedPath: string,
  permanent: boolean,
): Promise<void> {
  ensureTauri();
  return await invoke<void>("delete_session", {
    sessionId,
    escapedPath,
    permanent,
  });
}

export interface UpdateSessionModelMetadataInput {
  escapedPath: string;
  sessionId: string;
  claudeModel: string | null;
  claudeModelOptions: ClaudeModelOptions | null;
  claudeContextWindow: ClaudeContextWindowValue | null;
}

export async function updateSessionModelMetadata(
  input: UpdateSessionModelMetadataInput,
): Promise<void> {
  ensureTauri();
  return await invoke<void>("update_session_model_metadata", {
    escapedPath: input.escapedPath,
    sessionId: input.sessionId,
    claudeModel: input.claudeModel,
    claudeModelOptions: input.claudeModelOptions,
    claudeContextWindow: input.claudeContextWindow,
  });
}

export async function searchSessions(
  escapedPath: string,
  query: string,
): Promise<SessionEntry[]> {
  ensureTauri();
  return await invoke<SessionEntry[]>("search_sessions", {
    escapedPath,
    query,
  });
}

export async function moveToTrash(filePath: string): Promise<void> {
  ensureTauri();
  return await invoke<void>("move_to_trash", { filePath });
}

export async function ensureDirectory(path: string): Promise<void> {
  ensureTauri();
  return await invoke<void>("ensure_directory", { path });
}

export async function readSessionMessages(
  sessionPath: string,
): Promise<
  Array<{
    role: string;
    content: unknown;
    isMeta?: boolean;
    isCompactSummary?: boolean;
    isVisibleInTranscriptOnly?: boolean;
  }>
> {
  ensureTauri();
  return await invoke("read_session_messages", { sessionPath });
}

export async function previewSyncChanges(
  src: string,
  dest: string,
  direction: SyncDirection,
): Promise<SyncPreviewResult> {
  ensureTauri();
  return await invoke<SyncPreviewResult>("preview_sync_changes", {
    src,
    dest,
    direction,
  });
}

export async function previewSyncFileDiff(
  src: string,
  dest: string,
  relativePath: string,
  changeType: SyncChangeType,
): Promise<string> {
  ensureTauri();
  return await invoke<string>("preview_sync_file_diff", {
    src,
    dest,
    relativePath,
    changeType,
  });
}

export async function getSyncConflictDetail(
  src: string,
  dest: string,
  relativePath: string,
  direction: SyncDirection,
): Promise<SyncConflictDetail> {
  ensureTauri();
  return await invoke<SyncConflictDetail>("get_sync_conflict_detail", {
    src,
    dest,
    relativePath,
    direction,
  });
}

export async function executeRsyncSync(
  src: string,
  dest: string,
): Promise<void> {
  ensureTauri();
  return await invoke<void>("execute_rsync_sync", { src, dest });
}

export async function executeRsyncConflictResolutions(
  request: RsyncConflictExecutionRequest,
): Promise<void> {
  ensureTauri();
  return await invoke<void>("execute_rsync_conflict_resolutions", { request });
}

export async function deleteSyncFile(
  root: string,
  relativePath: string,
): Promise<void> {
  ensureTauri();
  return await invoke<void>("delete_sync_file", {
    root,
    relativePath,
  });
}

export async function readGlobalClaudeConfig(): Promise<string> {
  ensureTauri();
  return await invoke<string>("read_global_claude_config");
}

export async function writeGlobalClaudeConfig(
  contents: string,
): Promise<void> {
  ensureTauri();
  return await invoke<void>("write_global_claude_config", { contents });
}

export async function openGlobalClaudeConfig(editor: string): Promise<void> {
  ensureTauri();
  return await invoke<void>("open_global_claude_config", { editor });
}

export async function syncClaudePermissionsToCodex(
  allow: string[],
  deny: string[],
): Promise<void> {
  ensureTauri();
  return await invoke<void>("sync_claude_permissions_to_codex", { allow, deny });
}

export async function openGlobalCodexConfig(editor: string): Promise<void> {
  ensureTauri();
  return await invoke<void>("open_global_codex_config", { editor });
}

export async function readTaskSnapshot(filePath: string): Promise<string> {
  ensureTauri();
  return await invoke<string>("read_task_snapshot", { filePath });
}

export async function writeTaskSnapshot(
  filePath: string,
  contents: string,
): Promise<void> {
  ensureTauri();
  return await invoke<void>("write_task_snapshot", { filePath, contents });
}

export async function getRsyncGitSafety(root: string): Promise<string[]> {
  ensureTauri();
  return await invoke<string[]>("get_rsync_git_safety", { root });
}

export async function getRepoMetadata(path: string): Promise<RepoMetadata> {
  ensureTauri();
  return await invoke<RepoMetadata>("get_repo_metadata", { path });
}

export async function getPrimaryRemoteStatus(
  path: string,
): Promise<PrimaryRemoteStatus> {
  ensureTauri();
  return await invoke<PrimaryRemoteStatus>("get_repo_remote_status", { path });
}

export async function getSyncStatus(
  profile: SyncProfile,
): Promise<SyncStatusResult> {
  ensureTauri();
  return await invoke<SyncStatusResult>("get_sync_status", { profile });
}

export async function executeSubtreeSync(
  profile: SyncProfile,
  direction: SyncDirection,
): Promise<void> {
  ensureTauri();
  return await invoke<void>("execute_subtree_sync", { profile, direction });
}

export async function executeSubtreeAdd(profile: SyncProfile): Promise<void> {
  ensureTauri();
  return await invoke<void>("execute_subtree_add", { profile });
}

export async function executeSyncAction(
  profile: SyncProfile,
  direction: SyncDirection,
  rsyncConflictRequest?: Omit<
    RsyncConflictExecutionRequest,
    "src" | "dest" | "direction"
  >,
): Promise<void> {
  ensureTauri();

  if (profile.mode === "subtree") {
    return await executeSubtreeSync(profile, direction);
  }

  if (!profile.primaryPath) {
    throw new Error("Rsync sync requires a primary path");
  }

  const src =
    direction === "to-primary" ? profile.projectPath : profile.primaryPath;
  const dest =
    direction === "to-primary" ? profile.primaryPath : profile.projectPath;

  if (rsyncConflictRequest) {
    return await executeRsyncConflictResolutions({
      src,
      dest,
      direction,
      fingerprint: rsyncConflictRequest.fingerprint,
      resolutions: rsyncConflictRequest.resolutions,
      fileActions: rsyncConflictRequest.fileActions,
    });
  }

  return await executeRsyncSync(src, dest);
}

export async function previewSubtreeSync(
  profile: SyncProfile,
  direction: SyncDirection,
): Promise<SyncStatusResult> {
  ensureTauri();
  return await invoke<SyncStatusResult>("preview_subtree_sync", {
    profile,
    direction,
  });
}

export async function renameSession(
  sessionPath: string,
  title: string,
): Promise<void> {
  ensureTauri();
  return await invoke<void>("rename_session", { sessionPath, title });
}

export async function getSessionCwd(
  sessionPath: string,
): Promise<string | null> {
  ensureTauri();
  return await invoke<string | null>("get_session_cwd", { sessionPath });
}

export async function exportSession(
  sessionPath: string,
  outputPath: string,
): Promise<string> {
  ensureTauri();
  return await invoke<string>("export_session", {
    sessionPath,
    outputPath,
  });
}

export async function exportSessionToCodex(
  sessionPath: string,
): Promise<string> {
  ensureTauri();
  return await invoke<string>("export_session_to_codex", { sessionPath });
}

export async function generateSessionHandoff(
  sessionPath: string,
  outputPath: string,
): Promise<string> {
  ensureTauri();
  return await invoke<string>("generate_session_handoff", {
    sessionPath,
    outputPath,
  });
}

export async function installSkill(skillSource: string): Promise<void> {
  ensureTauri();
  return await invoke<void>("install_skill", { skillSource });
}

export async function searchSkills(query: string, limit?: number): Promise<string> {
  ensureTauri();
  return await invoke<string>("search_skills", { query, limit });
}

export async function getInstalledSkills(): Promise<string> {
  ensureTauri();
  return await invoke<string>("get_installed_skills");
}

export async function uninstallSkill(skillName: string): Promise<void> {
  ensureTauri();
  return await invoke<void>("uninstall_skill", { skillName });
}

export async function enableSkillForAgent(skillSource: string, skillName: string, agentName: string): Promise<void> {
  ensureTauri();
  return await invoke<void>("enable_skill_for_agent", { skillSource, skillName, agentName });
}

export async function disableSkillForAgent(skillName: string, agentName: string): Promise<void> {
  ensureTauri();
  return await invoke<void>("disable_skill_for_agent", { skillName, agentName });
}

export async function disableSkill(skillName: string): Promise<void> {
  ensureTauri();
  return await invoke<void>("disable_skill", { skillName });
}

export async function enableSkill(skillName: string): Promise<void> {
  ensureTauri();
  return await invoke<void>("enable_skill", { skillName });
}

/** Mirrors `DisabledSkill` in src-tauri/src/features/skills/disable.rs. */
export interface DisabledSkill {
  name: string;
  path: string;
  source: string | null;
  installedAt: string | null;
  updatedAt: string | null;
}

export async function listDisabledSkills(): Promise<DisabledSkill[]> {
  ensureTauri();
  return await invoke<DisabledSkill[]>("list_disabled_skills");
}

/** Mirrors `AgentStates` in src-tauri/src/features/skills/agent_toggle.rs. */
export interface SkillAgentStates {
  agents: { id: string; name: string }[];
  /** skill → agent id → state; a missing agent has no entry for the skill. */
  skills: Record<string, Record<string, "on" | "off">>;
  parked: { name: string; path: string }[];
}

export async function getSkillAgentStates(): Promise<SkillAgentStates> {
  ensureTauri();
  return await invoke<SkillAgentStates>("get_skill_agent_states");
}

export async function setSkillForAgent(skillName: string, agentId: string, enabled: boolean): Promise<void> {
  ensureTauri();
  return await invoke<void>("set_skill_for_agent", { skillName, agentId, enabled });
}

export async function getDetectedAgents(): Promise<string[]> {
  ensureTauri();
  return await invoke<string[]>("get_detected_agents");
}

export async function getSkillUsage(): Promise<SkillUsageReport> {
  ensureTauri();
  return await invoke<SkillUsageReport>("get_skill_usage");
}
