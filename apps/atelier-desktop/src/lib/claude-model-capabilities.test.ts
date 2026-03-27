import { describe, expect, it } from "vitest";

import {
  getClaudeModelCapability,
  getDefaultClaudeContextWindow,
  supportsMultipleContextWindows,
} from "./claude-model-capabilities";

describe("claude model capabilities", () => {
  it("returns the expected context-window options for a supported base model", () => {
    expect(getClaudeModelCapability("claude-opus-4-6")?.options).toEqual([
      {
        value: "default",
        label: "200k",
        isDefault: true,
      },
      {
        value: "1m",
        label: "1M",
      },
    ]);
  });

  it("returns no options for an unsupported base model", () => {
    expect(getClaudeModelCapability("claude-sonnet-4-6")).toBeNull();
    expect(supportsMultipleContextWindows("claude-sonnet-4-6")).toBe(false);
  });

  it("returns a stable default for each supported model", () => {
    expect(getDefaultClaudeContextWindow("claude-opus-4-6")).toBe("default");
  });
});
