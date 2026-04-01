import { Switch } from "@acme/ui/components/switch";
import { Select } from "@acme/ui/components/select";
import type { ClaudeCodeEffort, ClaudeModelOptions } from "../lib/types";

interface ClaudeTraitsPickerProps {
  modelOptions: ClaudeModelOptions | null | undefined;
  onChange: (options: ClaudeModelOptions) => void;
  supportsFastMode: boolean;
  supportsThinkingToggle: boolean;
  supportedEfforts: ClaudeCodeEffort[];
}

export function ClaudeTraitsPicker({
  modelOptions,
  onChange,
  supportsFastMode,
  supportsThinkingToggle,
  supportedEfforts,
}: ClaudeTraitsPickerProps) {
  if (
    !supportsFastMode &&
    !supportsThinkingToggle &&
    supportedEfforts.length === 0
  ) {
    return null;
  }

  const handleEffortChange = (value: string) => {
    onChange({
      ...(modelOptions || {} as ClaudeModelOptions),
      effort: value as ClaudeCodeEffort,
    });
  };

  const handleFastModeChange = (checked: boolean) => {
    onChange({
      ...(modelOptions || {} as ClaudeModelOptions),
      fastMode: checked,
    });
  };

  const handleThinkingChange = (checked: boolean) => {
    onChange({
      ...(modelOptions || {} as ClaudeModelOptions),
      thinking: checked,
    });
  };

  return (
    <div className="flex items-center space-x-3 pr-2 border-r mr-2">
      {supportedEfforts.length > 0 && (
        <div className="flex shrink-0 space-y-1">
          <div className="w-24">
            <label className="text-muted-foreground block text-[10px] font-medium uppercase tracking-wide">
              Effort
            </label>
            <Select
              id="session-effort-selector"
              aria-label="Effort"
              size="small"
              value={modelOptions?.effort ?? "max"}
              options={supportedEfforts.map((eff) => ({
                label: eff.charAt(0).toUpperCase() + eff.slice(1),
                value: eff,
              }))}
              onChange={handleEffortChange}
            />
          </div>
        </div>
      )}
      {supportsFastMode && (
        <div className="flex shrink-0 flex-col space-y-1">
          <label className="text-muted-foreground block text-[10px] font-medium uppercase tracking-wide">
            Fast
          </label>
          <div className="h-7 flex items-center">
            <Switch
              checked={modelOptions?.fastMode ?? false}
              onChange={handleFastModeChange}
              size="small"
            />
          </div>
        </div>
      )}
      {supportsThinkingToggle && (
        <div className="flex shrink-0 flex-col space-y-1">
          <label className="text-muted-foreground block text-[10px] font-medium uppercase tracking-wide">
            Thinking
          </label>
          <div className="h-7 flex items-center">
            <Switch
              checked={modelOptions?.thinking ?? true}
              onChange={handleThinkingChange}
              size="small"
            />
          </div>
        </div>
      )}
    </div>
  );
}
