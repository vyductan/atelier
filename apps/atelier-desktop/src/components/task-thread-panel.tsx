import type { TaskRecord, TaskThreadMessage } from "../lib/tasks";
import { getTaskThreadEntryLabel } from "../lib/task-thread";

interface TaskThreadPanelProps {
  task: TaskRecord;
}

function getEntryTone(message: TaskThreadMessage): string {
  if (message.role === "assistant") {
    return "border-l-2";
  }

  if (message.role === "user") {
    return "border-l-2";
  }

  return "bg-muted/40 border-l-2";
}

export function TaskThreadPanel({ task }: TaskThreadPanelProps) {
  return (
    <section className="space-y-3 px-4 py-3">
      <div>
        <h3 className="text-sm font-semibold">Task thread</h3>
        <p className="text-muted-foreground mt-1 text-xs">
          Lifecycle events, clarifications, and progress updates for this task.
        </p>
      </div>
      <div className="bg-muted rounded-md border px-3 py-2 text-xs">
        <p className="font-medium">User goal</p>
        <p className="text-muted-foreground mt-1">{task.prompt}</p>
      </div>
      {task.thread.length > 0 ? (
        <div className="space-y-2">
          {task.thread.map((message) => (
            <div
              key={message.id}
              className={`rounded-md border px-3 py-2 text-xs ${getEntryTone(message)}`}
            >
              <p className="font-medium">{getTaskThreadEntryLabel(message)}</p>
              <p className="text-muted-foreground mt-1">{message.text}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground text-xs">No thread messages yet.</p>
      )}
    </section>
  );
}
