import type { JSX } from "react";
import { useState } from "react";

import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@acme/ui/components/tabs";

import type { TaskRecord } from "../lib/tasks";
import { SessionDiffPanel } from "./session-diff-panel";
import { TaskActionBar } from "./task-action-bar";
import { TaskOverviewPanel } from "./task-overview-panel";
import { TaskThreadPanel } from "./task-thread-panel";

interface TaskDetailPanelProps {
  task: TaskRecord;
  onStartTask?: (taskId: string) => void;
  onApproveTask?: (taskId: string) => void;
  onRejectTask?: (taskId: string) => void;
  onRetryTask?: (taskId: string) => void;
  onResumeTask?: (taskId: string) => void;
  onRerunTask?: (taskId: string) => void;
}

type TaskDetailTab = "overview" | "thread" | "changes";

interface TaskDetailTabDefinition {
  value: TaskDetailTab;
  label: string;
  content: JSX.Element;
}

const TASK_DETAIL_TABS = new Set<TaskDetailTab>([
  "overview",
  "thread",
  "changes",
]);

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

function isTaskDetailTab(value: string): value is TaskDetailTab {
  return TASK_DETAIL_TABS.has(value as TaskDetailTab);
}

function getTaskHeaderSubtitle(task: TaskRecord): string {
  return `${getRunnerLabel(task)} · ${task.status} · ${task.currentStage ?? "Pending"}`;
}

function getTaskDetailTabs(task: TaskRecord): TaskDetailTabDefinition[] {
  return [
    {
      value: "overview",
      label: "Overview",
      content: <TaskOverviewPanel task={task} />,
    },
    {
      value: "thread",
      label: "Thread",
      content: <TaskThreadPanel task={task} />,
    },
    {
      value: "changes",
      label: "Changes",
      content: (
        <SessionDiffPanel
          state="ready"
          status={{
            branch: null,
            changedFiles: [],
            isGitRepo: false,
            totalChanged: 0,
            worktreeLabel: null,
          }}
          diff={null}
          selectedPath={null}
          onSelectFile={() => void 0}
        />
      ),
    },
  ];
}

export function TaskDetailPanel({
  task,
  onStartTask,
  onApproveTask,
  onRejectTask,
  onRetryTask,
  onResumeTask,
  onRerunTask,
}: TaskDetailPanelProps): JSX.Element {
  const [activeTab, setActiveTab] = useState<TaskDetailTab>("overview");
  const tabs = getTaskDetailTabs(task);

  return (
    <section className="flex h-full flex-col overflow-hidden">
      <header className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">{task.title}</h2>
          <p className="text-muted-foreground mt-1 text-xs">
            {getTaskHeaderSubtitle(task)}
          </p>
        </div>
      </header>
      <TaskActionBar
        task={task}
        onStartTask={onStartTask}
        onApproveTask={onApproveTask}
        onRejectTask={onRejectTask}
        onRetryTask={onRetryTask}
        onResumeTask={onResumeTask}
        onRerunTask={onRerunTask}
      />

      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          if (isTaskDetailTab(value)) {
            setActiveTab(value);
          }
        }}
        className="flex min-h-0 flex-1 flex-col"
      >
        <TabsList className="border-b px-4 py-2">
          {tabs.map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className="px-3 py-1 text-xs"
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {tabs.map((tab) => (
          <TabsContent
            key={tab.value}
            value={tab.value}
            className="min-h-0 flex-1 overflow-auto"
          >
            {tab.content}
          </TabsContent>
        ))}
      </Tabs>
    </section>
  );
}
