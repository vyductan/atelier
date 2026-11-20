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
// - A CoS split plan runs only after the person writes `Plan: approved` and
//   the plan passes validatePlan; it becomes child tasks, never a direct send.
//   A child waits until every task on its `Depends:` line is completed.
// - A bot with a `reviewer` does not hand finished work to the person: the
//   reviewer bot checks the branch against the task's brief first. A failed
//   review goes back to the worker ONCE (same branch); a second fail, a review
//   with no verdict, or a pass all end with the person (todo + ready-for-human).
//   Merging stays the person's job.

import { createHash } from "node:crypto";

import type { Bots } from "./omb.ts";
import type { TaskStore } from "./mcp.ts";
import { childDescription, planBlock, planMark, setPlanMark, validatePlan, type Piece } from "./plan.ts";
import { appendComment, botOf, briefFor, dependsOn, hasTriage, localDate, quote, setTriage, type Task } from "./tasks.ts";

export interface BotConfig {
  /** The bot's name in OpenMausBot. */
  ombName: string;
  /** A code bot's git worktree, refreshed to origin/main before each task. */
  worktree?: string;
  /**
   * The bot's hard limits: `installed` (its cwd .claude/settings.json) must
   * equal `template` (the reviewed copy in team/settings/) before every send.
   * A bot with Bash could rewrite its own settings; a mismatch pauses the
   * bridge instead of handing it more work.
   */
  settings?: { template: string; installed: string };
  /** A bot (key of `bots`) that reviews this bot's finished work before the person sees it. */
  reviewer?: string;
}

/** A command that prints the data a routine bot works on (no model involved). */
export interface Collector {
  cmd: string;
  args: string[];
  cwd: string;
}

/**
 * A daily job that is not a task: at `at` (local HH:MM) the bridge runs the
 * collector and hands its output to `bot`. Once a day, through the same
 * one-run gate and daily budget as tasks.
 */
export interface Routine {
  name: string;
  bot: string;
  at: string;
  collector: Collector;
  /** The brief's opening; the collector output follows it. */
  instruction: string;
  /** Configured but not run (e.g. until a live test has passed). */
  disabled?: boolean;
  /**
   * A task that keeps the routine's reports: each finished run adds the bot's
   * last reply as a dated comment, so past reports can be read without
   * scrolling OpenMausBot. The task's status is never touched.
   */
  reportTask?: string;
  /**
   * A file whose presence runs the routine now, at any time of day (e.g. bl3q's
   * daily run writes one when a chore still fails after its retry). The bridge
   * deletes it as it starts the run, and the run counts as the day's run, so
   * the timed one is skipped that day. Same one-run gate and daily budget.
   */
  triggerFile?: string;
}

export interface Config {
  projects: string[];
  bots: Record<string, BotConfig>;
  maxRunsPerDay: number;
  approvalNudgeMinutes: number;
  routines?: Routine[];
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
  /** The task title, for notifications. */
  title?: string;
  /** Set for a routine run: no task behind it, so nothing is written to tasks. */
  routine?: string;
  /** A routine or follow-up run's brief, kept to resend after a crash. */
  brief?: string;
  /** A follow-up run: `review` (the reviewer checks) or `rework` (the worker fixes). */
  kind?: FollowUp["kind"];
  /** Review round of a follow-up run (1, then 2 after one rework). */
  round?: number;
}

/** Work the bridge queues itself after a run, ahead of new tasks. */
export interface FollowUp {
  taskId: string;
  bot: string;
  kind: "review" | "rework";
  round: number;
  brief: string;
}

export interface State {
  paused?: { reason: string; at: string };
  runs: Run[];
  /** Routine name → the local date it last ran (or failed to collect). */
  routinesDone?: Record<string, string>;
  /** Parent task id → plan piece key → child task id, written as each child is created. */
  plans?: Record<string, Record<string, string>>;
  /**
   * Parent task id → hash of the plan JSON last seen under `Plan: proposed`.
   * An approval counts only for that exact plan, so it always takes a second,
   * separate write after the proposal (CoS cannot propose and approve at once).
   */
  proposed?: Record<string, string>;
  /** Review and rework runs waiting for the one-run gate, oldest first. */
  followUps?: FollowUp[];
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
  /**
   * A phone notification (ntfy). Carries only the bot and the task title.
   * Best effort: a failed notification never fails the tick.
   */
  notify?: (title: string, message: string) => Promise<void>;
  /** Runs a routine's collector and returns what it printed. */
  collect?: (collector: Collector) => Promise<string>;
  /** Whether two files have identical contents (false if either is missing). */
  sameFile?: (a: string, b: string) => Promise<boolean>;
  /** Routine trigger files: whether one is there, and removing it. */
  trigger?: { pending: (path: string) => boolean; clear: (path: string) => void };
}

