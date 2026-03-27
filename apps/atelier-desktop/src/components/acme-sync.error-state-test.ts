import assert from "node:assert/strict";

import {
  buildLastModifiedFailureState,
  formatSyncExecutionError,
} from "./acme-sync-error-state";

const failureState = buildLastModifiedFailureState(
  "Failed to refresh modified timestamp for /repo/project-a",
);
assert.equal(failureState.display, "Error");
assert.equal(failureState.time, null);
assert.equal(
  failureState.errorMessage,
  "Failed to refresh modified timestamp for /repo/project-a",
);
assert.match(failureState.errorMessage ?? "", /refresh modified timestamp/i);

assert.equal(
  formatSyncExecutionError(new Error("@acme sync failed: permission denied")),
  "@acme sync failed: permission denied",
);

assert.equal(
  formatSyncExecutionError({
    message: "pnpm-workspace.yaml sync failed: missing file",
  }),
  "pnpm-workspace.yaml sync failed: missing file",
);

assert.equal(
  formatSyncExecutionError({ reason: "permission denied" }),
  "Sync failed. Check the logs and try again.",
);

assert.equal(
  formatSyncExecutionError("  raw failure text  "),
  "  raw failure text  ",
);

console.log("sync error state checks passed");
