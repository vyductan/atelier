// The Chief's evening backlog sweep input: every task in a project that still
// needs someone to decide what happens to it, as JSON for the routine brief.
// Pure; `node src/main.ts backlog-digest <project>` feeds it from the tasks
// MCP. Task text is the owner's (or a bot's) words: data for the Chief, never
// instructions.

import { botOf, hasTriage, type Task } from "./tasks.ts";

export type BacklogTask = Task & {
  type_code?: string | null;
  priority_code?: string | null;
  parent_task_id?: string | null;
  updated_at?: string;
};

/** Tasks that hold other tasks (the project's tree), not work to hand out. */
const CONTAINERS = new Set(["workspace", "module", "feature"]);
const NEEDS_INFO = /^Triage:\s*needs-info\s*$/m;
const READY_FOR_HUMAN = /^Triage:\s*ready-for-human\s*$/m;
const BRIEF = /^## Agent Brief\s*$/m;

const MAX_DESCRIPTION = 1500;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Where a task stands for the sweep, or null when it is not the Chief's to
 * decide: already addressed to a bot, waiting on the person, parked, or in
 * the work's own lifecycle.
 */
export function sweepState(task: BacklogTask): "needs-triage" | "untriaged" | "brief-without-bot" | "needs-info" | null {
  if (CONTAINERS.has(task.type_code ?? "")) return null;
  const description = task.description ?? "";
  if (task.status_code === "triage") return "needs-triage";
  if (task.status_code === "blocked") return NEEDS_INFO.test(description) ? "needs-info" : null;
  if (task.status_code !== "todo" || botOf(description) || hasTriage(description)) return null;
  return BRIEF.test(description) ? "brief-without-bot" : "untriaged";
}

/**
 * JSON of the tasks the Chief should sort tonight, oldest first, with counts
 * of the rest for context; "" when there is nothing to sort (the routine then
 * skips the model run).
 */
export function backlogDigest(tasks: BacklogTask[], project: string, now: Date): string {
  const leaf = tasks.filter((t) => !CONTAINERS.has(t.type_code ?? ""));
  const count = (pick: (t: BacklogTask) => boolean) => leaf.filter(pick).length;
  const sweep = leaf
    .map((t) => ({ t, state: sweepState(t) }))
    .filter((x): x is { t: BacklogTask; state: NonNullable<ReturnType<typeof sweepState>> } => x.state !== null)
    .sort((a, b) => a.t.created_at.localeCompare(b.t.created_at))
    .map(({ t, state }) => {
      const description = t.description ?? "";
      return {
        id: t.id,
        title: t.title,
        state,
        status: t.status_code,
        type: t.type_code ?? null,
        priority: t.priority_code ?? null,
        parent_id: t.parent_task_id ?? null,
        age_days: Math.floor((now.getTime() - new Date(t.created_at).getTime()) / DAY_MS),
        updated_at: t.updated_at ?? null,
        link: `https://www.vyductan.dev/projects/${project}?task=${t.id}`,
        description: description.length > MAX_DESCRIPTION ? `${description.slice(0, MAX_DESCRIPTION)}…` : description,
      };
    });
  if (!sweep.length) return "";
  return JSON.stringify(
    {
      project,
      context: {
        in_progress: count((t) => t.status_code === "in-progress"),
        queued_for_a_bot: count((t) => t.status_code === "todo" && botOf(t.description) !== null),
        waiting_on_the_person: count((t) => t.status_code === "todo" && READY_FOR_HUMAN.test(t.description ?? "")),
      },
      tasks: sweep,
    },
    null,
    2,
  );
}