/**
 * Refuses to hand out work while ANY configured bot's installed settings
 * drifted from the reviewed template (a Chief can pass the work on to
 * teammates, so checking only the receiving bot is not enough): pauses the
 * bridge and pings. True when it is safe to send.
 */
async function settingsIntact(deps: Deps, state: State): Promise<boolean> {
  if (!deps.sameFile) return true;
  for (const [bot, cfg] of Object.entries(deps.config.bots)) {
    const s = cfg.settings;
    if (!s || (await deps.sameFile(s.template, s.installed))) continue;
    const now = deps.now();
    state.paused = { reason: `settings drift: ${bot}`, at: now.toISOString() };
    deps.log("paused", { reason: "settings drift", bot });
    await ping(deps, `Atelier Dispatcher tạm dừng`, `Settings của ${bot} khác bản trong repo. Kiểm tra rồi chạy install-settings.sh và resume.`);
    return false;
  }
  return true;
}

/**
 * A routine due now: its trigger file is there (any time, even after today's
 * run), or its time has come today and it has not run today.
 */
export function dueRoutine(config: Config, state: State, now: Date, pending: (path: string) => boolean = () => false): { routine: Routine; triggered: boolean } | null {
  const today = localDate(now);
  const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const live = (config.routines ?? []).filter((r) => !r.disabled && r.bot in config.bots);
  const triggered = live.find((r) => r.triggerFile && pending(r.triggerFile));
  if (triggered) return { routine: triggered, triggered: true };
  const timed = live.find((r) => state.routinesDone?.[r.name] !== today && hhmm >= r.at);
  return timed ? { routine: timed, triggered: false } : null;
}

