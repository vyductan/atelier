// One dispatcher tick: settle the run in flight, then (only when nothing is in
// flight) hand the oldest eligible task to its bot. All I/O goes through the
// interfaces passed in, so the rules are testable with fakes.
//
// Rules (spec "Atelier Dispatcher"):
// - vyductan-tasks is the record: every hand-off and result lands on the task.
// - ONE run at a time, whatever the bot (OpenMausBot cannot cap work a person
//   sends; AGENTS.md wants model calls sequential anyway).
// - Only tasks in `todo`, with a `Bot: <name>` line naming a configured bot,
//   no `Triage:` line (that marks human work), in a configured project.
// - The bridge never approves anything. A run waiting on an approval card is
//   noted on the task once, then left for the person.

import type { Bots } from "./omb.ts";
import type { TaskStore } from "./mcp.ts";
import { appendComment, botOf, briefFor, hasTriage, localDate, quote, setTriage, type Task } from "./tasks.ts";

export interface BotConfig {
  /** The bot's name in OpenMausBot. */
  ombName: string;
  /** A code bot's git worktree, refreshed to origin/main before each task. */
  worktree?: string;
}

export interface Config {
  projects: string[];
  bots: Record<string, BotConfig>;
  maxRunsPerDay: number;
  approvalNudgeMinutes: number;
}

export interface Run {
  taskId: string;
  bot: string;
  sendId: string;
  threadId?: string;
  status: "sending" | "sent" | "done" | "failed";
  startedAt: string;
  finishedAt?: string;
  waitingSince?: string;
  nudged?: boolean;
}

export interface State {
  paused?: { reason: string; at: string };
  runs: Run[];
}

export interface Workspace {
  /** Prepares a code bot's worktree; returns why it cannot, or null when ready. */
  prepare(worktree: string): Promise<string | null>;
}

export interface Deps {
  config: Config;
  tasks: TaskStore;
  bots: Bots;
  workspace: Workspace;
  now: () => Date;
  log: (event: string, data?: Record<string, unknown>) => void;
}

const FINISHED = new Set(["completed", "failed", "cancelled"]);
const RATE_LIMIT = /rate.?limit|usage limit|too many requests|quota/i;

export function active(state: State): Run | undefined {
  return state.runs.find((r) => r.status === "sending" || r.status === "sent");
}

export function runsToday(state: State, now: Date): number {
  const today = localDate(now);
  return state.runs.filter((r) => localDate(new Date(r.startedAt)) === today).length;
}

/** The oldest task the bridge may hand out, with its bot. */
export function pick(tasks: Task[], config: Config, state: State): { task: Task; bot: string } | null {
  const eligible = tasks
    .filter((t) => t.status_code === "todo" && !hasTriage(t.description))
    .map((t) => ({ task: t, bot: botOf(t.description) }))
    .filter((c): c is { task: Task; bot: string } => c.bot !== null && c.bot in config.bots)
    .filter((c) => !state.runs.some((r) => r.taskId === c.task.id && (r.status === "sending" || r.status === "sent")))
    .sort((a, b) => a.task.created_at.localeCompare(b.task.created_at));
  return eligible[0] ?? null;
}

async function comment(deps: Deps, taskId: string, text: string, extra: { status?: string; triage?: string } = {}) {
  const task = await deps.tasks.get(taskId);
  let description = task.description ?? "";
  if (extra.triage) description = setTriage(description, extra.triage);
  description = appendComment(description, localDate(deps.now()), text);
  await deps.tasks.update(taskId, { description, ...(extra.status ? { status: extra.status } : {}) });
}

