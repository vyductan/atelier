import assert from "node:assert/strict";

import { getParsedSyncDiffState } from "./sync-diff-parse-state";

const brokenDiff = "this is not a valid unified diff";
const brokenState = getParsedSyncDiffState(brokenDiff);
assert.equal(brokenState.firstFile, null);
assert.match(brokenState.parseError ?? "", /parse/i);

const emptyState = getParsedSyncDiffState("");
assert.equal(emptyState.firstFile, null);
assert.equal(emptyState.parseError, null);

console.log("sync diff parse checks passed");
