import type { FormEvent, JSX } from "react";
import { useEffect, useState } from "react";

import { Button } from "@acme/ui/components/button";
import { Input } from "@acme/ui/components/input";
import { Modal } from "@acme/ui/components/modal";
import { Select } from "@acme/ui/components/select";
import { Switch } from "@acme/ui/components/switch";
import { Textarea } from "@acme/ui/components/textarea";

import {
  type ScheduledSyncTemplate,
  type ScheduledTaskDefinition,
  SCHEDULED_TASK_ENGINE_SUPPORTED_SCHEDULE_TYPES,
} from "../domain/scheduled-tasks";

export interface ScheduledTaskFormInput {
  name: string;
  description: string;
  workspacePath: string;
  prompt: string;
  frequency: ScheduledTaskDefinition["schedule"]["type"];
  cron: string | null;
  worktreeEnabled: boolean;
  template?: ScheduledSyncTemplate | null;
}

interface ScheduledTaskFormProps {
  mode: "create" | "edit";
  initialValue: ScheduledTaskDefinition | null;
  draftValue?: ScheduledTaskFormInput | null;
  onSubmit: (input: ScheduledTaskFormInput) => void | Promise<void>;
  onCancel: () => void;
  onRegenerateTemplate?: (
    input: ScheduledTaskFormInput,
  ) => ScheduledTaskFormInput | Promise<ScheduledTaskFormInput>;
}

const frequencyOptions = SCHEDULED_TASK_ENGINE_SUPPORTED_SCHEDULE_TYPES.map((value) => ({
  value,
  label: value.charAt(0).toUpperCase() + value.slice(1),
}));

function getInitialFormValue(
  initialValue: ScheduledTaskDefinition | null,
  draftValue: ScheduledTaskFormInput | null,
): {
  name: string;
  description: string;
  workspacePath: string;
  prompt: string;
  frequency: ScheduledTaskDefinition["schedule"]["type"];
  cron: string;
  worktreeEnabled: boolean;
  template: ScheduledSyncTemplate | null;
} {
  return {
    name: initialValue?.name ?? draftValue?.name ?? "",
    description: initialValue?.description ?? draftValue?.description ?? "",
    workspacePath: initialValue?.workspacePath ?? draftValue?.workspacePath ?? "",
    prompt: initialValue?.prompt ?? draftValue?.prompt ?? "",
    frequency: initialValue?.schedule.type ?? draftValue?.frequency ?? "daily",
    cron: initialValue?.schedule.cron ?? draftValue?.cron ?? "",
    worktreeEnabled:
      initialValue?.worktree.enabled ?? draftValue?.worktreeEnabled ?? false,
    template: initialValue?.template ?? draftValue?.template ?? null,
  };
}

function getSubmitButtonLabel(
  mode: ScheduledTaskFormProps["mode"],
  isSubmitting: boolean,
): string {
  if (isSubmitting) {
    return mode === "create" ? "Creating..." : "Saving...";
  }

  return mode === "create" ? "Create schedule" : "Save changes";
}

function parseDailyCron(input: string): { minute: number; hour: number } | null {
  const match = input.match(/^(\d{1,2}) (\d{1,2}) \* \* \*$/);

  if (!match) {
    return null;
  }

  return {
    minute: Number(match[1]),
    hour: Number(match[2]),
  };
}

function getTemplateManagedFields(input: {
  name: string;
  description: string;
  workspacePath: string;
  prompt: string;
}) {
  return {
    name: input.name,
    description: input.description,
    workspacePath: input.workspacePath,
    prompt: input.prompt,
  };
}

function getTemplateFieldConflicts(input: {
  current: ReturnType<typeof getTemplateManagedFields>;
  baseline: ReturnType<typeof getTemplateManagedFields>;
  regenerated: ReturnType<typeof getTemplateManagedFields>;
}): Array<{
  field: keyof ReturnType<typeof getTemplateManagedFields>;
  label: string;
  currentValue: string;
  regeneratedValue: string;
}> {
  const fieldLabels: Record<keyof ReturnType<typeof getTemplateManagedFields>, string> = {
    name: "Name",
    description: "Description",
    workspacePath: "Workspace path",
    prompt: "Prompt",
  };

  return (Object.keys(fieldLabels) as Array<keyof typeof fieldLabels>)
    .filter((field) => input.baseline[field] !== input.regenerated[field])
    .filter((field) => input.current[field] !== input.baseline[field])
    .filter((field) => input.current[field] !== input.regenerated[field])
    .map((field) => ({
      field,
      label: fieldLabels[field],
      currentValue: input.current[field],
      regeneratedValue: input.regenerated[field],
    }));
}

