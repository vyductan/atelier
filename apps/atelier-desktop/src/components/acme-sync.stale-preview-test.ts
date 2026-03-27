import assert from "node:assert/strict";

import type { SyncPreviewResult } from "../lib/types";
import { shouldReuseAiSyncCachedPreview } from "./acme-sync-ai-preview-state";

const preview: SyncPreviewResult = {
  files: [{ path: "components/button.tsx", changeType: "modified" }],
  summary: { added: 0, modified: 1, deleted: 0 },
};

assert.equal(
  shouldReuseAiSyncCachedPreview({
    projectPath: "/repo/project-a",
    prefetchError: "latest preview refresh failed",
    pushPreview: preview,
    pullPreview: preview,
  }),
  false,
);

assert.equal(
  shouldReuseAiSyncCachedPreview({
    projectPath: "/repo/project-a",
    prefetchError: null,
    pushPreview: preview,
    pullPreview: preview,
  }),
  true,
);

console.log("stale preview checks passed");
