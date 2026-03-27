import { describe, expect, it } from "vitest";

import {
  buildFocusListenerSetupErrorMessage,
  buildLastModifiedFailureState,
  formatSyncExecutionError,
} from "./acme-sync-error-state";

describe("buildLastModifiedFailureState", () => {
  it("stores the failure message for the UI", () => {
    expect(buildLastModifiedFailureState("permission denied")).toEqual({
      display: "Error",
      time: null,
      errorMessage: "permission denied",
    });
  });
});

describe("formatSyncExecutionError", () => {
  it("prefers Error messages", () => {
    expect(formatSyncExecutionError(new Error("disk full"))).toBe("disk full");
  });

  it("falls back to a generic message for unknown values", () => {
    expect(formatSyncExecutionError({})).toBe(
      "Sync failed. Check the logs and try again.",
    );
  });
});

describe("buildFocusListenerSetupErrorMessage", () => {
  it("surfaces focus-listener subscription failures for toasts", () => {
    expect(
      buildFocusListenerSetupErrorMessage(new Error("window api unavailable")),
    ).toBe(
      "Failed to subscribe to window focus changes: window api unavailable",
    );
  });
});
