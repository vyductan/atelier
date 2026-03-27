import assert from "node:assert/strict";

import type { SyncPreviewResult, SyncStatusResult } from "../lib/types.ts";
import {
  getConfirmDeleteWarningMessage,
  getConfirmLoadingMessage,
  getConfirmModalDescription,
  getConfirmPreviewFallbackMessage,
  getConfirmSubtreeSummaryMessage,
  shouldReuseConfirmCachedPreview,
} from "./acme-sync-confirm-preview-state.ts";
import {
  buildPreviewConflictResolutionState,
  buildPreviewFileActionState,
  canUseResolution,
  getPreviewModalDescription,
  getUnresolvedConflictCount,
} from "./acme-sync-preview-modal-state.ts";

const preview: SyncPreviewResult = {
  files: [{ path: "components/button.tsx", changeType: "modified" }],
  summary: { added: 0, modified: 1, deleted: 0 },
};

const conflictPreview: SyncPreviewResult = {
  files: [
    { path: "components/button.tsx", changeType: "modified" },
    { path: "assets/logo.png", changeType: "modified" },
  ],
  summary: { added: 0, modified: 2, deleted: 0 },
  conflicts: [
    {
      path: "components/button.tsx",
      kind: "text",
      allowedResolutions: ["current", "incoming", "both"],
    },
    {
      path: "assets/logo.png",
      kind: "binary",
      allowedResolutions: ["current", "incoming"],
    },
  ],
  fingerprint: "preview-conflict-123",
};

const decisionPreview: SyncPreviewResult = {
  files: [{ path: "tokens/new.ts", changeType: "added" }],
  summary: { added: 1, modified: 0, deleted: 0 },
  decisions: [
    {
      path: "tokens/new.ts",
      kind: "added",
      allowedActions: ["keep", "delete"],
    },
  ],
  fingerprint: "preview-decision-123",
};

const subtreeStatus: SyncStatusResult = {
  mode: "subtree",
  state: "behind",
  aheadCount: 0,
  behindCount: 2,
  dirty: false,
  message: "2 subtree commits available from primary.",
};

assert.equal(
  shouldReuseConfirmCachedPreview({
    projectPath: "/repo/project-a",
    prefetchError: "latest preview refresh failed",
    preview,
    oppositePreview: preview,
  }),
  false,
);

assert.equal(
  shouldReuseConfirmCachedPreview({
    projectPath: "/repo/project-a",
    prefetchError: null,
    preview,
    oppositePreview: preview,
  }),
  true,
);

assert.equal(
  shouldReuseConfirmCachedPreview({
    projectPath: "/repo/project-b",
    prefetchError: null,
    profileMode: "subtree",
    subtreeStatus,
  }),
  true,
);

assert.equal(
  shouldReuseConfirmCachedPreview({
    projectPath: "/repo/project-b",
    prefetchError: null,
    profileMode: "rsync",
    subtreeStatus,
  }),
  false,
);

assert.equal(
  getConfirmModalDescription({
    action: "pull",
    mode: "subtree",
  }),
  "You are about to apply subtree commits from Primary into this project.",
);

assert.equal(
  getConfirmLoadingMessage("subtree"),
  "Loading subtree history preview...",
);

assert.equal(
  getConfirmPreviewFallbackMessage("subtree"),
  "No subtree history preview available yet. You can continue, or run Preview History first.",
);
assert.equal(
  getConfirmPreviewFallbackMessage("rsync"),
  "No preview data available yet for this action. You can continue, or run Preview first.",
);

assert.equal(
  getConfirmSubtreeSummaryMessage(subtreeStatus),
  "Subtree history preview • Behind: 2 commits • Ahead: 0 commits • Working tree clean",
);
assert.equal(
  getConfirmDeleteWarningMessage({ added: 0, modified: 1, deleted: 2 }),
  "Warning: this sync will delete 2 path(s) in the destination @acme tree.",
);
assert.equal(
  getConfirmDeleteWarningMessage({ added: 1, modified: 0, deleted: 0 }),
  null,
);

