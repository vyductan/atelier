import { describe, expect, it } from "vitest";

import { parseClaudeScheduledTaskSkillFile } from "./scheduled-task-import";

describe("scheduledTaskImport", () => {
  it("parses a Claude scheduled task SKILL.md into an Atelier-native import draft", () => {
    const parsed = parseClaudeScheduledTaskSkillFile({
      taskDirName: "daily-review",
      workspacePath: "/tmp/workspace",
      skillMarkdown:
        "---\nname: daily-review\ndescription: Review today's commits\n---\nReview today's commits and summarize them.",
    });

    expect(parsed).toMatchObject({
      name: "daily-review",
      description: "Review today's commits",
      workspacePath: "/tmp/workspace",
      importSource: "claude-desktop",
      sourceTaskDirName: "daily-review",
      prompt: "Review today's commits and summarize them.",
    });
  });

  it("falls back to the task directory name when frontmatter omits a name", () => {
    const parsed = parseClaudeScheduledTaskSkillFile({
      taskDirName: "weekly-cleanup",
      workspacePath: "/tmp/workspace",
      skillMarkdown: "Review the workspace and remove stale branches.",
    });

    expect(parsed).toMatchObject({
      name: "weekly-cleanup",
      description: "",
      prompt: "Review the workspace and remove stale branches.",
      importSource: "claude-desktop",
      sourceTaskDirName: "weekly-cleanup",
    });
  });

  it("parses CRLF frontmatter in a Claude scheduled task SKILL.md", () => {
    const parsed = parseClaudeScheduledTaskSkillFile({
      taskDirName: "daily-review",
      workspacePath: "/tmp/workspace",
      skillMarkdown:
        "---\r\nname: daily-review\r\ndescription: Review today's commits\r\n---\r\nReview today's commits and summarize them.",
    });

    expect(parsed).toMatchObject({
      name: "daily-review",
      description: "Review today's commits",
      workspacePath: "/tmp/workspace",
      importSource: "claude-desktop",
      sourceTaskDirName: "daily-review",
      prompt: "Review today's commits and summarize them.",
    });
  });

  it("preserves leading whitespace and indentation in the prompt body", () => {
    const parsed = parseClaudeScheduledTaskSkillFile({
      taskDirName: "indented-task",
      workspacePath: "/tmp/workspace",
      skillMarkdown:
        "---\nname: indented-task\ndescription: Preserve formatting\n---\n\n    Keep this indentation.\n  Keep this leading space.\n",
    });

    expect(parsed.prompt).toBe(
      "\n    Keep this indentation.\n  Keep this leading space.\n",
    );
  });
});
