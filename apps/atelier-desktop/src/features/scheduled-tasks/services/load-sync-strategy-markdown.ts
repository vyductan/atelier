import { getWorkspaceFileContent } from "~/lib/workspace";

import { parseSyncStrategyMarkdown } from "../domain/scheduled-task-sync-strategy";

export async function loadSyncStrategyMarkdown(
  mainPath: string,
): Promise<string | null> {
  const strategyFiles = ["SYNC_STRATEGY.md", "SYNC_STRAITEGY.md"] as const;

  for (const fileName of strategyFiles) {
    const strategyFile = await getWorkspaceFileContent(mainPath, fileName);

    if (!strategyFile.exists || strategyFile.isBinary || strategyFile.tooLarge) {
      continue;
    }

    const strategyDraft = parseSyncStrategyMarkdown({
      workspacePath: mainPath,
      strategyMarkdown: strategyFile.content,
    });

    return strategyDraft.prompt;
  }

  return null;
}
