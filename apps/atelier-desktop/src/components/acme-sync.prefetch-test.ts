import assert from "node:assert/strict";

import type { SyncProfile } from "../lib/types.ts";
import { buildPreviewRequestsForProfile } from "./acme-sync-profile-state.ts";

const rsyncProfile: SyncProfile = {
  id: "rsync-1",
  projectPath: "/repo/project-a",
  primaryPath: "/repo/main",
  mode: "rsync",
};

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

assert.deepEqual(buildPreviewRequestsForProfile(rsyncProfile), [
  {
    action: "push",
    mode: "rsync",
    src: "/repo/project-a",
    dest: "/repo/main",
  },
  {
    action: "pull",
    mode: "rsync",
    src: "/repo/main",
    dest: "/repo/project-a",
  },
]);

assert.deepEqual(buildPreviewRequestsForProfile(subtreeProfile), [
  {
    action: "pull",
    mode: "subtree",
    direction: "from-primary",
  },
]);

console.log("mode-aware prefetch checks passed");
