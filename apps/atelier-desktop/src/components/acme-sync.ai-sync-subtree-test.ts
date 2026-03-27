import assert from "node:assert/strict";

import type { SyncProfile, SyncStatusResult } from "../lib/types.ts";
import { buildSubtreeAiSyncPrompt } from "./acme-sync-ai-sync-state.ts";

const subtreeProfile: SyncProfile = {
  id: "subtree-1",
  projectPath: "/repo/project-b",
  primaryPath: "/repo/main",
  mode: "subtree",
  subtree: {
    repoRoot: "/repo/project-b",
    prefix: "@acme",
    remote: "origin",
    branch: "main",
    squash: true,
  },
};

const subtreeStatus: SyncStatusResult = {
  mode: "subtree",
  state: "behind",
  aheadCount: 0,
  behindCount: 2,
  dirty: false,
  message: "2 subtree commits available from primary.",
};

const result = buildSubtreeAiSyncPrompt({
  mainPath: "/repo/main",
  profile: subtreeProfile,
  status: subtreeStatus,
});

assert.equal(result.command, 'cd "/repo/project-b"');
assert.match(result.prompt, /Sync engine in app: git subtree pull/);
assert.match(result.prompt, /Squash mode: enabled/);
assert.match(result.prompt, /Subtree preview status: behind/);
assert.match(result.prompt, /Behind commits: 2/);
assert.match(result.prompt, /Ahead commits: 0/);
assert.match(result.prompt, /Working tree dirty: no/);
assert.match(result.prompt, /AI suggestions are advisory only/);
assert.doesNotMatch(result.prompt, /Push \(project -> primary\)/);
assert.doesNotMatch(result.prompt, /Pull \(primary -> project\)/);
assert.doesNotMatch(result.prompt, /Current/);
assert.doesNotMatch(result.prompt, /Incoming/);
assert.doesNotMatch(result.prompt, /Both/);

const nonSquashResult = buildSubtreeAiSyncPrompt({
  mainPath: "/repo/main",
  profile: {
    ...subtreeProfile,
    subtree: {
      repoRoot: subtreeProfile.subtree?.repoRoot ?? "/repo/project-b",
      prefix: subtreeProfile.subtree?.prefix ?? "@acme",
      remote: subtreeProfile.subtree?.remote ?? "origin",
      branch: subtreeProfile.subtree?.branch ?? "main",
      squash: false,
    },
  },
  status: subtreeStatus,
});

assert.match(nonSquashResult.prompt, /Squash mode: disabled/);

assert.throws(
  () =>
    buildSubtreeAiSyncPrompt({
      mainPath: "/repo/main",
      profile: {
        ...subtreeProfile,
        subtree: undefined,
      },
      status: subtreeStatus,
    }),
  /Subtree AI Sync requires subtree settings/,
);

console.log("ai sync subtree prompt checks passed");
