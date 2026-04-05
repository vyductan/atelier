import type {
  SyncPreviewResult,
  SyncProfile,
  SyncStatusResult,
} from "../lib/types.ts";
import { getSubtreeHistoryFallbackMessage } from "./acme-sync-wording.ts";

export type AiSyncMode = "rsync" | "subtree" | "patch";

const formatPreviewSummary = (summary?: SyncPreviewResult["summary"]) =>
  summary
    ? `Added ${summary.added}, Modified ${summary.modified}, Deleted ${summary.deleted}`
    : "Unknown (preview unavailable).";

export const resolveAiSyncPreview = (
  pushPreview?: SyncPreviewResult,
  pullPreview?: SyncPreviewResult,
) => {
  if (!pushPreview || !pullPreview) {
    throw new Error(
      "AI Sync requires both push and pull previews. Refresh preview and try again.",
    );
  }

  return { pushPreview, pullPreview };
};

const buildBidirectionalAiSyncPrompt = ({
  mainPath,
  projectPath,
  pushPreview,
  pullPreview,
  engineLabel,
}: {
  mainPath: string;
  projectPath: string;
  pushPreview?: SyncPreviewResult;
  pullPreview?: SyncPreviewResult;
  engineLabel: string;
}) => {
  const resolved = resolveAiSyncPreview(pushPreview, pullPreview);

  const prompt = `You are helping me sync shared @acme code between two folders in a monorepo.

Context:
- Primary workspace: ${mainPath}
- Target project: ${projectPath}
- Scope: @acme/
- Sync engine in app: ${engineLabel}

Current preview:
- Push (project -> primary): ${formatPreviewSummary(resolved.pushPreview.summary)}
- Pull (primary -> project): ${formatPreviewSummary(resolved.pullPreview.summary)}`;

  return {
    command: `cd "${mainPath}"`,
    prompt,
  };
};

export const buildRsyncAiSyncPrompt = ({
  mainPath,
  projectPath,
  pushPreview,
  pullPreview,
}: {
  mainPath: string;
  projectPath: string;
  pushPreview?: SyncPreviewResult;
  pullPreview?: SyncPreviewResult;
}) =>
  buildBidirectionalAiSyncPrompt({
    mainPath,
    projectPath,
    pushPreview,
    pullPreview,
    engineLabel: "one-way rsync (not git merge)",
  });

export const buildPatchAiSyncPrompt = ({
  mainPath,
  projectPath,
  pushPreview,
  pullPreview,
}: {
  mainPath: string;
  projectPath: string;
  pushPreview?: SyncPreviewResult;
  pullPreview?: SyncPreviewResult;
}) =>
  buildBidirectionalAiSyncPrompt({
    mainPath,
    projectPath,
    pushPreview,
    pullPreview,
    engineLabel: "git patch series + git am --3way",
  });

export const getAiSyncModalDescription = (mode: AiSyncMode) =>
  mode === "subtree"
    ? "Copy the command + prompt below, then paste them into Claude Code / Codex to review the subtree history preview."
    : "Copy the command + prompt below, then paste them into Claude Code / Codex to review both push and pull previews.";

export const getAiSyncStepLabels = (mode: AiSyncMode) => ({
  command: "1) CD command",
  prompt:
    mode === "subtree"
      ? "2) Prompt for AI review of subtree history"
      : "2) Prompt for AI review of push + pull previews",
});

export const buildSubtreeAiSyncPrompt = ({
  mainPath,
  profile,
  status,
}: {
  mainPath: string;
  profile: SyncProfile;
  status: SyncStatusResult;
}) => {
  if (status.mode !== "subtree") {
    throw new Error("Subtree AI Sync requires subtree status preview.");
  }

  if (!profile.subtree) {
    throw new Error("Subtree AI Sync requires subtree settings.");
  }

  const prompt = `You are helping me sync shared @acme code between two folders in a monorepo.

Context:
- Primary workspace: ${mainPath}
- Target project: ${profile.projectPath}
- Scope: @acme/
- Sync engine in app: git subtree pull
- Remote: ${profile.subtree.remote}
- Branch: ${profile.subtree.branch}
- Prefix: ${profile.subtree.prefix}
- Squash mode: ${profile.subtree.squash ? "enabled" : "disabled"}

Subtree preview status: ${status.state}
- Behind commits: ${status.behindCount}
- Ahead commits: ${status.aheadCount}
- Working tree dirty: ${status.dirty ? "yes" : "no"}
- Summary: ${status.message ?? getSubtreeHistoryFallbackMessage()}

AI suggestions are advisory only. I will still verify the sync direction and changed files before applying subtree changes.`;

  return {
    command: `cd "${profile.subtree.repoRoot}"`,
    prompt,
  };
};
