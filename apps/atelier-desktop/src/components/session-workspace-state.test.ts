import { describe, expect, it } from "vitest";

import {
  createInitialWorkspaceState,
  reduceWorkspaceEvent,
} from "./session-workspace-state";

describe("createInitialWorkspaceState", () => {
  it("creates an idle workspace state with no timeline items", () => {
    expect(createInitialWorkspaceState()).toEqual({
      connection: "idle",
      sessionId: null,
      timeline: [],
      error: null,
    });
  });
});

describe("reduceWorkspaceEvent", () => {
  it("tracks connecting to connected session lifecycle", () => {
    const connecting = reduceWorkspaceEvent(createInitialWorkspaceState(), {
      type: "session-connecting",
    });
    const connected = reduceWorkspaceEvent(connecting, {
      type: "session-connected",
      sessionId: "abc",
    });

    expect(connecting.connection).toBe("connecting");
    expect(connected.connection).toBe("connected");
    expect(connected.sessionId).toBe("abc");
    expect(connected.error).toBeNull();
  });

  it("appends optimistic local user messages to the timeline", () => {
    const next = reduceWorkspaceEvent(createInitialWorkspaceState(), {
      type: "user-message",
      text: "Plan the next step",
    } as never);

    expect(next.timeline).toEqual([
      {
        kind: "user",
        text: "Plan the next step",
      },
    ]);
  });

  it("creates and extends a streaming assistant timeline item from deltas", () => {
    const first = reduceWorkspaceEvent(createInitialWorkspaceState(), {
      type: "assistant-delta",
      text: "Hello",
    });
    const second = reduceWorkspaceEvent(first, {
      type: "assistant-delta",
      text: " there",
    });

    expect(second.connection).toBe("streaming");
    expect(second.timeline).toEqual([
      {
        kind: "assistant",
        text: "Hello there",
        isStreaming: true,
      },
    ]);
  });

  it("stores session status timeline entries", () => {
    const next = reduceWorkspaceEvent(createInitialWorkspaceState(), {
      type: "session-status",
      status: "compacting",
    });

    expect(next.timeline.at(-1)).toEqual({
      kind: "system-status",
      status: "compacting",
    });
  });

  it("stores operation result metadata for later UI use", () => {
    const next = reduceWorkspaceEvent(createInitialWorkspaceState(), {
      type: "operation-finished",
      subtype: "handoff",
      status: "completed",
      costUsd: 1.25,
      result: { path: "/tmp/handoff.md" },
    });

    expect(next.connection).toBe("connected");
    expect(next.timeline.at(-1)).toEqual({
      kind: "operation",
      subtype: "handoff",
      status: "completed",
      costUsd: 1.25,
      result: { path: "/tmp/handoff.md" },
    });
  });

  it("stores runtime errors in state without inserting a timeline item", () => {
    const streaming = reduceWorkspaceEvent(createInitialWorkspaceState(), {
      type: "assistant-delta",
      text: "Partial output",
    });
    const next = reduceWorkspaceEvent(streaming, {
      type: "runtime-error",
      error: "Connection refused",
    });

    expect(next.connection).toBe("error");
    expect(next.error).toBe("Connection refused");
    expect(next.timeline).toEqual([
      {
        kind: "assistant",
        text: "Partial output",
        isStreaming: false,
      },
    ]);
    expect(next.timeline).not.toContainEqual({
      kind: "system-status",
      status: "Connection refused",
    });
  });

  it("finalizes the timeline and marks the session stopped when finished", () => {
    const streaming = reduceWorkspaceEvent(createInitialWorkspaceState(), {
      type: "assistant-delta",
      text: "Done soon",
    });
    const next = reduceWorkspaceEvent(streaming, {
      type: "session-finished",
    });

    expect(next.connection).toBe("stopped");
    expect(next.timeline).toEqual([
      {
        kind: "assistant",
        text: "Done soon",
        isStreaming: false,
      },
    ]);
  });
});
