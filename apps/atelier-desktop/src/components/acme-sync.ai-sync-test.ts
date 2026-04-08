import assert from "node:assert/strict";

import type { SyncPreviewResult } from "../lib/types.ts";
import {
  buildPatchAiSyncPrompt,
  buildRsyncAiSyncPrompt,
} from "./acme-sync-ai-sync-state.ts";

const okPreview: SyncPreviewResult = {
  files: [{ path: "components/button.tsx", changeType: "modified" }],
  summary: { added: 0, modified: 1, deleted: 0 },
};

assert.throws(() => {
  buildRsyncAiSyncPrompt({
    mainPath: "/repo/main",
    projectPath: "/repo/project-a",
    pushPreview: okPreview,
  });
});

assert.throws(() => {
  buildRsyncAiSyncPrompt({
    mainPath: "/repo/main",
    projectPath: "/repo/project-a",
    pullPreview: okPreview,
  });
});

const complete = buildRsyncAiSyncPrompt({
  mainPath: "/repo/main",
  projectPath: "/repo/project-a",
  pushPreview: okPreview,
  pullPreview: okPreview,
});
assert.match(complete.command, /^cd /);
assert.doesNotMatch(complete.prompt, /Unknown \(preview unavailable\)/);
assert.doesNotMatch(complete.prompt, /Primary workspace \(Main\)/);
assert.match(complete.prompt, /Primary workspace:/);
assert.match(complete.prompt, /Push \(project -> primary\)/);
assert.match(complete.prompt, /Pull \(primary -> project\)/);

const patch = buildPatchAiSyncPrompt({
  mainPath: "/repo/main",
  projectPath: "/repo/project-c",
  pushPreview: okPreview,
  pullPreview: okPreview,
});
assert.match(patch.prompt, /Sync engine in app: git patch series \+ git am --3way/);
assert.doesNotMatch(patch.prompt, /one-way rsync/);

console.log("ai sync prompt checks passed");
