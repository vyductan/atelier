import { afterEach, describe, expect, it, vi } from "vitest";

import { startActiveSessionStream } from "./studio";

describe("startActiveSessionStream", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("includes resolvedModel in the fresh-start request body", async () => {
    let capturedRequest: RequestInit | undefined;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      capturedRequest = init;

      return new Promise<never>((_resolve) => {
        // Keep the request pending so the test can inspect the request body.
      });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    await startActiveSessionStream(
      "session-123",
      "/tmp/project",
      "Hello",
      vi.fn(),
      vi.fn(),
      undefined,
      "claude-opus-4-6[1m]",
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(capturedRequest?.body).toBe(
      JSON.stringify({
        sessionId: "session-123",
        projectPath: "/tmp/project",
        firstPrompt: "Hello",
        resumeSessionId: undefined,
        resolvedModel: "claude-opus-4-6[1m]",
      }),
    );
  });

  it("preserves resume payloads without adding a resolvedModel", async () => {
    let capturedRequest: RequestInit | undefined;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      capturedRequest = init;

      return new Promise<never>((_resolve) => {
        // Keep the request pending so the test can inspect the request body.
      });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    await startActiveSessionStream(
      "session-123",
      "/tmp/project",
      undefined,
      vi.fn(),
      vi.fn(),
      "resume-123",
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(capturedRequest?.body).toBe(
      JSON.stringify({
        sessionId: "session-123",
        projectPath: "/tmp/project",
        firstPrompt: undefined,
        resumeSessionId: "resume-123",
        resolvedModel: undefined,
      }),
    );
  });
});
