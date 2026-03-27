import type { JSX } from "react";

import type { TaskRecord } from "../lib/tasks";

interface TaskOverviewPanelProps {
  task: TaskRecord;
}

interface TaskMetadataItem {
  label: string;
  value: string;
}

interface TaskDetailItem {
  heading: string;
  body: string | null;
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

function getTaskMetadata(task: TaskRecord): TaskMetadataItem[] {
  return [
    { label: "Runner", value: getRunnerLabel(task) },
    { label: "Status", value: task.status },
    { label: "Stage", value: task.currentStage ?? "Pending" },
    { label: "Updated", value: task.updatedAt },
  ];
}

function getTaskDetails(task: TaskRecord): TaskDetailItem[] {
  return [
    { heading: "Summary", body: task.summary },
    { heading: "Blocked reason", body: task.blockedReason },
    { heading: "Approval request", body: task.approvalRequest },
    { heading: "Last error", body: task.lastErrorSummary },
  ];
}

function renderTaskDetailSection(detail: TaskDetailItem): JSX.Element | null {
  if (!detail.body) {
    return null;
  }

  return (
    <div key={detail.heading}>
      <h4 className="text-xs font-medium">{detail.heading}</h4>
      <p className="text-muted-foreground mt-1 text-xs">{detail.body}</p>
    </div>
  );
}

export function TaskOverviewPanel({
  task,
}: TaskOverviewPanelProps): JSX.Element {
  const metadata = getTaskMetadata(task);
  const details = getTaskDetails(task);

  return (
    <section className="space-y-3 px-4 py-3">
      <div>
        <h3 className="text-sm font-semibold">Task overview</h3>
        <p className="text-muted-foreground mt-1 text-xs">{task.prompt}</p>
      </div>
      <dl className="grid grid-cols-2 gap-3 text-xs">
        {metadata.map((item) => (
          <div key={item.label}>
            <dt className="text-muted-foreground">{item.label}</dt>
            <dd>{item.value}</dd>
          </div>
        ))}
      </dl>
      {details.map((detail) => renderTaskDetailSection(detail))}
    </section>
  );
}
