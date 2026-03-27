import { describe, expect, it } from "vitest";

import {
  assertStudioResponseOk,
  buildStudioRequestError,
  shouldAllowSessionInput,
} from "./studio-request-state";

describe("assertStudioResponseOk", () => {
  it("throws for non-2xx studio responses instead of pretending the request succeeded", async () => {
    await expect(
      assertStudioResponseOk({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
      }),
    ).rejects.toThrow(
      "Studio request failed with HTTP 503 Service Unavailable",
    );
  });

  it("preserves backend JSON error messages when available", async () => {
    await expect(
      assertStudioResponseOk({
        ok: false,
        status: 404,
        statusText: "Not Found",
        json: async () => ({ error: "session not active" }),
      }),
    ).rejects.toThrow("session not active");
  });

  it("falls back to the HTTP status when the error body cannot be parsed", async () => {
    await expect(
      assertStudioResponseOk({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        json: async () => {
          throw new SyntaxError("Unexpected token < in JSON");
        },
      }),
    ).rejects.toThrow(
      "Studio request failed with HTTP 500 Internal Server Error",
    );
  });
});

describe("buildStudioRequestError", () => {
  it("preserves the original error message for toast surfaces", () => {
    expect(
      buildStudioRequestError(
        "send session message",
        new Error("socket closed"),
      ),
    ).toBe("Failed to send session message: socket closed");
  });
});

describe("shouldAllowSessionInput", () => {
  it("keeps new-session input disabled until a session id is available", () => {
    expect(shouldAllowSessionInput(false, false, "")).toBe(false);
    expect(shouldAllowSessionInput(true, false, "")).toBe(false);
    expect(shouldAllowSessionInput(true, false, "claude-session-id")).toBe(
      true,
    );
  });
});
