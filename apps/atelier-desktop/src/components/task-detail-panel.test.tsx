import type { Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TaskRecord } from "../lib/tasks";
import type { TaskDetailPanel as TaskDetailPanelComponent } from "./task-detail-panel";

// @vitest-environment jsdom

vi.mock("@acme/ui/components/tabs", async () => {
  const React = await import("react");

  const TabsContext = React.createContext<{
    value: string;
    setValue: (value: string) => void;
  } | null>(null);

  return {
    Tabs: ({
      value,
      onValueChange,
      children,
      className,
    }: {
      value: string;
      onValueChange?: (value: string) => void;
      children?: React.ReactNode;
      className?: string;
    }) => {
      const [internalValue, setInternalValue] = React.useState(value);

      React.useEffect(() => {
        setInternalValue(value);
      }, [value]);

      return (
        <TabsContext.Provider
          value={{
            value: internalValue,
            setValue: (nextValue) => {
              setInternalValue(nextValue);
              onValueChange?.(nextValue);
            },
          }}
        >
          <div className={className}>{children}</div>
        </TabsContext.Provider>
      );
    },
    TabsList: ({
      children,
      className,
    }: {
      children?: React.ReactNode;
      className?: string;
    }) => (
      <div data-testid="tabs-list" className={className}>
        {children}
      </div>
    ),
    TabsTrigger: ({
      value,
      children,
      className,
    }: {
      value: string;
      children?: React.ReactNode;
      className?: string;
    }) => {
      const context = React.useContext(TabsContext);
      const isActive = context?.value === value;

      return (
        <button
          type="button"
          role="tab"
          aria-selected={isActive ? "true" : "false"}
          data-state={isActive ? "active" : "inactive"}
          className={className}
          onClick={() => context?.setValue(value)}
        >
          {children}
        </button>
      );
    },
    TabsContent: ({
      value,
      children,
      className,
    }: {
      value: string;
      children?: React.ReactNode;
      className?: string;
    }) => {
      const context = React.useContext(TabsContext);
      const isActive = context?.value === value;

      return (
        <div
          data-slot="tabs-content"
          data-state={isActive ? "active" : "inactive"}
          className={className}
        >
          {children}
        </div>
      );
    },
  };
});

vi.mock("./session-diff-panel", () => ({
  SessionDiffPanel: () => (
    <div data-testid="session-diff-panel">Session diff panel</div>
  ),
}));

function createTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: "task-1",
    workspaceId: "workspace-1",
    title: "Implement english learning speaking",
    prompt: "Implement english learning speaking",
    status: "running",
    runnerPreference: "auto",
    resolvedRunner: "claude",
    currentStage: "coding",
    blockedReason: null,
    approvalRequest: null,
    lastErrorSummary: null,
    createdAt: "2026-03-11T00:00:00.000Z",
    updatedAt: "2026-03-11T00:00:01.000Z",
    summary: "In progress",
    thread: [],
    ...overrides,
  };
}

function getTabByLabel(
  container: HTMLDivElement | null,
  label: string,
): HTMLButtonElement | undefined {
  return [...(container?.querySelectorAll('[role="tab"]') ?? [])].find((tab) =>
    tab.textContent?.includes(label),
  ) as HTMLButtonElement | undefined;
}

function getButtonByLabel(
  container: HTMLDivElement | null,
  label: string,
): HTMLButtonElement | undefined {
  return [...(container?.querySelectorAll("button") ?? [])].find((button) =>
    button.textContent?.includes(label),
  ) as HTMLButtonElement | undefined;
}

