import { describe, expect, it } from "vitest";

import { resolveTaskRunner } from "./task-routing";

describe("resolveTaskRunner", () => {
  it("resolves an explicit claude preference to claude", () => {
    expect(
      resolveTaskRunner({
        prompt: "compare these two approaches",
        runnerPreference: "claude",
      }),
    ).toBe("claude");
  });

  it("resolves an explicit openclaw preference to openclaw", () => {
    expect(
      resolveTaskRunner({
        prompt: "review PR 128 and fix the issues",
        runnerPreference: "openclaw",
      }),
    ).toBe("openclaw");
  });

  it("routes exploratory prompts to claude in auto mode", () => {
    expect(
      resolveTaskRunner({
        prompt: "explain how this auth module works",
        runnerPreference: "auto",
      }),
    ).toBe("claude");
  });

  it("routes long-running implementation prompts to openclaw in auto mode", () => {
    expect(
      resolveTaskRunner({
        prompt: "implement english learning speaking end-to-end",
        runnerPreference: "auto",
      }),
    ).toBe("openclaw");
  });
});