/** Settles the run in flight, if it finished. Mutates `state`. */
export async function settle(deps: Deps, state: State): Promise<void> {
  const run = active(state);
  if (!run) return;
  const now = deps.now();

  if (run.status === "sending") {
    // A crash between send and save: send again with the same id, which
    // OpenMausBot never delivers twice, to recover the thread id.
    const ombName = deps.config.bots[run.bot]?.ombName ?? run.bot;
    const task = await deps.tasks.get(run.taskId);
    run.threadId = await deps.bots.send(ombName, briefFor(task, run.bot), run.sendId);
    await markSent(deps, run);
    deps.log("recovered", { taskId: run.taskId, threadId: run.threadId });
    return;
  }

  const job = await deps.bots.job(run.threadId!);
  if (!job) return;

  if (!FINISHED.has(job.status)) {
    if (job.needsInput) {
      run.waitingSince ??= now.toISOString();
      const waited = now.getTime() - new Date(run.waitingSince).getTime();
      if (!run.nudged && waited >= deps.config.approvalNudgeMinutes * 60_000) {
        await comment(deps, run.taskId, `${run.bot} đang chờ duyệt trong OpenMausBot (thread \`${run.threadId}\`) hơn ${deps.config.approvalNudgeMinutes} phút.`);
        run.nudged = true;
        deps.log("nudged", { taskId: run.taskId });
      }
    } else {
      run.waitingSince = undefined;
    }
    return;
  }

  const reply = (await deps.bots.lastReply(run.threadId!)) ?? job.result ?? "(no reply)";
  const ok = job.status === "completed";
  if (ok) {
    await comment(deps, run.taskId, `${run.bot} báo xong (thread \`${run.threadId}\`). Chờ bạn review.\n\n${quote(reply)}`, {
      status: "todo",
      triage: "ready-for-human",
    });
  } else {
    await comment(deps, run.taskId, `${run.bot} dừng: ${job.status}${job.outcome ? ` (${job.outcome})` : ""}, thread \`${run.threadId}\`.\n\n${quote(reply)}`, {
      status: "blocked",
    });
  }
  run.status = ok ? "done" : "failed";
  run.finishedAt = now.toISOString();
  deps.log("finished", { taskId: run.taskId, status: job.status, outcome: job.outcome });

  if (!ok && RATE_LIMIT.test(`${job.outcome ?? ""} ${reply}`)) {
    state.paused = { reason: "rate limit", at: now.toISOString() };
    deps.log("paused", { reason: "rate limit" });
  }
}

/** One tick. Mutates `state`; the caller persists it. */
export async function tick(deps: Deps, state: State): Promise<void> {
  if (state.paused) return;
  await settle(deps, state);
  if (active(state) || state.paused) return;

  const now = deps.now();
  if (runsToday(state, now) >= deps.config.maxRunsPerDay) {
    deps.log("budget", { runsToday: runsToday(state, now) });
    return;
  }

  const todo: Task[] = [];
  for (const project of deps.config.projects) todo.push(...(await deps.tasks.listTodo(project)));
  const next = pick(todo, deps.config, state);
  if (!next) return;

  const bot = deps.config.bots[next.bot]!;
  if (bot.worktree) {
    const why = await deps.workspace.prepare(bot.worktree);
    if (why) {
      deps.log("worktree-not-ready", { taskId: next.task.id, why });
      return;
    }
  }

  const attempt = state.runs.filter((r) => r.taskId === next.task.id).length + 1;
  const run: Run = {
    taskId: next.task.id,
    bot: next.bot,
    sendId: `vdt-${next.task.id}-${attempt}`,
    status: "sending",
    startedAt: now.toISOString(),
  };
  state.runs.push(run);
  run.threadId = await deps.bots.send(bot.ombName, briefFor(next.task, next.bot), run.sendId);
  await markSent(deps, run);
  deps.log("sent", { taskId: run.taskId, bot: next.bot, threadId: run.threadId });
}

/** After a send (first or recovered): the task shows who has it and where. */
async function markSent(deps: Deps, run: Run): Promise<void> {
  run.status = "sent";
  await comment(deps, run.taskId, `Đã giao cho ${run.bot} (OpenMausBot thread \`${run.threadId}\`).`, { status: "in-progress" });
}
