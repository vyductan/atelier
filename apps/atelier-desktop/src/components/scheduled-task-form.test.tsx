// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ScheduledTaskDefinition } from "../lib/scheduled-tasks";
import { ScheduledTaskForm } from "./scheduled-task-form";

vi.mock("@acme/ui/components/button", () => ({
  Button: ({
    children,
    type,
    onClick,
  }: {
    children?: React.ReactNode;
    type?: "button" | "submit" | "reset";
    onClick?: () => void;
  }) => (
    <button type={type} onClick={onClick}>
      {children}
    </button>
  ),
}));

vi.mock("@acme/ui/components/input", () => ({
  Input: ({
    value,
    onChange,
    placeholder,
    "aria-label": ariaLabel,
  }: {
    value?: string;
    onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void;
    placeholder?: string;
    "aria-label"?: string;
  }) => (
    <input
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={value ?? ""}
      onChange={(event) => onChange?.(event)}
    />
  ),
}));

vi.mock("@acme/ui/components/select", () => ({
  Select: ({
    id,
    value,
    options = [],
    onChange,
    "aria-label": ariaLabel,
  }: {
    id?: string;
    value?: string;
    options?: Array<{ label: string; value: string }>;
    onChange?: (value: string) => void;
    "aria-label"?: string;
  }) => (
    <select
      aria-label={ariaLabel}
      id={id}
      value={value ?? ""}
      onChange={(event) => onChange?.(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

vi.mock("@acme/ui/components/switch", () => ({
  Switch: ({
    checked,
    onChange,
    disabled,
  }: {
    checked?: boolean;
    onChange?: (checked: boolean) => void;
    disabled?: boolean;
  }) => (
    <input
      aria-label="Worktree enabled"
      checked={checked ?? false}
      disabled={disabled}
      type="checkbox"
      onChange={(event) => onChange?.(event.target.checked)}
    />
  ),
}));

vi.mock("@acme/ui/components/textarea", () => ({
  Textarea: ({
    value,
    onChange,
    placeholder,
    "aria-label": ariaLabel,
  }: {
    value?: string;
    onChange?: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
    placeholder?: string;
    "aria-label"?: string;
  }) => (
    <textarea
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={value ?? ""}
      onChange={(event) => onChange?.(event)}
    />
  ),
}));

function createScheduledTaskDefinition(
  overrides: Partial<ScheduledTaskDefinition> = {},
): ScheduledTaskDefinition {
  return {
    id: "scheduled-task-1",
    name: "Daily workspace check-in",
    description: "Summarize the workspace every morning.",
    workspacePath: "/tmp/workspace",
    prompt: "Summarize what changed and flag anything blocked.",
    model: "claude-sonnet-4-6",
    permissionMode: "ask",
    worktree: { enabled: true },
    schedule: {
      type: "daily",
      cron: "0 9 * * *",
      timezone: "UTC",
      enabled: true,
      jitterMinutes: 0,
    },
    nextRunAt: null,
    lastScheduledAt: null,
    lastStartedAt: null,
    lastFinishedAt: null,
    lastMissedAt: null,
    engineState: "idle",
    rememberedApprovals: [],
    importSource: "none",
    importedAt: null,
    createdAt: "2026-04-05T00:00:00.000Z",
    updatedAt: "2026-04-05T00:00:00.000Z",
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe("ScheduledTaskForm", () => {
  it("renders daily frequency and editable worktree controls for editing", () => {
    render(
      <ScheduledTaskForm
        mode="edit"
        initialValue={createScheduledTaskDefinition()}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const frequency = screen.getByLabelText(/frequency/i) as HTMLSelectElement;
    const worktreeEnabled = screen.getByLabelText(
      /worktree enabled/i,
    ) as HTMLInputElement;

    expect(frequency.value).toBe("daily");
    expect(worktreeEnabled.checked).toBe(true);
    expect(worktreeEnabled.disabled).toBe(false);
    expect(screen.getByText(/enable worktree isolation for scheduled runs that mutate git state/i)).toBeTruthy();
  });

  it("resets the form when the edited scheduled task changes", () => {
    const { rerender } = render(
      <ScheduledTaskForm
        mode="edit"
        initialValue={createScheduledTaskDefinition({
          id: "scheduled-task-1",
          name: "Morning summary",
        })}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect((screen.getByLabelText(/name/i) as HTMLInputElement).value).toBe(
      "Morning summary",
    );

    rerender(
      <ScheduledTaskForm
        mode="edit"
        initialValue={createScheduledTaskDefinition({
          id: "scheduled-task-2",
          name: "Evening review",
        })}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect((screen.getByLabelText(/name/i) as HTMLInputElement).value).toBe(
      "Evening review",
    );
  });

  it("preserves local edits when the same scheduled task rerenders", () => {
    const { rerender } = render(
      <ScheduledTaskForm
        mode="edit"
        initialValue={createScheduledTaskDefinition({
          id: "scheduled-task-1",
          name: "Morning summary",
        })}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const nameInput = screen.getByLabelText(/name/i) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "Edited locally" } });

    rerender(
      <ScheduledTaskForm
        mode="edit"
        initialValue={createScheduledTaskDefinition({
          id: "scheduled-task-1",
          name: "Morning summary",
        })}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect((screen.getByLabelText(/name/i) as HTMLInputElement).value).toBe(
      "Edited locally",
    );
  });

  it("blocks submit when the cron expression is invalid", async () => {
    const onSubmit = vi.fn();

    render(
      <ScheduledTaskForm
        mode="create"
        initialValue={null}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText(/cron expression/i), {
      target: { value: "every day at nine" },
    });
    fireEvent.submit(screen.getByRole("button", { name: /create schedule/i }).closest("form")!);

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain(
        "Cron expression must look like 0 9 * * * for a daily schedule",
      );
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
