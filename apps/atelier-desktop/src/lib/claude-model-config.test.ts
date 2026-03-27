import { describe, expect, it, vi } from "vitest";

import {
  formatClaudeModelString,
  parseClaudeModelString,
  resolveClaudeContextWindowFromModel,
} from "./claude-model-config";
import * as claudeModelCapabilities from "./claude-model-capabilities";

describe("claude model config", () => {
  it("parses an unsuffixed model into its base model and default context window", () => {
    expect(parseClaudeModelString("claude-opus-4-6")).toEqual({
      baseModel: "claude-opus-4-6",
      contextWindow: "default",
    });
  });

  it("parses a 1m-suffixed model into its base model and 1M context window", () => {
    expect(parseClaudeModelString("claude-opus-4-6[1m]")).toEqual({
      baseModel: "claude-opus-4-6",
      contextWindow: "1m",
    });
  });

  it("writes parsed models back out while preserving or removing the 1m suffix correctly", () => {
    const parsedDefault = parseClaudeModelString("claude-opus-4-6");
    const parsed1m = parseClaudeModelString("claude-opus-4-6[1m]");

    expect(parsedDefault).toEqual({
      baseModel: "claude-opus-4-6",
      contextWindow: "default",
    });
    expect(parsed1m).toEqual({
      baseModel: "claude-opus-4-6",
      contextWindow: "1m",
    });

    if (!parsedDefault || !parsed1m) {
      throw new Error("Expected claude-opus-4-6 variants to parse");
    }

    expect(
      formatClaudeModelString(
        parsedDefault.baseModel,
        parsedDefault.contextWindow,
      ),
    ).toBe("claude-opus-4-6");
    expect(
      formatClaudeModelString(parsed1m.baseModel, parsed1m.contextWindow),
    ).toBe("claude-opus-4-6[1m]");
  });

  it("resolves the effective context window directly from a model string", () => {
    expect(resolveClaudeContextWindowFromModel("claude-opus-4-6")).toBe(
      "default",
    );
    expect(resolveClaudeContextWindowFromModel("claude-opus-4-6[1m]")).toBe(
      "1m",
    );
  });

  it("returns an explicit invalid result for invalid model strings instead of guessing", () => {
    expect(parseClaudeModelString("opus[1m]")).toBeNull();
    expect(parseClaudeModelString("claude-opus-4-6[200k]")).toBeNull();
    expect(parseClaudeModelString("claude-opus-4-6[2m]")).toBeNull();
    expect(parseClaudeModelString("claude-sonnet-4-6")).toBeNull();
    expect(parseClaudeModelString("   ")).toBeNull();
    expect(resolveClaudeContextWindowFromModel("opus[1m]")).toBeNull();
  });

  it("rejects a 1m suffix when the model capability does not declare 1m support", () => {
    const capabilitySpy = vi
      .spyOn(claudeModelCapabilities, "getClaudeModelCapability")
      .mockReturnValue({
        baseModel: "claude-opus-4-6",
        options: [{ value: "default", label: "200k", isDefault: true }],
      });

    expect(parseClaudeModelString("claude-opus-4-6[1m]")).toBeNull();

    capabilitySpy.mockRestore();
  });
});
