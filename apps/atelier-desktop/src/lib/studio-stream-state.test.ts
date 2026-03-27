import { describe, expect, it } from "vitest";

import {
  buildStreamConnectionError,
  parseStreamEventData,
} from "./studio-stream-state";

describe("parseStreamEventData", () => {
  it("returns a parse error for malformed JSON payloads", () => {
    const result = parseStreamEventData("not-json");

    expect(result).toEqual({
      ok: false,
      error: "Invalid stream event payload: not-json",
    });
  });

  it("returns parsed done events without hiding them", () => {
    const result = parseStreamEventData('{"type":"done"}');

    expect(result).toEqual({
      ok: true,
      event: { type: "done" },
    });
  });

  it("preserves structured studio system metadata needed by the runtime", () => {
    const result = parseStreamEventData(
      '{"type":"system","subtype":"status","status":"Running /compact","cost_usd":0.42,"result":{"duration_ms":1234}}',
    );

    expect(result).toEqual({
      ok: true,
      event: {
        type: "system",
        subtype: "status",
        status: "Running /compact",
        cost_usd: 0.42,
        result: {
          duration_ms: 1234,
        },
      },
    });
  });

  it("preserves watcher-style metadata fields on parsed events", () => {
    const result = parseStreamEventData(
      '{"type":"result","subtype":"handoff","status":"completed","session_id":"session-123","cost_usd":1.25,"result":{"path":"/tmp/handoff.md"}}',
    );

    expect(result).toEqual({
      ok: true,
      event: {
        type: "result",
        subtype: "handoff",
        status: "completed",
        session_id: "session-123",
        cost_usd: 1.25,
        result: {
          path: "/tmp/handoff.md",
        },
      },
    });
  });
});

describe("buildStreamConnectionError", () => {
  it("preserves non-abort fetch failures as error events", () => {
    const result = buildStreamConnectionError(new Error("Connection refused"));

    expect(result).toEqual({
      type: "error",
      error: "Connection refused",
    });
  });
});
