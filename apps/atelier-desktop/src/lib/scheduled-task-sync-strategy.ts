import type { ScheduledTaskFormInput } from "../components/scheduled-task-form";
import type { SyncProfile } from "./types";

function getProjectLabel(projectPath: string): string {
  const segments = projectPath.split("/").filter(Boolean);
  const worktreeContainerIndex = segments.findIndex(
    (segment) => segment === ".worktrees" || segment === "worktrees",
  );

  if (worktreeContainerIndex > 0) {
    return segments[worktreeContainerIndex - 1] ?? projectPath;
  }

  const lastSegment = segments.at(-1) ?? projectPath;
  const previousSegment = segments.at(-2);

  if (lastSegment === "worktree" && previousSegment) {
    return previousSegment;
  }

  return lastSegment;
}

function normalizeStrategyMarkdown(strategyMarkdown?: string | null): string | null {
  const normalizedMarkdown = strategyMarkdown?.replace(/\r\n/g, "\n").trim();
  return normalizedMarkdown ? normalizedMarkdown : null;
}

function appendStrategyMarkdown(basePrompt: string, strategyMarkdown?: string | null): string {
  const normalizedMarkdown = normalizeStrategyMarkdown(strategyMarkdown);

  if (!normalizedMarkdown) {
    return basePrompt;
  }

  return `${basePrompt}\n\nStrategy markdown:\n${normalizedMarkdown}`;
}

export function buildScheduledSyncTaskDraft(input: {
  mainPath: string;
  profile: SyncProfile;
  strategyMarkdown?: string | null;
}): ScheduledTaskFormInput {
  const projectLabel = getProjectLabel(input.profile.projectPath);
  const workspacePath =
    input.profile.mode === "subtree" && input.profile.subtree
      ? input.profile.subtree.repoRoot
      : input.profile.projectPath;

  const prompt = appendStrategyMarkdown(
    input.profile.mode === "subtree" && input.profile.subtree
      ? `Run the daily @acme sync workflow.\n\nContext:\n- Primary workspace: ${input.mainPath}\n- Target project: ${input.profile.projectPath}\n- Sync mode: subtree\n\nSubtree settings:\n- Repo root: ${input.profile.subtree.repoRoot}\n- Prefix: ${input.profile.subtree.prefix}\n- Remote: ${input.profile.subtree.remote}\n- Branch: ${input.profile.subtree.branch}\n- Squash: ${input.profile.subtree.squash ? "enabled" : "disabled"}\n\nWorkflow:\n1. Check the relevant GitHub/GitLab repositories and local branches for new changes on both sides.\n2. Validate git state before mutating subtree history. Stop immediately if the working tree is dirty, the expected branch is not checked out, or subtree configuration does not match the configured prefix/remote/branch.\n3. Review the intended subtree direction carefully before applying changes.\n4. If the primary workspace changed, update the target project's @acme subtree, review the result, run pnpm typecheck/lint/format, then commit, push, and create a PR.\n5. If the target project changed, update the source side, review the result, run pnpm typecheck/lint/format, then commit, push, and create a PR.\n6. Use worktree isolation for git mutations whenever possible.`
      : input.profile.mode === "patch"
        ? `Run the daily @acme sync workflow.\n\nContext:\n- Primary workspace: ${input.mainPath}\n- Target project: ${input.profile.projectPath}\n- Sync mode: patch\n\nWorkflow:\n1. Check the relevant GitHub/GitLab repositories and local branches for new changes on both sides.\n2. Review the commit patch series before applying anything.\n3. If the primary workspace changed, generate a git patch series with git format-patch, review it, apply it into the target project with git am --3way, then run pnpm typecheck/lint/format, commit, push, and create a PR.\n4. If the target project changed, generate a git patch series from the project side, review it, apply it into the source side with git am --3way, then run pnpm typecheck/lint/format, commit, push, and create a PR.\n5. Use worktree isolation for git mutations whenever possible.\n6. Stop and report clearly if the working tree is dirty, branch expectations do not match, or the patch direction is ambiguous.`
        : `Run the daily @acme sync workflow.\n\nContext:\n- Primary workspace: ${input.mainPath}\n- Target project: ${input.profile.projectPath}\n- Sync mode: rsync\n\nWorkflow:\n1. Check the relevant GitHub/GitLab repositories and local branches for new changes on both sides.\n2. Review the file-level changes before mutating anything.\n3. If the primary workspace changed, update the target project's @acme copy, review the result, run pnpm typecheck/lint/format, then commit, push, and create a PR.\n4. If the target project changed, update the source side, review the result, run pnpm typecheck/lint/format, then commit, push, and create a PR.\n5. Use worktree isolation for git mutations whenever possible.\n6. Stop and report clearly if the working tree is dirty, branch expectations do not match, or the sync direction is ambiguous.`,
    input.strategyMarkdown,
  );

  return {
    name: `@acme sync ${projectLabel}`,
    description: `Daily bidirectional @acme sync for ${projectLabel} with review and PR creation.`,
    workspacePath,
    prompt,
    frequency: "daily",
    cron: "0 9 * * *",
    worktreeEnabled: true,
  };
}

export function parseSyncStrategyMarkdown(input: {
  workspacePath: string;
  strategyMarkdown: string;
}): ScheduledTaskFormInput {
  const normalizedMarkdown = normalizeStrategyMarkdown(input.strategyMarkdown);

  if (!normalizedMarkdown) {
    throw new Error("Sync strategy markdown cannot be empty");
  }

  if (!/^-\s*run daily\s*$/im.test(normalizedMarkdown)) {
    throw new Error(
      "Sync strategy must explicitly include 'run daily' for the V1 preset",
    );
  }

  return {
    name: "@acme sync daily",
    description: "Daily bidirectional @acme sync with review and PR creation.",
    workspacePath: input.workspacePath,
    prompt: normalizedMarkdown,
    frequency: "daily",
    cron: "0 9 * * *",
    worktreeEnabled: true,
  };
}
