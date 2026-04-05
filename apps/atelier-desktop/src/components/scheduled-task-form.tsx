import type { FormEvent, JSX } from "react";
import { useEffect, useState } from "react";

import { Button } from "@acme/ui/components/button";
import { Input } from "@acme/ui/components/input";
import { Select } from "@acme/ui/components/select";
import { Switch } from "@acme/ui/components/switch";
import { Textarea } from "@acme/ui/components/textarea";

import {
  type ScheduledTaskDefinition,
  SCHEDULED_TASK_ENGINE_SUPPORTED_SCHEDULE_TYPES,
} from "../lib/scheduled-tasks";

export interface ScheduledTaskFormInput {
  name: string;
  description: string;
  workspacePath: string;
  prompt: string;
  frequency: ScheduledTaskDefinition["schedule"]["type"];
  cron: string | null;
  worktreeEnabled: boolean;
}

interface ScheduledTaskFormProps {
  mode: "create" | "edit";
  initialValue: ScheduledTaskDefinition | null;
  draftValue?: ScheduledTaskFormInput | null;
  onSubmit: (input: ScheduledTaskFormInput) => void | Promise<void>;
  onCancel: () => void;
}

const frequencyOptions = SCHEDULED_TASK_ENGINE_SUPPORTED_SCHEDULE_TYPES.map((value) => ({
  value,
  label: value.charAt(0).toUpperCase() + value.slice(1),
}));

function getInitialFormValue(
  initialValue: ScheduledTaskDefinition | null,
  draftValue: ScheduledTaskFormInput | null,
) {
  return {
    name: initialValue?.name ?? draftValue?.name ?? "",
    description: initialValue?.description ?? draftValue?.description ?? "",
    workspacePath: initialValue?.workspacePath ?? draftValue?.workspacePath ?? "",
    prompt: initialValue?.prompt ?? draftValue?.prompt ?? "",
    frequency: initialValue?.schedule.type ?? draftValue?.frequency ?? "daily",
    cron: initialValue?.schedule.cron ?? draftValue?.cron ?? "",
    worktreeEnabled:
      initialValue?.worktree.enabled ?? draftValue?.worktreeEnabled ?? false,
  } satisfies {
    name: string;
    description: string;
    workspacePath: string;
    prompt: string;
    frequency: ScheduledTaskDefinition["schedule"]["type"];
    cron: string;
    worktreeEnabled: boolean;
  };
}

export function ScheduledTaskForm({
  mode,
  initialValue,
  draftValue = null,
  onSubmit,
  onCancel,
}: ScheduledTaskFormProps): JSX.Element {
  const [formValue, setFormValue] = useState(() =>
    getInitialFormValue(initialValue, draftValue),
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    setFormValue(getInitialFormValue(initialValue, draftValue));
    setSubmitError(null);
  }, [mode, initialValue?.id, draftValue]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedCron = formValue.cron.trim();

    if (!/^\d{1,2} \d{1,2} \* \* \*$/.test(trimmedCron)) {
      setSubmitError("Cron expression must look like 0 9 * * * for a daily schedule");
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      await onSubmit({
        name: formValue.name,
        description: formValue.description,
        workspacePath: formValue.workspacePath,
        prompt: formValue.prompt,
        frequency: formValue.frequency,
        cron: trimmedCron,
        worktreeEnabled: formValue.worktreeEnabled,
      });
    } catch (error) {
      console.error("Failed to submit scheduled task form:", error);
      setSubmitError(
        error instanceof Error ? error.message : "Failed to save scheduled task",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <div>
        <h2 className="text-sm font-semibold">
          {mode === "create" ? "Create scheduled task" : "Edit scheduled task"}
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Configure the task prompt, frequency, and workspace behavior.
        </p>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Name</span>
        <Input
          aria-label="Name"
          value={formValue.name}
          onChange={(event) =>
            setFormValue((current) => ({ ...current, name: event.target.value }))
          }
          placeholder="Daily workspace check-in"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Description</span>
        <Input
          aria-label="Description"
          value={formValue.description}
          onChange={(event) =>
            setFormValue((current) => ({
              ...current,
              description: event.target.value,
            }))
          }
          placeholder="Optional context for this schedule"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Workspace path</span>
        <Input
          aria-label="Workspace path"
          value={formValue.workspacePath}
          onChange={(event) =>
            setFormValue((current) => ({
              ...current,
              workspacePath: event.target.value,
            }))
          }
          placeholder="/Users/example/project"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Prompt</span>
        <Textarea
          aria-label="Prompt"
          className="min-h-28"
          value={formValue.prompt}
          onChange={(event) =>
            setFormValue((current) => ({ ...current, prompt: event.target.value }))
          }
          placeholder="Tell Atelier what to do when this schedule runs"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Frequency</span>
        <div className="w-full max-w-56">
          <Select
            aria-label="Frequency"
            value={formValue.frequency}
            options={frequencyOptions}
            onChange={(value) =>
              setFormValue((current) => ({
                ...current,
                frequency: value as ScheduledTaskDefinition["schedule"]["type"],
              }))
            }
          />
        </div>
        <p className="text-muted-foreground text-xs">
          V1 currently supports daily schedules with a fixed local time.
        </p>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Cron expression</span>
        <Input
          aria-label="Cron expression"
          value={formValue.cron}
          onChange={(event) =>
            setFormValue((current) => ({ ...current, cron: event.target.value }))
          }
          placeholder="0 9 * * *"
        />
        <p className="text-muted-foreground text-xs">
          Use standard daily cron like 0 9 * * * for a 9:00 local run.
        </p>
      </label>

      <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
        <div>
          <label className="text-sm font-medium" htmlFor="scheduled-task-worktree-toggle">
            Worktree enabled
          </label>
          <p className="text-muted-foreground text-xs">
            Enable worktree isolation for scheduled runs that mutate git state.
          </p>
        </div>
        <Switch
          checked={formValue.worktreeEnabled}
          onChange={(checked) =>
            setFormValue((current) => ({
              ...current,
              worktreeEnabled: checked,
            }))
          }
          id="scheduled-task-worktree-toggle"
          aria-label="Worktree enabled"
        />
      </div>

      {submitError ? (
        <p className="text-destructive text-sm" role="alert">
          {submitError}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting
            ? mode === "create"
              ? "Creating..."
              : "Saving..."
            : mode === "create"
              ? "Create schedule"
              : "Save changes"}
        </Button>
        <Button type="button" variant="outlined" onClick={onCancel} disabled={isSubmitting}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
