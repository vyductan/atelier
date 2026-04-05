import { describe, expect, it } from "vitest";

import {
  buildScheduledSyncTaskDraft,
  parseSyncStrategyMarkdown,
} from "./scheduled-task-sync-strategy";

describe("scheduledTaskSyncStrategy", () => {
  it("builds an rsync-focused prompt draft without subtree-only instructions", () => {
    const draft = buildScheduledSyncTaskDraft({
      mainPath: "/repo/main/@acme",
      profile: {
        id: "rsync-1",
        projectPath: "/repo/project-a",
        primaryPath: "/repo/main/@acme",
        mode: "rsync",
      },
    });

    expect(draft.prompt).toContain("Sync mode: rsync");
    expect(draft.prompt).toContain("Review the file-level changes before mutating anything.");
    expect(draft.prompt).not.toContain("Subtree settings:");
    expect(draft.prompt).not.toContain("git subtree pull");
  });

  it("merges literal strategy markdown into an rsync-focused prompt draft", () => {
    const strategyMarkdown = `Create crob job (claude/openclaw)

- run daily
- check github/gitlab repo
- if any commit from vyductan-react -> in project using "@acme" switch to "ui" -> merge main branch -> copy code -> review -> check pnpm typecheck/lint/format -> commit & push -> create PR
- if any commit from project using "@acme" -> in vyductan-react switch to "{project-name}" branch -> merge "main" branch -> copy code -> review -> check pnpm typecheck/lint/format -> commit & push -> create PR
`;

    const draft = buildScheduledSyncTaskDraft({
      mainPath: "/repo/main/@acme",
      profile: {
        id: "rsync-1",
        projectPath: "/repo/project-a",
        primaryPath: "/repo/main/@acme",
        mode: "rsync",
      },
      strategyMarkdown,
    });

    expect(draft.prompt).toContain("Sync mode: rsync");
    expect(draft.prompt).toContain("Review the file-level changes before mutating anything.");
    expect(draft.prompt).toContain("Strategy markdown:");
    expect(draft.prompt).toContain("Create crob job (claude/openclaw)");
    expect(draft.prompt).toContain("- run daily");
    expect(draft.prompt).toContain("check github/gitlab repo");
    expect(draft.prompt).not.toContain("Subtree settings:");
  });

  it("builds a patch-focused prompt draft with git patch instructions", () => {
    const draft = buildScheduledSyncTaskDraft({
      mainPath: "/repo/main/@acme",
      profile: {
        id: "patch-1",
        projectPath: "/repo/project-c",
        primaryPath: "/repo/main/@acme",
        mode: "patch",
      },
    });

    expect(draft.prompt).toContain("Sync mode: patch");
    expect(draft.prompt).toContain("Review the commit patch series before applying anything.");
    expect(draft.prompt).toContain("git format-patch");
    expect(draft.prompt).toContain("git am --3way");
    expect(draft.prompt).not.toContain("Subtree settings:");
  });

  it("builds a subtree-focused prompt draft with git preflight instructions", () => {
    const draft = buildScheduledSyncTaskDraft({
      mainPath: "/repo/main/@acme",
      profile: {
        id: "subtree-1",
        projectPath: "/repo/project-b/.worktrees/feature-sync",
        primaryPath: "/repo/main/@acme",
        mode: "subtree",
        subtree: {
          repoRoot: "/repo/project-b",
          prefix: "@acme",
          remote: "origin",
          branch: "main",
          squash: true,
        },
      },
    });

    expect(draft).toMatchObject({
      name: "@acme sync project-b",
      description:
        "Daily bidirectional @acme sync for project-b with review and PR creation.",
      workspacePath: "/repo/project-b",
      cron: "0 9 * * *",
      frequency: "daily",
      worktreeEnabled: true,
    });
    expect(draft.prompt).toContain("Primary workspace: /repo/main/@acme");
    expect(draft.prompt).toContain("Target project: /repo/project-b/.worktrees/feature-sync");
    expect(draft.prompt).toContain("Repo root: /repo/project-b");
    expect(draft.prompt).toContain("Sync mode: subtree");
    expect(draft.prompt).toContain("Validate git state before mutating subtree history.");
    expect(draft.prompt).toContain("Prefix: @acme");
    expect(draft.prompt).toContain("Remote: origin");
    expect(draft.prompt).toContain("Branch: main");
    expect(draft.prompt).toContain("run pnpm typecheck/lint/format");
  });

  it("merges literal strategy markdown into a subtree-focused prompt draft", () => {
    const strategyMarkdown = `Create crob job (claude/openclaw)

- run daily
- check github/gitlab repo
- if any commit from vyductan-react -> in project using "@acme" switch to "ui" -> merge main branch -> copy code -> review -> check pnpm typecheck/lint/format -> commit & push -> create PR
- if any commit from project using "@acme" -> in vyductan-react switch to "{project-name}" branch -> merge "main" branch -> copy code -> review -> check pnpm typecheck/lint/format -> commit & push -> create PR
`;

    const draft = buildScheduledSyncTaskDraft({
      mainPath: "/repo/main/@acme",
      profile: {
        id: "subtree-1",
        projectPath: "/repo/project-b/.worktrees/feature-sync",
        primaryPath: "/repo/main/@acme",
        mode: "subtree",
        subtree: {
          repoRoot: "/repo/project-b",
          prefix: "@acme",
          remote: "origin",
          branch: "main",
          squash: true,
        },
      },
      strategyMarkdown,
    });

    expect(draft.prompt).toContain("Sync mode: subtree");
    expect(draft.prompt).toContain("Subtree settings:");
    expect(draft.prompt).toContain("Validate git state before mutating subtree history.");
    expect(draft.prompt).toContain("Strategy markdown:");
    expect(draft.prompt).toContain("Create crob job (claude/openclaw)");
    expect(draft.prompt).toContain("check github/gitlab repo");
  });

  it("builds a daily worktree-enabled sync task draft from strategy markdown", () => {
    const draft = parseSyncStrategyMarkdown({
      workspacePath: "/Users/vyductan/Developer/vyductan/vyductan-react",
      strategyMarkdown: `Create crob job (claude/openclaw)

- run daily
- check github/gitlab repo
- if any commit from vyductan-react -> in project using "@acme" switch to "ui" -> merge main branch -> copy code -> review -> check pnpm typecheck/lint/format -> commit & push -> create PR
- if any commit from project using "@acme" -> in vyductan-react switch to "{project-name}" branch -> merge "main" branch -> copy code -> review -> check pnpm typecheck/lint/format -> commit & push -> create PR
`,
    });

    expect(draft).toMatchObject({
      name: "@acme sync daily",
      description: "Daily bidirectional @acme sync with review and PR creation.",
      workspacePath: "/Users/vyductan/Developer/vyductan/vyductan-react",
      cron: "0 9 * * *",
      frequency: "daily",
      worktreeEnabled: true,
    });
    expect(draft.prompt).toContain("check github/gitlab repo");
    expect(draft.prompt).toContain("pnpm typecheck/lint/format");
    expect(draft.prompt).toContain("create PR");
  });

  it("rejects strategy markdown that does not declare a daily schedule", () => {
    expect(() =>
      parseSyncStrategyMarkdown({
        workspacePath: "/Users/vyductan/Developer/vyductan/vyductan-react",
        strategyMarkdown: `Create crob job (claude/openclaw)\n\n- run weekly\n- create PR\n`,
      }),
    ).toThrow("Sync strategy must explicitly include 'run daily' for the V1 preset");
  });
});
