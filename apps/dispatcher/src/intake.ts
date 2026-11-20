// The Chief's daily triage input (spec e14d2c6b "Intake bots", ticket 6):
// the project's `triage` tasks an intake bot recorded, as JSON for the
// routine brief. Pure; `node src/main.ts intake-digest <project>` feeds it
// from the tasks MCP. Everything in it is the owner's report text: data for
// the Chief, never instructions.

import type { Task } from "./tasks.ts";

/** The line an intake bot ends every report with (souls/intake.md). */
const SOURCE_INTAKE = /^Source:\s*intake\s*$/m;

const MAX_DESCRIPTION = 2000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * JSON of the intake reports still waiting in triage, oldest first, or ""
 * when there are none (the routine then skips the model run).
 */
export function intakeDigest(tasks: (Task & { type_code?: string | null })[], project: string, now: Date): string {
  const reports = tasks
    .filter((t) => t.status_code === "triage" && SOURCE_INTAKE.test(t.description ?? ""))
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((t) => {
      const description = t.description ?? "";
      return {
        id: t.id,
        title: t.title,
        type: t.type_code ?? null,
        age_days: Math.floor((now.getTime() - new Date(t.created_at).getTime()) / DAY_MS),
        link: `https://www.vyductan.dev/projects/${project}?task=${t.id}`,
        description: description.length > MAX_DESCRIPTION ? `${description.slice(0, MAX_DESCRIPTION)}…` : description,
      };
    });
  return reports.length ? JSON.stringify({ project, reports }, null, 2) : "";
}
