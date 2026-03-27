import type { FormEvent } from "react";
import { useState } from "react";

import { Button } from "@acme/ui/components/button";
import { Input } from "@acme/ui/components/input";

import type { TaskRunnerPreference } from "../lib/tasks";

interface TaskCreateBarProps {
  workspaceName: string;
  disabled?: boolean;
  onCreateTask: (input: {
    prompt: string;
    runnerPreference: TaskRunnerPreference;
  }) => Promise<void>;
}

const runnerOptions: TaskRunnerPreference[] = ["auto", "claude", "openclaw"];

function getRunnerLabel(runner: TaskRunnerPreference): string {
  switch (runner) {
    case "auto": {
      return "Auto";
    }
    case "claude": {
      return "Claude";
    }
    case "openclaw": {
      return "OpenClaw";
    }
  }
}

export function TaskCreateBar({
  workspaceName,
  disabled = false,
  onCreateTask,
}: TaskCreateBarProps) {
  const [prompt, setPrompt] = useState("");
  const [runnerPreference, setRunnerPreference] =
    useState<TaskRunnerPreference>("auto");

  const handleSubmit = async () => {
    const trimmedPrompt = prompt.trim();

    if (disabled || !trimmedPrompt) {
      return;
    }

    await onCreateTask({
      prompt: trimmedPrompt,
      runnerPreference,
    });
    setPrompt("");
    setRunnerPreference("auto");
  };

  const handleFormSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void handleSubmit();
  };

  return (
    <section className="border-b px-4 py-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Tasks</h2>
          <p className="text-muted-foreground text-xs">
            Create workspace-scoped work for {workspaceName}.
          </p>
        </div>
      </div>
      <form className="flex flex-col gap-3" onSubmit={handleFormSubmit}>
        <Input
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="Ask Atelier to work on this workspace"
          disabled={disabled}
        />
        <div className="flex flex-wrap items-center gap-2">
          {runnerOptions.map((option) => {
            const isActive = runnerPreference === option;

            return (
              <Button
                key={option}
                type="button"
                variant={isActive ? "filled" : "outlined"}
                size="small"
                disabled={disabled}
                onClick={() => setRunnerPreference(option)}
              >
                {getRunnerLabel(option)}
              </Button>
            );
          })}
          <Button type="submit" size="small" disabled={disabled}>
            Create task
          </Button>
        </div>
      </form>
    </section>
  );
}
