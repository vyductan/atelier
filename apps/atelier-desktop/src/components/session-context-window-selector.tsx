import { Select } from "@acme/ui/components/select";

import type {
  ClaudeContextWindowOption,
  ClaudeContextWindowValue,
} from "../lib/claude-model-capabilities";

interface SessionContextWindowSelectorProps {
  baseModel?: string | null;
  value?: ClaudeContextWindowValue | null;
  options?: ClaudeContextWindowOption[];
  onChange?: (value: ClaudeContextWindowValue) => void;
}

export function SessionContextWindowSelector({
  baseModel,
  value,
  options = [],
  onChange,
}: SessionContextWindowSelectorProps) {
  if (!baseModel || options.length < 2) {
    return null;
  }

  return (
    <Select
      id="session-context-window-selector"
      aria-label="Context Window"
      size="small"
      value={value ?? undefined}
      options={options.map((option) => ({
        label: option.label,
        value: option.value,
      }))}
      onChange={(nextValue) => onChange?.(nextValue as ClaudeContextWindowValue)}
    />
  );
}
