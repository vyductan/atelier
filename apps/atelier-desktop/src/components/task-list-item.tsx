import type { ComponentPropsWithoutRef } from "react";

import { Button } from "@acme/ui/components/button";

import type { TaskRecord } from "../lib/tasks";

interface TaskListItemProps extends ComponentPropsWithoutRef<"li"> {
  task: TaskRecord;
  isSelected: boolean;
  onSelectTask: (taskId: string) => void;
}

function getRunnerLabel(task: TaskRecord): string {
  switch (task.resolvedRunner ?? task.runnerPreference) {
    case "claude": {
      return "Claude";
    }
    case "openclaw": {
      return "OpenClaw";
    }
    default: {
      return "Auto";
    }
  }
}

export function TaskListItem({
  task,
  isSelected,
  onSelectTask,
  ...props
}: TaskListItemProps) {
  return (
    <li {...props}>
      <Button
        type="button"
        variant="text"
        className="flex h-auto w-full flex-col items-start gap-1 rounded-md border px-3 py-2 text-left"
        data-selected={isSelected}
        onClick={() => onSelectTask(task.id)}
      >
        <div className="flex w-full items-center justify-between gap-3">
          <span className="text-sm font-medium">{task.title}</span>
          <span className="text-muted-foreground text-[11px]">
            {getRunnerLabel(task)}
          </span>
        </div>
        <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
          <span>{task.status}</span>
          {task.currentStage ? <span>• {task.currentStage}</span> : null}
        </div>
      </Button>
    </li>
  );
}
