import assert from "node:assert/strict";

import type { SyncPreviewFile } from "../lib/types";

const getConflictPaths = (
  pushFiles: SyncPreviewFile[],
  pullFiles: SyncPreviewFile[],
) => {
  const pushPaths = new Set(pushFiles.map((file) => file.path));
  const pullPaths = new Set(pullFiles.map((file) => file.path));

  const conflicts = new Set<string>();
  for (const path of pushPaths) {
    if (pullPaths.has(path)) {
      conflicts.add(path);
    }
  }

  return [...conflicts].toSorted();
};

const deleteVsModify = getConflictPaths(
  [{ path: "components/button.tsx", changeType: "deleted" }],
  [{ path: "components/button.tsx", changeType: "modified" }],
);
assert.deepEqual(deleteVsModify, ["components/button.tsx"]);

const deleteVsAdd = getConflictPaths(
  [{ path: "components/card.tsx", changeType: "added" }],
  [{ path: "components/card.tsx", changeType: "deleted" }],
);
assert.deepEqual(deleteVsAdd, ["components/card.tsx"]);

const unrelated = getConflictPaths(
  [{ path: "components/a.tsx", changeType: "modified" }],
  [{ path: "components/b.tsx", changeType: "modified" }],
);
assert.deepEqual(unrelated, []);

console.log("conflict detection checks passed");
