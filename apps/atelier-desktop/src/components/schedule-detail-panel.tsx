import type { JSX } from "react";

import type {
  ScheduledTaskDefinition,
  ScheduledTaskRunRecord,
} from "../lib/scheduled-tasks";
import type { ScheduledTaskFormInput } from "./scheduled-task-form";
import { ScheduledTaskForm } from "./scheduled-task-form";

interface ScheduleDetailPanelProps {
  task: ScheduledTaskDefinition | null;
  runs: ScheduledTaskRunRecord[];
  errorMessage?: string | null;
  createDraft?: ScheduledTaskFormInput | null;
  onCreateTask: (input: ScheduledTaskFormInput) => Promise<void>;
  onCancelCreate?: () => void;
  onRunNow?: (taskId: string) => void;
}

export function ScheduleDetailPanel({
  task,
  runs,
  errorMessage,
  createDraft,
  onCreateTask,
  onCancelCreate,
  onRunNow,
}: ScheduleDetailPanelProps): JSX.Element {
  if (!task) {
    return (
      <section className="flex min-h-0 flex-1 flex-col px-6 py-8">
        {errorMessage ? (
          <p className="text-destructive mb-4 text-sm" role="alert">
            {errorMessage}
          </p>
        ) : null}
        <ScheduledTaskForm
          mode="create"
          initialValue={null}
          draftValue={createDraft ?? null}
          onSubmit={onCreateTask}
          onCancel={onCancelCreate ?? (() => {})}
        />
      </section>
    );
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-8">
      <div className="flex items-start justify-between gap-4 border-b pb-4">
        <div>
          <h2 className="text-sm font-semibold">{task.name}</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            {task.description || task.workspacePath}
          </p>
          <p className="text-muted-foreground mt-2 text-xs">
            {task.schedule.type} • {task.schedule.cron ?? "No cron configured"}
          </p>
        </div>
        {onRunNow ? (
          <button type="button" className="text-sm font-medium" onClick={() => onRunNow(task.id)}>
            Run now
          </button>
        ) : null}
      </div>

      <div className="space-y-4 py-4 text-sm">
        {errorMessage ? (
          <p className="text-destructive text-sm" role="alert">
            {errorMessage}
          </p>
        ) : null}

        <div>
          <h3 className="font-medium">Prompt</h3>
          <p className="text-muted-foreground mt-1 whitespace-pre-wrap">{task.prompt}</p>
        </div>

        <div>
          <h3 className="font-medium">Latest runs</h3>
          {runs.length === 0 ? (
            <p className="text-muted-foreground mt-1 text-sm">No runs yet.</p>
          ) : (
            <div className="mt-2 space-y-2">
              {runs.map((run) => (
                <div key={run.runId} className="rounded-md border px-3 py-2 text-xs">
                  <div className="font-medium">{run.status}</div>
                  <div className="text-muted-foreground">
                    {run.reason} • {run.scheduledFor ?? "manual"}
                  </div>
                  {run.errorSummary ? (
                    <div className="text-destructive mt-1">{run.errorSummary}</div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