/** The start of a bot's reply on one line, short enough for a phone notification. */
function excerpt(reply: string, max = 240): string {
  const line = reply.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max)}…` : line || "Mở OpenMausBot để đọc.";
}

async function ping(deps: Deps, title: string, message: string): Promise<void> {
  try {
    await deps.notify?.(title, message);
  } catch (error) {
    deps.log("notify-failed", { message: error instanceof Error ? error.message : String(error) });
  }
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

/** The tasks the bridge may hand out, oldest first, with their bots. */
export function candidates(tasks: Task[], config: Config, state: State): { task: Task; bot: string }[] {
  return tasks
    // A task carrying a plan is the plan's parent: its work happens in the children.
    .filter((t) => t.status_code === "todo" && !hasTriage(t.description) && planMark(t.description) === null)
    .map((t) => ({ task: t, bot: botOf(t.description) }))
    .filter((c): c is { task: Task; bot: string } => c.bot !== null && c.bot in config.bots)
    .filter((c) => !state.runs.some((r) => r.taskId === c.task.id && (r.status === "sending" || r.status === "sent")))
    .sort((a, b) => a.task.created_at.localeCompare(b.task.created_at));
}

/** The oldest task the bridge may hand out, ignoring `Depends:` (see readyToRun). */
export function pick(tasks: Task[], config: Config, state: State): { task: Task; bot: string } | null {
  return candidates(tasks, config, state)[0] ?? null;
}

/** True when every task on the `Depends:` line is completed. A missing task counts as not done. */
async function readyToRun(deps: Deps, task: Task): Promise<boolean> {
  for (const id of dependsOn(task.description)) {
    try {
      if ((await deps.tasks.get(id)).status_code !== "completed") return false;
    } catch {
      return false;
    }
  }
  return true;
}

/** Pieces in an order where every dependency comes first (the plan is already known acyclic). */
function inDependencyOrder(pieces: Piece[]): Piece[] {
  const out: Piece[] = [];
  const placed = new Set<string>();
  while (out.length < pieces.length) {
    for (const p of pieces) {
      if (!placed.has(p.key) && p.depends_on.every((d) => placed.has(d))) {
        out.push(p);
        placed.add(p.key);
      }
    }
  }
  return out;
}

const planHash = (raw: string) => createHash("sha256").update(raw.trim()).digest("hex");

/**
 * Turns approved plans into child tasks. No model call, so it does not count
 * against the daily budget. Idempotent per piece through the ids recorded in
 * state (never by searching task text, which anyone writing a task controls).
 */
export async function materializePlans(deps: Deps, state: State, todo: Task[]): Promise<void> {
  for (const parent of todo) {
    const mark = planMark(parent.description);
    if (!parent.project_slug || !deps.config.projects.includes(parent.project_slug)) continue;
    const raw = planBlock(parent.description);
    if (mark === "proposed") {
      if (raw !== null) (state.proposed ??= {})[parent.id] = planHash(raw);
      continue;
    }
    if (mark !== "approved") continue;
    const date = localDate(deps.now());
    let description = parent.description ?? "";
    const seen = state.proposed?.[parent.id];
    const result =
      raw === null
        ? { ok: false as const, errors: ["no ```json block under a \"## Plan\" heading"] }
        : seen !== planHash(raw) && !state.plans?.[parent.id]
          ? { ok: false as const, errors: ["this exact plan was never seen as `Plan: proposed`: save it as proposed first, then approve it in a separate edit"] }
          : validatePlan(raw, deps.config);

    if (!result.ok) {
      description = appendComment(setPlanMark(description, "invalid"), date, `Kế hoạch không hợp lệ, chưa tạo task con nào:\n\n${result.errors.map((e) => `- ${e}`).join("\n")}`);
      await deps.tasks.update(parent.id, { description });
      delete state.proposed?.[parent.id];
      deps.log("plan-invalid", { taskId: parent.id, errors: result.errors.length });
      await ping(deps, "Kế hoạch CoS không hợp lệ", parent.title);
      continue;
    }

    const plan = result.plan;
    if (plan.verdict !== "split") {
      const closing = plan.verdict === "close";
      description = appendComment(setPlanMark(description, "created"), date, `${closing ? "Đóng" : "Cần thêm thông tin"} theo kế hoạch đã duyệt: ${plan.reason}`);
      if (!closing) description = setTriage(description, "needs-info");
      await deps.tasks.update(parent.id, { description, status: closing ? "archived" : "blocked" });
      delete state.proposed?.[parent.id];
      deps.log("plan-verdict", { taskId: parent.id, verdict: plan.verdict });
      continue;
    }

    const made = (state.plans ??= {})[parent.id] ??= {};
    for (const piece of inDependencyOrder(plan.pieces)) {
      if (made[piece.key]) continue;
      made[piece.key] = await deps.tasks.create({
          title: piece.title,
          description: childDescription(piece, parent.id, piece.depends_on.map((d) => made[d]!)),
          projectSlug: piece.project,
          parentTaskId: parent.id,
          status: "todo",
          type: piece.type ?? "feat",
        });
    }
    const list = plan.pieces.map((p) => `- \`${p.key}\` → ${made[p.key]} (${p.kind === "human" ? "bạn" : p.bot})`).join("\n");
    description = appendComment(setPlanMark(description, "created"), date, `Đã tạo ${plan.pieces.length} task con từ kế hoạch:\n\n${list}`);
    await deps.tasks.update(parent.id, { description, status: "in-progress" });
    delete state.plans![parent.id];
    delete state.proposed?.[parent.id];
    deps.log("plan-created", { taskId: parent.id, pieces: plan.pieces.length });
  }
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
    if (run.routine) {
      run.threadId = await deps.bots.send(ombName, run.brief ?? "", run.sendId);
      run.status = "sent";
    } else {
      const task = await deps.tasks.get(run.taskId);
      run.title ??= task.title;
      run.threadId = await deps.bots.send(ombName, run.brief ?? briefFor(task, run.bot), run.sendId);
      await markSent(deps, run);
    }
    deps.log("recovered", { taskId: run.taskId, threadId: run.threadId });
    return;
  }

  const job = await deps.bots.job(run.threadId!);
  if (!job) return;

  if (!FINISHED.has(job.status)) {
    if (job.needsInput) {
      if (!run.waitingSince) {
        // Once per wait: the person has to open OpenMausBot to answer it.
        run.waitingSince = now.toISOString();
        await ping(deps, `${run.bot} chờ duyệt`, run.title ?? run.taskId);
      }
      const waited = now.getTime() - new Date(run.waitingSince).getTime();
      if (!run.routine && !run.nudged && waited >= deps.config.approvalNudgeMinutes * 60_000) {
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
  if (run.routine) {
    // No task behind a routine: its result stays in the bot's conversation.
    run.status = ok ? "done" : "failed";
    run.finishedAt = now.toISOString();
    deps.log("routine-finished", { routine: run.routine, status: job.status, outcome: job.outcome });
    const reportTask = deps.config.routines?.find((r) => r.name === run.routine)?.reportTask;
    if (reportTask) {
      const head = `${run.routine} (${run.bot}, thread \`${run.threadId}\`)${ok ? "" : ` dừng: ${job.status}`}:`;
      try {
        await comment(deps, reportTask, `${head}\n\n${quote(reply)}`);
      } catch (error) {
        deps.log("report-failed", { routine: run.routine, message: error instanceof Error ? error.message.slice(0, 200) : "failed" });
      }
    }
    await ping(deps, ok ? `${run.bot}: ${run.title ?? run.routine} đã xong` : `${run.bot}: ${run.title ?? run.routine} lỗi`, excerpt(reply));
    if (!ok && RATE_LIMIT.test(`${job.outcome ?? ""} ${reply}`)) {
      state.paused = { reason: "rate limit", at: now.toISOString() };
      deps.log("paused", { reason: "rate limit" });
    }
    return;
  }
  if (ok) {
    await settleDone(deps, state, run, reply);
  } else {
    await comment(deps, run.taskId, `${run.bot} dừng: ${job.status}${job.outcome ? ` (${job.outcome})` : ""}, thread \`${run.threadId}\`.\n\n${quote(reply)}`, {
      status: "blocked",
    });
  }
  run.status = ok ? "done" : "failed";
  run.finishedAt = now.toISOString();
  deps.log("finished", { taskId: run.taskId, status: job.status, outcome: job.outcome });
  if (!ok || !(state.followUps ?? []).some((f) => f.taskId === run.taskId)) {
    await ping(deps, ok ? `${run.bot} xong, chờ review` : `${run.bot} bị chặn`, run.title ?? run.taskId);
  }

  if (!ok && RATE_LIMIT.test(`${job.outcome ?? ""} ${reply}`)) {
    state.paused = { reason: "rate limit", at: now.toISOString() };
    deps.log("paused", { reason: "rate limit" });
  }
}

/** One tick. Mutates `state`; the caller persists it. */
export async function tick(deps: Deps, state: State): Promise<void> {
  if (state.paused) return;
  await settle(deps, state);
  if (state.paused) return;

  // Every tick, even with a run in flight: a plan must be seen as proposed
  // before its approval counts, and creating children calls no model.
  const todo: Task[] = [];
  for (const project of deps.config.projects) todo.push(...(await deps.tasks.listTodo(project)));
  await materializePlans(deps, state, todo);
  if (active(state)) return;

  const now = deps.now();
  if (runsToday(state, now) >= deps.config.maxRunsPerDay) {
    deps.log("budget", { runsToday: runsToday(state, now) });
    return;
  }

  const due = dueRoutine(deps.config, state, now, deps.trigger?.pending);
  if (due) {
    if (!(await settingsIntact(deps, state))) return;
    // Cleared before collecting: a trigger runs once, even if the collector fails.
    if (due.triggered) deps.trigger?.clear(due.routine.triggerFile!);
    await startRoutine(deps, state, due.routine, now, due.triggered);
    return;
  }

  if (await startFollowUp(deps, state, now)) return;

  let next: { task: Task; bot: string } | null = null;
  for (const c of candidates(todo, deps.config, state)) {
    if (await readyToRun(deps, c.task)) {
      next = c;
      break;
    }
  }
  if (!next) return;

  const bot = deps.config.bots[next.bot]!;
  if (!(await settingsIntact(deps, state))) return;
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
    title: next.task.title,
  };
  state.runs.push(run);
  run.threadId = await deps.bots.send(bot.ombName, briefFor(next.task, next.bot), run.sendId);
  await markSent(deps, run);
  deps.log("sent", { taskId: run.taskId, bot: next.bot, threadId: run.threadId });
}

/**
 * Runs the collector, then hands its output to the routine's bot. A collector
 * failure still counts the routine as done for today (one ping, no retry loop
 * every minute).
 */
async function startRoutine(deps: Deps, state: State, routine: Routine, now: Date, triggered = false): Promise<void> {
  const today = localDate(now);
  // A triggered run may follow the day's run: its own ids, or OpenMausBot's idempotent send would drop it.
  const day = triggered ? `${today}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}` : today;
  state.routinesDone = { ...state.routinesDone, [routine.name]: today };
  let data: string;
  try {
    if (!deps.collect) throw new Error("no collector runner");
    data = await deps.collect(routine.collector);
  } catch (error) {
    deps.log("routine-collect-failed", { routine: routine.name, message: error instanceof Error ? error.message.slice(0, 200) : "failed" });
    await ping(deps, `${routine.bot}: không lấy được dữ liệu`, `${routine.name} ${today}`);
    return;
  }
  if (!data.trim()) {
    // A quiet day: the collector found nothing worth a model run.
    deps.log("routine-empty", { routine: routine.name });
    return;
  }
  const brief = `${routine.instruction}\n\n\`\`\`json\n${data.trim()}\n\`\`\``;
  const run: Run = {
    taskId: `routine:${routine.name}:${day}`,
    bot: routine.bot,
    // OpenMausBot send ids are 16-80 of [A-Za-z0-9_-]: the name (any text) goes in as a hash.
    sendId: `vdt-routine-${createHash("sha256").update(routine.name).digest("hex").slice(0, 12)}-${day}`,
    status: "sending",
    startedAt: now.toISOString(),
    title: routine.name,
    routine: routine.name,
    brief,
  };
  state.runs.push(run);
  run.threadId = await deps.bots.send(deps.config.bots[routine.bot]!.ombName, brief, run.sendId);
  run.status = "sent";
  deps.log("routine-sent", { routine: routine.name, threadId: run.threadId, triggered });
}

/** After a send (first or recovered): the task shows who has it and where. */
async function markSent(deps: Deps, run: Run): Promise<void> {
  run.status = "sent";
  await comment(deps, run.taskId, `Đã giao cho ${run.bot} (OpenMausBot thread \`${run.threadId}\`).`, { status: "in-progress" });
}

/** A review reply's verdict: the last line that is exactly `VERDICT: pass|fail`, else null. */
export function verdictOf(reply: string): "pass" | "fail" | null {
  const all = [...reply.matchAll(/^VERDICT:[ \t]*(pass|fail)[ \t]*$/gim)];
  return (all.at(-1)?.[1]?.toLowerCase() as "pass" | "fail" | undefined) ?? null;
}

const MAX_ROUNDS = 2;

/** The worker's branch, as briefFor names it. */
const branchOf = (taskId: string) => `agent/${taskId.slice(0, 8)}`;

/** Whom a review run reviewed: the bot whose `reviewer` is this bot. */
function workerOf(config: Config, reviewer: string): string | undefined {
  return Object.entries(config.bots).find(([, c]) => c.reviewer === reviewer)?.[0];
}

export function reviewBrief(deps: Deps, task: Task, worker: string, reviewer: string, report: string, round: number): string {
  const worktree = deps.config.bots[worker]?.worktree ?? "(no worktree)";
  return [
    `[Atelier Dispatcher] Review task ${task.id} (project ${task.project_slug ?? "personal"}), lần ${round}/${MAX_ROUNDS}, assigned to you (${reviewer}).`,
    `${worker} finished it on branch \`${branchOf(task.id)}\` in the worktree \`${worktree}\` (read it there; never write to it). Compare the branch with origin/main.`,
    "Check the work against the task below, its Agent Brief and acceptance criteria first. Report each criterion as met or not, anything done outside the task's scope, and what you ran and its result.",
    "End your reply with exactly one line, alone: `VERDICT: pass` or `VERDICT: fail`.",
    "",
    `${worker}'s report (its own words, not evidence):`,
    "",
    quote(report),
    "",
    `# ${task.title}`,
    "",
    (task.description ?? "").trim() || "(no description)",
  ].join("\n");
}

function reworkBrief(task: Task, worker: string, reviewer: string, review: string, round: number): string {
  return [
    briefFor(task, worker),
    "",
    `## ${reviewer} chưa cho qua (lần ${round}): sửa lại`,
    "",
    `This is a rework, not a new task: the branch \`${branchOf(task.id)}\` already holds your earlier commits. Run \`git switch ${branchOf(task.id)}\` (no -c), fix what the review below found, commit on that branch, and report again.`,
    "",
    quote(review),
  ].join("\n");
}

/** A finished, successful task run: to the reviewer, back to the worker, or to the person. */
async function settleDone(deps: Deps, state: State, run: Run, reply: string): Promise<void> {
  const toPerson = (text: string) => comment(deps, run.taskId, text, { status: "todo", triage: "ready-for-human" });
  const thread = `thread \`${run.threadId}\``;
  const queue = (f: FollowUp) => (state.followUps ??= []).push(f);

  if (run.kind === "review") {
    const round = run.round ?? 1;
    const verdict = verdictOf(reply);
    const worker = workerOf(deps.config, run.bot);
    if (verdict === "pass") {
      await toPerson(`${run.bot}: qua (lần ${round}, ${thread}). Chờ bạn review và merge.\n\n${quote(reply)}`);
    } else if (verdict === null) {
      await toPerson(`${run.bot} không ghi kết luận (${thread}). Chờ bạn xem.\n\n${quote(reply)}`);
    } else if (round >= MAX_ROUNDS || !worker) {
      await toPerson(`${run.bot}: chưa qua lần ${round} (${thread}). Hết lượt sửa tự động, chờ bạn.\n\n${quote(reply)}`);
    } else {
      const task = await deps.tasks.get(run.taskId);
      await comment(deps, run.taskId, `${run.bot}: chưa qua lần ${round} (${thread}). Trả ${worker} sửa.\n\n${quote(reply)}`);
      queue({ taskId: run.taskId, bot: worker, kind: "rework", round: round + 1, brief: reworkBrief(task, worker, run.bot, reply, round) });
    }
    return;
  }

  const reviewer = deps.config.bots[run.bot]?.reviewer;
  if (reviewer && reviewer in deps.config.bots) {
    const round = run.round ?? 1;
    const task = await deps.tasks.get(run.taskId);
    await comment(deps, run.taskId, `${run.bot} báo xong (${thread}). Chuyển ${reviewer} chấm (lần ${round}).\n\n${quote(reply)}`);
    queue({ taskId: run.taskId, bot: reviewer, kind: "review", round, brief: reviewBrief(deps, task, run.bot, reviewer, reply, round) });
    return;
  }
  await toPerson(`${run.bot} báo xong (${thread}). Chờ bạn review.\n\n${quote(reply)}`);
}

/**
 * Sends the oldest queued follow-up, if any. A follow-up whose task the person
 * moved out of `in-progress` meanwhile is dropped. True when it sent one (or
 * must wait), so no new task starts this tick.
 */
async function startFollowUp(deps: Deps, state: State, now: Date): Promise<boolean> {
  while (state.followUps?.length) {
    const f = state.followUps[0]!;
    let task: Task;
    try {
      task = await deps.tasks.get(f.taskId);
    } catch {
      state.followUps.shift();
      continue;
    }
    if (task.status_code !== "in-progress" || !(f.bot in deps.config.bots)) {
      deps.log("follow-up-dropped", { taskId: f.taskId, kind: f.kind, status: task.status_code });
      state.followUps.shift();
      continue;
    }
    if (!(await settingsIntact(deps, state))) return true;
    const bot = deps.config.bots[f.bot]!;
    // Only the worker's own rework resets its worktree; a review reads it as the worker left it.
    if (bot.worktree) {
      const why = await deps.workspace.prepare(bot.worktree);
      if (why) {
        deps.log("worktree-not-ready", { taskId: f.taskId, why });
        return true;
      }
    }
    state.followUps.shift();
    const attempt = state.runs.filter((r) => r.taskId === f.taskId).length + 1;
    const run: Run = {
      taskId: f.taskId,
      bot: f.bot,
      sendId: `vdt-${f.taskId}-${attempt}`,
      status: "sending",
      startedAt: now.toISOString(),
      title: task.title,
      kind: f.kind,
      round: f.round,
      brief: f.brief,
    };
    state.runs.push(run);
    run.threadId = await deps.bots.send(bot.ombName, f.brief, run.sendId);
    await markSent(deps, run);
    deps.log("follow-up-sent", { taskId: f.taskId, bot: f.bot, kind: f.kind, round: f.round, threadId: run.threadId });
    return true;
  }
  return false;
}
