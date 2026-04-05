import type { ScheduledTaskImportDraft } from "./scheduled-tasks";

export function parseClaudeScheduledTaskSkillFile(input: {
  taskDirName: string;
  workspacePath: string;
  skillMarkdown: string;
}): ScheduledTaskImportDraft {
  const normalizedMarkdown = input.skillMarkdown.replace(/\r\n/g, "\n");
  const [, frontmatter = "", body = ""] =
    normalizedMarkdown.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/) ?? [
      "",
      "",
      normalizedMarkdown,
    ];

  const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
  const descriptionMatch = frontmatter.match(/^description:\s*(.+)$/m);

  return {
    name: nameMatch?.[1]?.trim() ?? input.taskDirName,
    description: descriptionMatch?.[1]?.trim() ?? "",
    workspacePath: input.workspacePath,
    prompt: body,
    importSource: "claude-desktop",
    sourceTaskDirName: input.taskDirName,
  };
}
