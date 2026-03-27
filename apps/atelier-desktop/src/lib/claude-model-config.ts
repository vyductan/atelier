import {
  getClaudeModelCapability,
  getDefaultClaudeContextWindow,
} from "./claude-model-capabilities";
import type { ClaudeContextWindowValue } from "./claude-model-capabilities";

export interface ParsedClaudeModelString {
  baseModel: string;
  contextWindow: ClaudeContextWindowValue;
}

const CLAUDE_MODEL_1M_SUFFIX = "[1m]";

export function parseClaudeModelString(
  model: string,
): ParsedClaudeModelString | null {
  const trimmedModel = model.trim();

  if (!trimmedModel) {
    return null;
  }

  if (trimmedModel.endsWith(CLAUDE_MODEL_1M_SUFFIX)) {
    const baseModel = trimmedModel.slice(0, -CLAUDE_MODEL_1M_SUFFIX.length);
    const capability = getClaudeModelCapability(baseModel);

    if (!capability) {
      return null;
    }

    const supports1mContextWindow = capability.options.some(
      (option) => option.value === "1m",
    );
    if (!supports1mContextWindow) {
      return null;
    }

    return {
      baseModel,
      contextWindow: "1m",
    };
  }

  const defaultContextWindow = getDefaultClaudeContextWindow(trimmedModel);
  if (!defaultContextWindow) {
    return null;
  }

  return {
    baseModel: trimmedModel,
    contextWindow: defaultContextWindow,
  };
}

export function formatClaudeModelString(
  baseModel: string,
  contextWindow: ClaudeContextWindowValue,
): string | null {
  const capability = getClaudeModelCapability(baseModel);

  if (!capability) {
    return null;
  }

  const hasContextWindow = capability.options.some(
    (option) => option.value === contextWindow,
  );
  if (!hasContextWindow) {
    return null;
  }

  if (contextWindow === "1m") {
    return `${baseModel}${CLAUDE_MODEL_1M_SUFFIX}`;
  }

  return baseModel;
}

export function resolveClaudeContextWindowFromModel(
  model: string,
): ClaudeContextWindowValue | null {
  return parseClaudeModelString(model)?.contextWindow ?? null;
}