export function ScheduledTaskForm({
  mode,
  initialValue,
  draftValue = null,
  onSubmit,
  onCancel,
  onRegenerateTemplate,
}: ScheduledTaskFormProps): JSX.Element {
  const [formValue, setFormValue] = useState(() =>
    getInitialFormValue(initialValue, draftValue),
  );
  const [templateBaseline, setTemplateBaseline] = useState(() =>
    getTemplateManagedFields(getInitialFormValue(initialValue, draftValue)),
  );
  const [pendingRegeneratedValue, setPendingRegeneratedValue] =
    useState<ScheduledTaskFormInput | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    const nextValue = getInitialFormValue(initialValue, draftValue);
    setFormValue(nextValue);
    setTemplateBaseline(getTemplateManagedFields(nextValue));
    setPendingRegeneratedValue(null);
    setSubmitError(null);
  }, [mode, initialValue?.id, draftValue]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedCron = formValue.cron.trim();
    const parsedCron = parseDailyCron(trimmedCron);

    if (!parsedCron) {
      setSubmitError("Cron expression must look like 0 9 * * * for a daily schedule");
      return;
    }

    if (parsedCron.minute > 59 || parsedCron.hour > 23) {
      setSubmitError("Cron expression must use minute 0-59 and hour 0-23");
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
        template: formValue.template,
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

  const applyRegeneratedValue = (regenerated: ScheduledTaskFormInput) => {
    setFormValue((current) => ({
      ...current,
      name: regenerated.name,
      description: regenerated.description,
      workspacePath: regenerated.workspacePath,
      prompt: regenerated.prompt,
      template: regenerated.template ?? null,
    }));
    setTemplateBaseline(getTemplateManagedFields(regenerated));
    setPendingRegeneratedValue(null);
  };

  const handleRegenerateTemplate = async () => {
    if (!onRegenerateTemplate || !formValue.template) {
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const regenerated = await onRegenerateTemplate(formValue);
      const conflicts = getTemplateFieldConflicts({
        current: getTemplateManagedFields(formValue),
        baseline: templateBaseline,
        regenerated: getTemplateManagedFields(regenerated),
      });

      if (conflicts.length > 0) {
        setPendingRegeneratedValue(regenerated);
        return;
      }

      applyRegeneratedValue(regenerated);
    } catch (error) {
      console.error("Failed to regenerate scheduled task template:", error);
      setSubmitError(
        error instanceof Error ? error.message : "Failed to regenerate scheduled task prompt",
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

      <div className="flex flex-col gap-1 text-sm">
        <div className="flex items-center justify-between gap-2">
          <label className="font-medium" htmlFor="scheduled-task-prompt">
            Prompt
          </label>
          {formValue.template && onRegenerateTemplate ? (
            <Button
              type="button"
              variant="outlined"
              onClick={() => void handleRegenerateTemplate()}
              disabled={isSubmitting}
            >
              Regenerate prompt
            </Button>
          ) : null}
        </div>
        <Textarea
          id="scheduled-task-prompt"
          aria-label="Prompt"
          className="min-h-28"
          value={formValue.prompt}
          onChange={(event) =>
            setFormValue((current) => ({ ...current, prompt: event.target.value }))
          }
          placeholder="Tell Atelier what to do when this schedule runs"
        />
      </div>

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

      <Modal
        open={pendingRegeneratedValue !== null}
        title="Review regenerated fields"
        description="Template regeneration found differences against fields you edited manually. Review them before applying."
        onCancel={() => setPendingRegeneratedValue(null)}
        footer={
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outlined"
              onClick={() => setPendingRegeneratedValue(null)}
            >
              Keep manual edits
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (pendingRegeneratedValue) {
                  applyRegeneratedValue(pendingRegeneratedValue);
                }
              }}
            >
              Apply regenerated fields
            </Button>
          </div>
        }
      >
        {pendingRegeneratedValue ? (
          <div className="space-y-3 px-1 py-1 text-sm">
            {getTemplateFieldConflicts({
              current: getTemplateManagedFields(formValue),
              baseline: templateBaseline,
              regenerated: getTemplateManagedFields(pendingRegeneratedValue),
            }).map((conflict) => (
              <div key={conflict.field} className="rounded-md border p-3">
                <div className="font-medium">{conflict.label}</div>
                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  <div>
                    <div className="text-muted-foreground text-xs font-medium">Manual</div>
                    <p className="mt-1 whitespace-pre-wrap wrap-break-word">{conflict.currentValue}</p>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-xs font-medium">Regenerated</div>
                    <p className="mt-1 whitespace-pre-wrap wrap-break-word">{conflict.regeneratedValue}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </Modal>

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={isSubmitting}>
          {getSubmitButtonLabel(mode, isSubmitting)}
        </Button>
        <Button type="button" variant="outlined" onClick={onCancel} disabled={isSubmitting}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