assert.deepEqual(buildPreviewConflictResolutionState(), {});
assert.equal(getUnresolvedConflictCount(conflictPreview, {}), 2);
assert.equal(
  getUnresolvedConflictCount(conflictPreview, {
    "components/button.tsx": "both",
  }),
  1,
);
const firstConflict = conflictPreview.conflicts?.[0];
const secondConflict = conflictPreview.conflicts?.[1];
assert.ok(firstConflict, "Expected first conflict to exist");
assert.ok(secondConflict, "Expected second conflict to exist");
assert.equal(canUseResolution(firstConflict, "both"), true);
assert.equal(canUseResolution(secondConflict, "both"), false);
assert.equal(
  getUnresolvedConflictCount(
    {
      ...conflictPreview,
      conflicts: [
        {
          path: "components/button.tsx",
          kind: "text",
          allowedResolutions: ["current", "incoming"],
        },
      ],
    },
    {
      "components/button.tsx": "both",
    },
  ),
  1,
);
assert.equal(
  getPreviewModalDescription(
    {
      mode: "rsync",
      action: "pull",
      projectPath: "/repo/project-a",
      src: "/repo/primary/@acme",
      dest: "/repo/project-a/@acme",
      result: preview,
      selectedConflictResolutions: buildPreviewConflictResolutionState(),
      selectedFileActions: buildPreviewFileActionState(),
    },
    false,
  ),
  "1 changed file(s) • Added 0 • Modified 1 • Deleted 0",
);
assert.equal(
  getPreviewModalDescription(
    {
      mode: "rsync",
      action: "pull",
      projectPath: "/repo/project-a",
      src: "/repo/primary/@acme",
      dest: "/repo/project-a/@acme",
      result: conflictPreview,
      selectedConflictResolutions: buildPreviewConflictResolutionState(),
      selectedFileActions: buildPreviewFileActionState(),
    },
    false,
  ),
  "2 changed file(s) • Added 0 • Modified 2 • Deleted 0 • 2 unresolved conflict(s)",
);
assert.equal(
  getPreviewModalDescription(
    {
      mode: "rsync",
      action: "push",
      projectPath: "/repo/project-a",
      src: "/repo/project-a",
      dest: "/repo/main",
      result: decisionPreview,
      selectedConflictResolutions: buildPreviewConflictResolutionState(),
      selectedFileActions: buildPreviewFileActionState(),
    },
    false,
  ),
  "1 changed file(s) • Added 1 • Modified 0 • Deleted 0 • 1 unresolved file decision(s)",
);
assert.equal(
  getPreviewModalDescription(
    {
      mode: "rsync",
      action: "push",
      projectPath: "/repo/project-a",
      src: "/repo/project-a",
      dest: "/repo/main",
      result: decisionPreview,
      selectedConflictResolutions: buildPreviewConflictResolutionState(),
      selectedFileActions: {
        "tokens/new.ts": undefined,
      },
    },
    true,
  ),
  "1 changed file(s) • Added 1 • Modified 0 • Deleted 0 • 1 unresolved file decision(s) • Review before continuing to confirmation",
);
assert.equal(
  getPreviewModalDescription(
    {
      mode: "rsync",
      action: "pull",
      projectPath: "/repo/project-a",
      src: "/repo/primary/@acme",
      dest: "/repo/project-a/@acme",
      result: conflictPreview,
      selectedConflictResolutions: {
        "components/button.tsx": "both",
      },
      selectedFileActions: buildPreviewFileActionState(),
    },
    true,
  ),
  "2 changed file(s) • Added 0 • Modified 2 • Deleted 0 • 1 unresolved conflict(s) • Review before continuing to confirmation",
);

console.log("confirm preview reuse checks passed");
