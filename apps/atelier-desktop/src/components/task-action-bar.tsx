import type { JSX } from "react";

import { Button } from "@acme/ui/components/button";

import type { TaskRecord } from "../lib/tasks";

interface TaskActionBarProps {
  task: TaskRecord;
  onStartTask?: (taskId: string) => void;
  onApproveTask?: (taskId: string) => void;
  onRejectTask?: (taskId: string) => void;
  onRetryTask?: (taskId: string) => void;
  onResumeTask?: (taskId: string) => void;
  onRerunTask?: (taskId: string) => void;
}

function renderTaskActions(props: TaskActionBarProps): JSX.Element | null {
  const {
    task,
    onStartTask,
    onApproveTask,
    onRejectTask,
    onRetryTask,
    onResumeTask,
    onRerunTask,
  } = props;

  switch (task.status) {
    case "queued": {
      return (
        <Button size="small" onClick={() => onStartTask?.(task.id)}>
          Start
        </Button>
      );
    }
    case "awaiting_approval": {
      return (
        <>
          <Button size="small" onClick={() => onApproveTask?.(task.id)}>
            Approve
          </Button>
          <Button
            size="small"
            variant="outlined"
            onClick={() => onRejectTask?.(task.id)}
          >
            Reject
          </Button>
        </>
      );
    }
    case "blocked": {
      return (
        <>
          <Button size="small" onClick={() => onRetryTask?.(task.id)}>
            Retry
          </Button>
          <Button
            size="small"
            variant="outlined"
            onClick={() => onResumeTask?.(task.id)}
          >
            Resume
          </Button>
        </>
      );
    }
    case "failed": {
      return (
        <Button size="small" onClick={() => onRetryTask?.(task.id)}>
          Retry
        </Button>
      );
    }
    case "done": {
      return (
        <Button size="small" onClick={() => onRerunTask?.(task.id)}>
          Re-run
        </Button>
      );
    }
    default: {
      return null;
    }
  }
}

export function TaskActionBar(props: TaskActionBarProps): JSX.Element {
  return (
    <div className="flex flex-wrap gap-2 border-b px-4 py-3">
      {renderTaskActions(props)}
    </div>
  );
}