describe("TaskDetailPanel", () => {
  let container: HTMLDivElement | null;
  let root: Root | null;
  let TaskDetailPanel: typeof TaskDetailPanelComponent;

  beforeEach(async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    ({ TaskDetailPanel } = await import("./task-detail-panel"));
  });

  afterEach(() => {
    if (root) {
      flushSync(() => {
        root?.unmount();
      });
      root = null;
    }

    container?.remove();
    container = null;
  });

  it("shows task overview by default and switches to changes", () => {
    flushSync(() => {
      root?.render(<TaskDetailPanel task={createTask()} />);
    });

    expect(container?.textContent).toContain(
      "Implement english learning speaking",
    );
    expect(container?.textContent).toContain("Claude");
    expect(container?.textContent).toContain("running");
    expect(container?.textContent).toContain("coding");

    const overviewTab = getTabByLabel(container, "Overview");
    const changesTab = getTabByLabel(container, "Changes");

    expect(overviewTab?.getAttribute("aria-selected")).toBe("true");
    expect(container?.textContent).toContain("Task overview");

    flushSync(() => {
      changesTab?.click();
    });

    expect(
      container?.querySelector('[data-testid="session-diff-panel"]'),
    ).not.toBeNull();
  });

  it("switches to the thread tab", () => {
    flushSync(() => {
      root?.render(
        <TaskDetailPanel
          task={createTask({
            id: "task-2",
            title: "Review PR 128",
            prompt: "Review PR 128",
            status: "queued",
            runnerPreference: "openclaw",
            resolvedRunner: null,
            currentStage: null,
            summary: null,
            thread: [
              {
                id: "message-1",
                role: "system",
                text: "Task started.",
                createdAt: "2026-03-11T00:00:02.000Z",
              },
              {
                id: "message-2",
                role: "system",
                text: "Waiting for approval before applying the patch.",
                createdAt: "2026-03-11T00:00:03.000Z",
              },
              {
                id: "message-3",
                role: "assistant",
                text: "Patch ready for review.",
                createdAt: "2026-03-11T00:00:04.000Z",
              },
            ],
          })}
        />,
      );
    });

    const threadTab = getTabByLabel(container, "Thread");

    flushSync(() => {
      threadTab?.click();
    });

    expect(container?.textContent).toContain("Task thread");
    expect(container?.textContent).toContain("Started");
    expect(container?.textContent).toContain("Approval requested");
    expect(container?.textContent).toContain("Assistant");
    expect(container?.textContent).toContain("Task started.");
    expect(container?.textContent).toContain(
      "Waiting for approval before applying the patch.",
    );
    expect(container?.textContent).toContain("Patch ready for review.");
  });

  it("shows approval actions for awaiting approval tasks", () => {
    flushSync(() => {
      root?.render(
        <TaskDetailPanel
          task={createTask({
            id: "task-3",
            title: "Approve patch",
            prompt: "Approve patch",
            status: "awaiting_approval",
            runnerPreference: "claude",
            resolvedRunner: "claude",
            currentStage: "awaiting approval",
            approvalRequest: "Approve applying the patch.",
            summary: "Patch ready for approval.",
          })}
        />,
      );
    });

    expect(getButtonByLabel(container, "Approve")).not.toBeUndefined();
    expect(getButtonByLabel(container, "Reject")).not.toBeUndefined();
  });

  it("shows retry and resume actions for blocked tasks", () => {
    flushSync(() => {
      root?.render(
        <TaskDetailPanel
          task={createTask({
            id: "task-4",
            title: "Resume rollout",
            prompt: "Resume rollout",
            status: "blocked",
            runnerPreference: "claude",
            resolvedRunner: "claude",
            currentStage: "waiting for window",
            blockedReason: "Waiting for production window.",
            summary: "Paused until rollout window opens.",
          })}
        />,
      );
    });

    expect(getButtonByLabel(container, "Retry")).not.toBeUndefined();
    expect(getButtonByLabel(container, "Resume")).not.toBeUndefined();
  });

  it("shows retry for failed tasks and re-run for done tasks", () => {
    flushSync(() => {
      root?.render(
        <>
          <TaskDetailPanel
            task={createTask({
              id: "task-5",
              title: "Fix failed deploy",
              prompt: "Fix failed deploy",
              status: "failed",
              runnerPreference: "claude",
              resolvedRunner: "claude",
              currentStage: "failed",
              lastErrorSummary: "GitHub API returned 502.",
              summary: "Task failed during deployment.",
            })}
          />
          <TaskDetailPanel
            task={createTask({
              id: "task-6",
              workspaceId: "workspace-2",
              title: "Re-run explanation",
              prompt: "Re-run explanation",
              status: "done",
              runnerPreference: "claude",
              resolvedRunner: "claude",
              currentStage: "completed",
              summary: "Completed successfully.",
            })}
          />
        </>,
      );
    });

    const buttonTexts = [...(container?.querySelectorAll("button") ?? [])].map(
      (button) => button.textContent ?? "",
    );

    expect(buttonTexts.some((text) => text.includes("Retry"))).toBe(true);
    expect(buttonTexts.some((text) => text.includes("Re-run"))).toBe(true);
  });

  it("renders blocked reason, approval request, and last error summary in the overview", () => {
    flushSync(() => {
      root?.render(
        <TaskDetailPanel
          task={createTask({
            id: "task-7",
            title: "Review lifecycle metadata",
            prompt: "Review lifecycle metadata",
            status: "blocked",
            runnerPreference: "claude",
            resolvedRunner: "claude",
            currentStage: "blocked",
            blockedReason: "Waiting for production credentials.",
            approvalRequest: "Approve applying production migration.",
            lastErrorSummary: "Migration checksum mismatch.",
            summary: "Needs operator intervention.",
          })}
        />,
      );
    });

    expect(container?.textContent).toContain(
      "Waiting for production credentials.",
    );
    expect(container?.textContent).toContain(
      "Approve applying production migration.",
    );
    expect(container?.textContent).toContain("Migration checksum mismatch.");
  });
});
