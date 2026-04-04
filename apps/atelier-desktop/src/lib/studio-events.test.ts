import { describe, expect, it } from "vitest";

import { extractStudioStatus, normalizeStudioEvent } from "./studio-events";

describe("normalizeStudioEvent", () => {
  it("maps system events with session_id to session-connected", () => {
    expect(normalizeStudioEvent({ type: "system", session_id: "abc" })).toEqual(
      { type: "session-connected", sessionId: "abc" },
    );
  });

  it("maps assistant text payloads to assistant-delta without trimming chunk whitespace", () => {
    expect(
      normalizeStudioEvent({
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: " Hello there\n" }],
        },
      }),
    ).toEqual({ type: "assistant-delta", text: " Hello there\n" });
  });

  it("preserves tool-use items in assistant payloads", () => {
    expect(
      normalizeStudioEvent({
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "Before" },
            { type: "tool_use", text: '{"skill":"using-superpowers"}' },
            { type: "text", text: "After" },
          ],
        },
      }),
    ).toEqual({
      type: "assistant-delta",
      text:
        'Before<tool_use name="tool_use">{"skill":"using-superpowers"}</tool_use>After',
    });
  });

  it("maps error events to runtime-error", () => {
    expect(
      normalizeStudioEvent({ type: "error", error: "Connection refused" }),
    ).toEqual({ type: "runtime-error", error: "Connection refused" });
  });

  it("maps status system events to session-status", () => {
    expect(
      normalizeStudioEvent({
        type: "system",
        subtype: "status",
        status: "compacting",
      }),
    ).toEqual({ type: "session-status", status: "compacting" });
  });

  it("maps result events to operation-finished with metadata", () => {
    expect(
      normalizeStudioEvent({
        type: "result",
        subtype: "handoff",
        status: "completed",
        cost_usd: 1.25,
        result: { path: "/tmp/handoff.md" },
      }),
    ).toEqual({
      type: "operation-finished",
      subtype: "handoff",
      status: "completed",
      costUsd: 1.25,
      result: { path: "/tmp/handoff.md" },
    });
  });

  it("maps result events without metadata to operation-finished", () => {
    expect(normalizeStudioEvent({ type: "result" })).toEqual({
      type: "operation-finished",
    });
  });

  it("maps done events to session-finished", () => {
    expect(normalizeStudioEvent({ type: "done" })).toEqual({
      type: "session-finished",
    });
  });

  it("extracts non-empty status payloads safely", () => {
    expect(
      extractStudioStatus({ type: "system", status: "compacting" } as never),
    ).toBe("compacting");
    expect(extractStudioStatus({ type: "system", status: "" } as never)).toBe(
      null,
    );
    expect(extractStudioStatus({ type: "system" })).toBe(null);
  });

  it("returns null for unknown or unsupported input", () => {
    expect(
      normalizeStudioEvent({ type: "assistant", message: undefined }),
    ).toBe(null);
    expect(normalizeStudioEvent({ type: "mystery" })).toBe(null);
  });
});
