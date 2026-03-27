import { describe, expect, it } from "vitest";

import {
  buildHistoryLoadErrorMessage,
  buildMissingSessionDirectoryMessage,
  buildSessionCwdLoadErrorMessage,
  buildSessionStopErrorMessage,
  buildStreamEventErrorMessage,
  getSessionStopToastMessage,
  shouldIgnoreExportPreparationError,
  shouldIgnoreSessionStopError,
  shouldResumeSessionWithFallbackCwd,
} from "./active-session-panel-state";

describe("buildHistoryLoadErrorMessage", () => {
  it("preserves session history load failures for the UI", () => {
    expect(buildHistoryLoadErrorMessage(new Error("bad session jsonl"))).toBe(
      "Failed to load session history: bad session jsonl",
    );
  });
});

describe("buildSessionCwdLoadErrorMessage", () => {
  it("preserves cwd metadata load failures for the UI", () => {
    expect(
      buildSessionCwdLoadErrorMessage(new Error("missing cwd metadata")),
    ).toBe("Failed to load session directory metadata: missing cwd metadata");
  });
});

describe("buildMissingSessionDirectoryMessage", () => {
  it("surfaces the missing cwd case instead of leaving the panel loading forever", () => {
    expect(buildMissingSessionDirectoryMessage()).toBe(
      "Failed to determine the session directory.",
    );
  });
});

describe("shouldIgnoreExportPreparationError", () => {
  it("ignores missing-file trash errors for new handoff export paths", () => {
    expect(
      shouldIgnoreExportPreparationError(
        new Error("No such file or directory"),
      ),
    ).toBe(true);
  });

  it("does not ignore unrelated not-found preparation failures", () => {
    expect(
      shouldIgnoreExportPreparationError(new Error("Trash service not found")),
    ).toBe(false);
  });
});

describe("buildStreamEventErrorMessage", () => {
  it("surfaces stream error events for the session panel", () => {
    expect(buildStreamEventErrorMessage("Claude exited with status 1")).toBe(
      "Studio stream error: Claude exited with status 1",
    );
  });
});

describe("shouldResumeSessionWithFallbackCwd", () => {
  it("blocks resume when session cwd metadata cannot be loaded", () => {
    expect(
      shouldResumeSessionWithFallbackCwd(true, "/fallback/project", false),
    ).toBe(false);
  });

  it("allows new sessions to use the selected project cwd", () => {
    expect(
      shouldResumeSessionWithFallbackCwd(false, "/selected/project", false),
    ).toBe(true);
  });
});

describe("buildSessionStopErrorMessage", () => {
  it("surfaces active-session cleanup failures", () => {
    expect(buildSessionStopErrorMessage(new Error("session not active"))).toBe(
      "Failed to stop active session: session not active",
    );
  });
});

describe("shouldIgnoreSessionStopError", () => {
  it("ignores cleanup races for already-ended sessions", () => {
    expect(shouldIgnoreSessionStopError(new Error("session not active"))).toBe(
      true,
    );
  });

  it("does not ignore real stop failures", () => {
    expect(shouldIgnoreSessionStopError(new Error("stop signal failed"))).toBe(
      false,
    );
  });
});

describe("getSessionStopToastMessage", () => {
  it("suppresses benign already-stopped cleanup races", () => {
    expect(
      getSessionStopToastMessage(new Error("session not active")),
    ).toBeNull();
  });

  it("returns a toast message for real stop failures", () => {
    expect(getSessionStopToastMessage(new Error("stop signal failed"))).toBe(
      "Failed to stop active session: stop signal failed",
    );
  });
});

describe("buildLifecycleStatusLabel", () => {
  it("returns readable labels for each visible connection state", async () => {
    const { buildLifecycleStatusLabel } =
      await import("./active-session-panel-state");

    expect(buildLifecycleStatusLabel("connecting")).toBe("Connecting");
    expect(buildLifecycleStatusLabel("connected")).toBe("Ready");
    expect(buildLifecycleStatusLabel("streaming")).toBe("Responding");
    expect(buildLifecycleStatusLabel("error")).toBe("Error");
    expect(buildLifecycleStatusLabel("stopped")).toBe("Disconnected");
  });
});

describe("buildComposerPlaceholder", () => {
  it("returns guidance for unavailable and ready lifecycle states", async () => {
    const { buildComposerPlaceholder } =
      await import("./active-session-panel-state");

    expect(buildComposerPlaceholder("connecting", false)).toBe(
      "Connecting to session…",
    );
    expect(buildComposerPlaceholder("error", false)).toBe(
      "Session unavailable. Reopen or start a new session.",
    );
    expect(buildComposerPlaceholder("connected", true)).toBe(
      "Message Claude... (Enter to send, Shift+Enter for newline)",
    );
  });
});

describe("formatSystemStatusMessage", () => {
  it("turns raw runtime status updates into cleaner user-facing text", async () => {
    const { formatSystemStatusMessage } =
      await import("./active-session-panel-state");

    expect(formatSystemStatusMessage("compacting")).toBe(
      "Preparing session handoff…",
    );
    expect(formatSystemStatusMessage("Exported handoff.md")).toBe(
      "Handoff ready: Exported handoff.md",
    );
    expect(formatSystemStatusMessage("Queued")).toBe("Session status: Queued");
  });
});
