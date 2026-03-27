import type { TaskStore } from "./task-store";
import type { TaskThreadMessage } from "./tasks";

const SYSTEM_TIMELINE_LABELS: Array<{ match: string; label: string }> = [
  { match: "task started", label: "Started" },
  { match: "awaiting approval", label: "Approval requested" },
  { match: "waiting for approval", label: "Approval requested" },
  { match: "approval granted", label: "Approval granted" },
  { match: "approval rejected", label: "Approval rejected" },
  { match: "blocked", label: "Blocked" },
  { match: "retry started", label: "Retry started" },
  { match: "resumed", label: "Resumed" },
  { match: "completed successfully", label: "Completed" },
];

export function appendTaskThreadMessage(
  store: TaskStore,
  taskId: string,
  message: Omit<TaskThreadMessage, "id" | "createdAt"> & {
    id?: string;
    createdAt?: string;
  },
) {
  return store.appendTaskThreadMessage(taskId, message);
}

export function appendTaskSystemMessage(
  store: TaskStore,
  taskId: string,
  text: string,
) {
  return appendTaskThreadMessage(store, taskId, {
    role: "system",
    text,
  });
}

export function getTaskThreadEntryLabel(message: TaskThreadMessage): string {
  if (message.role === "assistant") {
    return "Assistant";
  }

  if (message.role === "user") {
    return "User";
  }

  const normalizedText = message.text.toLowerCase();
  const matchedLabel = SYSTEM_TIMELINE_LABELS.find(({ match }) =>
    normalizedText.includes(match),
  );

  return matchedLabel?.label ?? "System";
}
