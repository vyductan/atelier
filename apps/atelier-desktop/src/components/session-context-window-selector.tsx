import { Select } from "@acme/ui/components/select";

import type {
  ClaudeContextWindowOption,
  ClaudeContextWindowValue,
} from "../lib/claude-model-capabilities";

interface SessionContextWindowSelectorProps {
  baseModel: string | null;
  value: ClaudeContextWindowValue | null;
  options: ClaudeContextWindowOption[];
  onChange: (value: ClaudeContextWindowValue) => void;
}

export function SessionContextWindowSelector({
  baseModel,
  value,
  options,
  onChange,
}: SessionContextWindowSelectorProps) {
  if (!baseModel || options.length < 2) {
    return null;
  }

  return (
    <div className="w-36 shrink-0 space-y-1">
      <label
        htmlFor="session-context-window"
        className="text-muted-foreground block text-[10px] font-medium uppercase tracking-wide"
      >
        Context Window
      </label>
      <Select
        id="session-context-window"
        aria-label="Context Window"
        size="small"
        value={value ?? undefined}
        options={options.map((option) => ({
          label: option.label,
          value: option.value,
        }))}
        onChange={(nextValue) => onChange(nextValue as ClaudeContextWindowValue)}
      />
    </div>
  );
}
