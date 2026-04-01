import capabilityData from "./claude-model-capabilities.json";

export type ClaudeContextWindowValue = "default" | "1m";

export interface ClaudeContextWindowOption {
  value: ClaudeContextWindowValue;
  label: string;
  isDefault?: boolean;
}

import type { ClaudeCodeEffort } from "./types";

export interface ClaudeModelCapability {
  baseModel: string;
  options: ClaudeContextWindowOption[];
  supportsFastMode?: boolean;
  supportsThinkingToggle?: boolean;
  supportedEfforts?: ClaudeCodeEffort[];
}

interface ClaudeModelCapabilityData {
  models: ClaudeModelCapability[];
}

const claudeModelCapabilities = capabilityData as ClaudeModelCapabilityData;

export function getClaudeModelCapability(
  baseModel: string,
): ClaudeModelCapability | null {
  return (
    claudeModelCapabilities.models.find((model) => model.baseModel === baseModel) ??
    null
  );
}

export function getDefaultClaudeContextWindow(
  baseModel: string,
): ClaudeContextWindowValue | null {
  return (
    getClaudeModelCapability(baseModel)?.options.find((option) => option.isDefault)
      ?.value ?? null
  );
}

export function supportsMultipleContextWindows(baseModel: string): boolean {
  return (getClaudeModelCapability(baseModel)?.options.length ?? 0) > 1;
}

export function supportsClaudeFastMode(baseModel: string): boolean {
  return getClaudeModelCapability(baseModel)?.supportsFastMode ?? false;
}

export function supportsClaudeThinkingToggle(baseModel: string): boolean {
  return getClaudeModelCapability(baseModel)?.supportsThinkingToggle ?? false;
}

export function getClaudeSupportedEfforts(
  baseModel: string,
): ClaudeCodeEffort[] {
  return getClaudeModelCapability(baseModel)?.supportedEfforts ?? [];
}
