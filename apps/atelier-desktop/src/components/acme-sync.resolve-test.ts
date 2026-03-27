import assert from "node:assert/strict";

import type { SyncChangeType, SyncPreviewFile } from "../lib/types";

type Resolution = "push" | "pull";

type ResolveMode = "copy" | "delete";

const getResolveMode = (
  resolution: Resolution,
  pushFile?: SyncPreviewFile,
  pullFile?: SyncPreviewFile,
): ResolveMode => {
  const selectedChangeType: SyncChangeType | undefined =
    resolution === "push" ? pushFile?.changeType : pullFile?.changeType;

  return selectedChangeType === "deleted" ? "delete" : "copy";
};

assert.equal(
  getResolveMode(
    "pull",
    { path: "components/button.tsx", changeType: "modified" },
    { path: "components/button.tsx", changeType: "deleted" },
  ),
  "delete",
);

assert.equal(
  getResolveMode(
    "push",
    { path: "components/card.tsx", changeType: "deleted" },
    { path: "components/card.tsx", changeType: "added" },
  ),
  "delete",
);

assert.equal(
  getResolveMode(
    "push",
    { path: "components/input.tsx", changeType: "modified" },
    { path: "components/input.tsx", changeType: "deleted" },
  ),
  "copy",
);

console.log("resolve mode checks passed");
