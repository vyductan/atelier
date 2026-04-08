import type { ScheduledTaskImportDraft } from "../domain/scheduled-tasks";

function normalizeYamlScalar(value: string | undefined): string | undefined {
  const trimmedValue = value?.trim();

  if (!trimmedValue) {
    return trimmedValue;
  }

  if (
    (trimmedValue.startsWith('"') && trimmedValue.endsWith('"')) ||
    (trimmedValue.startsWith("'") && trimmedValue.endsWith("'"))
  ) {
    return trimmedValue.slice(1, -1);
  }

  return trimmedValue;
}

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
    name: normalizeYamlScalar(nameMatch?.[1]) ?? input.taskDirName,
    description: normalizeYamlScalar(descriptionMatch?.[1]) ?? "",
    workspacePath: input.workspacePath,
    prompt: body,
    importSource: "claude-desktop",
    sourceTaskDirName: input.taskDirName,
  };
}
