import type { ComponentPropsWithoutRef, PropsWithChildren } from "react";
import type { Root } from "react-dom/client";
import { act, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTaskStore } from "../lib/task-store";
import { TaskCreateBar } from "./task-create-bar";
import { TaskList } from "./task-list";

// @vitest-environment jsdom

vi.mock("@acme/ui/components/button", () => ({
  Button: ({
    children,
    onClick,
    type = "button",
    ...props
  }: PropsWithChildren<ComponentPropsWithoutRef<"button">>) => (
    <button type={type} onClick={onClick} {...props}>
      {children}
    </button>
  ),
}));

vi.mock("@acme/ui/components/input", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@acme/ui/components/input")>();

  return {
    ...actual,
    Input: (props: ComponentPropsWithoutRef<"input">) => <input {...props} />,
  };
});

function setNativeInputValue(element: HTMLInputElement, value: string) {
  const prototype = Object.getPrototypeOf(element) as HTMLInputElement;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");

  descriptor?.set?.call(element, value);
}

function TaskWorkbenchHarness() {
  const [store] = useState(() => createTaskStore());
  const [tasks, setTasks] = useState(() =>
    store.listTasksByWorkspace("workspace-1"),
  );

  return (
    <div>
      <TaskCreateBar
        workspaceName="Alpha"
        onCreateTask={async (input) => {
          await store.createTask({
            workspaceId: "workspace-1",
            prompt: input.prompt,
            runnerPreference: input.runnerPreference,
          });
          setTasks(store.listTasksByWorkspace("workspace-1"));
        }}
      />
      <TaskList
        tasks={tasks}
        selectedTaskId={null}
        onSelectTask={() => void 0}
      />
    </div>
  );
}

describe("Task task workbench UI", () => {
  let container: HTMLDivElement | null;
  let root: Root | null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
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

  it("creates a task from the workspace task bar", async () => {
    flushSync(() => {
      root?.render(<TaskWorkbenchHarness />);
    });

    const promptInput = container?.querySelector(
      'input[placeholder="Ask Atelier to work on this workspace"]',
    ) as HTMLInputElement | null;
    const claudeButton = [
      ...(container?.querySelectorAll("button") ?? []),
    ].find((button) => button.textContent?.includes("Claude")) as
      | HTMLButtonElement
      | undefined;
    const createButton = [
      ...(container?.querySelectorAll("button") ?? []),
    ].find((button) => button.textContent?.includes("Create task")) as
      | HTMLButtonElement
      | undefined;

    flushSync(() => {
      if (promptInput) {
        setNativeInputValue(promptInput, "implement english learning speaking");
        promptInput.dispatchEvent(new Event("input", { bubbles: true }));
        promptInput.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });

    flushSync(() => {
      claudeButton?.click();
    });

    await act(async () => {
      createButton?.click();
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(container?.textContent).toContain(
        "implement english learning speaking",
      );
    });
    expect(container?.textContent).toContain("Claude");
    expect(container?.textContent).toContain("Recent");
  });

  it("groups tasks by basic status buckets", () => {
    flushSync(() => {
      root?.render(
        <TaskList
          selectedTaskId={null}
          onSelectTask={() => void 0}
          tasks={[
            {
              id: "task-1",
              workspaceId: "workspace-1",
              title: "Implement feature",
              prompt: "Implement feature",
              status: "running",
              runnerPreference: "auto",
              resolvedRunner: null,
              currentStage: "coding",
              blockedReason: null,
              approvalRequest: null,
              lastErrorSummary: null,
              createdAt: "2026-03-11T00:00:00.000Z",
              updatedAt: "2026-03-11T00:00:01.000Z",
              summary: null,
              thread: [],
            },
            {
              id: "task-2",
              workspaceId: "workspace-1",
              title: "Need approval",
              prompt: "Need approval",
              status: "awaiting_approval",
              runnerPreference: "claude",
              resolvedRunner: "claude",
              currentStage: "approval",
              blockedReason: null,
              approvalRequest: null,
              lastErrorSummary: null,
              createdAt: "2026-03-11T00:00:00.000Z",
              updatedAt: "2026-03-11T00:00:02.000Z",
              summary: null,
              thread: [],
            },
            {
              id: "task-3",
              workspaceId: "workspace-1",
              title: "Blocked task",
              prompt: "Blocked task",
              status: "blocked",
              runnerPreference: "openclaw",
              resolvedRunner: "openclaw",
              currentStage: "waiting",
              blockedReason: null,
              approvalRequest: null,
              lastErrorSummary: null,
              createdAt: "2026-03-11T00:00:00.000Z",
              updatedAt: "2026-03-11T00:00:03.000Z",
              summary: null,
              thread: [],
            },
            {
              id: "task-4",
              workspaceId: "workspace-1",
              title: "Queued task",
              prompt: "Queued task",
              status: "queued",
              runnerPreference: "auto",
              resolvedRunner: null,
              currentStage: null,
              blockedReason: null,
              approvalRequest: null,
              lastErrorSummary: null,
              createdAt: "2026-03-11T00:00:00.000Z",
              updatedAt: "2026-03-11T00:00:04.000Z",
              summary: null,
              thread: [],
            },
          ]}
        />,
      );
    });

    expect(container?.textContent).toContain("Running");
    expect(container?.textContent).toContain("Awaiting approval");
    expect(container?.textContent).toContain("Blocked");
    expect(container?.textContent).toContain("Recent");
  });
});
