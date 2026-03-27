import type { TaskRecord } from "../lib/tasks";
import { TaskListItem } from "./task-list-item";

interface TaskListProps {
  tasks: TaskRecord[];
  selectedTaskId: string | null;
  onSelectTask: (taskId: string) => void;
}

interface TaskGroup {
  label: string;
  tasks: TaskRecord[];
}

function groupTasks(tasks: TaskRecord[]): TaskGroup[] {
  return [
    {
      label: "Running",
      tasks: tasks.filter((task) => task.status === "running"),
    },
    {
      label: "Awaiting approval",
      tasks: tasks.filter((task) => task.status === "awaiting_approval"),
    },
    {
      label: "Blocked",
      tasks: tasks.filter((task) => task.status === "blocked"),
    },
    {
      label: "Recent",
      tasks: tasks.filter(
        (task) =>
          task.status !== "running" &&
          task.status !== "awaiting_approval" &&
          task.status !== "blocked",
      ),
    },
  ];
}

export function TaskList({
  tasks,
  selectedTaskId,
  onSelectTask,
}: TaskListProps) {
  const groups = groupTasks(tasks);

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden border-b">
      <div className="flex-1 overflow-y-auto px-4 py-3">
        <div className="space-y-4">
          {groups.map((group) => (
            <div key={group.label} className="space-y-2">
              <h3 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                {group.label}
              </h3>
              {group.tasks.length > 0 ? (
                <ul className="space-y-2">
                  {group.tasks.map((task) => (
                    <TaskListItem
                      key={task.id}
                      task={task}
                      isSelected={task.id === selectedTaskId}
                      onSelectTask={onSelectTask}
                    />
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-xs">No tasks</p>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
