import type { JSX } from "react";

import type { ScheduledTaskDefinition } from "../domain/scheduled-tasks";
import { ScheduleListItem } from "~/components/schedule-list-item";

interface ScheduleSidebarProps {
  tasks: ScheduledTaskDefinition[];
  selectedTaskId: string | null;
  onSelectTask: (taskId: string) => void;
  onRunNow: (taskId: string) => void;
}

function getTaskSubtitle(task: ScheduledTaskDefinition): string {
  if (task.nextRunAt) {
    return `Next run ${task.nextRunAt}`;
  }

  if (task.schedule.cron) {
    return `${task.schedule.type} • ${task.schedule.cron}`;
  }

  return task.description || task.workspacePath;
}

export function ScheduleSidebar({
  tasks,
  selectedTaskId,
  onSelectTask,
  onRunNow,
}: ScheduleSidebarProps): JSX.Element {
  return (
    <aside className="flex h-full w-80 shrink-0 flex-col border-r">
      <header className="border-b px-4 py-3">
        <h2 className="text-sm font-semibold">Scheduled tasks</h2>
        <p className="text-muted-foreground mt-1 text-xs">
          Your recurring automations appear here.
        </p>
      </header>
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {tasks.length === 0 ? (
          <ScheduleListItem
            title="No scheduled tasks yet"
            subtitle="Create a schedule to populate this list."
          />
        ) : (
          tasks.map((task) => (
            <ScheduleListItem
              key={task.id}
              title={task.name}
              subtitle={getTaskSubtitle(task)}
              statusLabel={task.engineState}
              isSelected={task.id === selectedTaskId}
              onClick={() => onSelectTask(task.id)}
              onRunNow={() => onRunNow(task.id)}
            />
          ))
        )}
      </div>
    </aside>
  );
}
