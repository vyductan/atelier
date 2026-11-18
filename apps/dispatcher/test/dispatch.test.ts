import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { pick, runsToday, tick, type Config, type Deps, type State } from "../src/dispatch.ts";
import type { JobStatus } from "../src/omb.ts";
import { appendComment, botOf, hasTriage, setTriage, type Task } from "../src/tasks.ts";

const config: Config = {
  projects: ["vyductan"],
  bots: { Dev: { ombName: "Dev", worktree: "/wt" }, CoS: { ombName: "CoS" } },
  maxRunsPerDay: 3,
  approvalNudgeMinutes: 30,
};

const task = (id: string, description: string, extra: Partial<Task> = {}): Task => ({
  id,
  title: `Task ${id}`,
  description,
  status_code: "todo",
  project_slug: "vyductan",
  created_at: `2026-11-1${id.length}T00:00:00Z`,
  ...extra,
});

function world(tasks: Task[], opts: { job?: JobStatus | null; prepare?: string | null; reply?: string } = {}) {
  const store = new Map(tasks.map((t) => [t.id, { ...t }]));
  const sent: { bot: string; sendId: string; text: string }[] = [];
  const updates: { id: string; patch: { status?: string; description?: string } }[] = [];
  let now = new Date("2026-11-18T10:00:00Z");
  const deps: Deps = {
    config,
    now: () => now,
    log: () => {},
    workspace: { prepare: async () => opts.prepare ?? null },
    tasks: {
      listTodo: async () => [...store.values()].filter((t) => t.status_code === "todo"),
      get: async (id) => ({ ...store.get(id)! }),
      update: async (id, patch) => {
        updates.push({ id, patch });
        const t = store.get(id)!;
        if (patch.status) t.status_code = patch.status;
        if (patch.description !== undefined) t.description = patch.description;
      },
    },
    bots: {
      send: async (bot, text, sendId) => {
        sent.push({ bot, sendId, text });
        return `thread-${sent.length}`;
      },
      job: async () => (opts.job === undefined ? { status: "running", outcome: null, needsInput: false, result: null } : opts.job),
      lastReply: async () => opts.reply ?? "Done: branch agent/x, commit abc.",
    },
  };
  return { deps, store, sent, updates, setNow: (d: Date) => (now = d), setJob: (j: JobStatus | null) => (opts.job = j) };
}

describe("task description helpers", () => {
  it("reads the Bot line and the Triage line", () => {
    assert.equal(botOf("Spec: x\nBot: Dev\n\nbody"), "Dev");
    assert.equal(botOf("no bot here"), null);
    assert.equal(botOf("mentions Bot: Dev inline"), null);
    assert.equal(hasTriage("Triage: ready-for-human\n\nx"), true);
    assert.equal(hasTriage("Bot: Dev"), false);
  });

  it("sets Triage first and appends dated comments under one heading", () => {
    const d = setTriage("Bot: Dev\n\nbody", "ready-for-human");
    assert.match(d, /^Triage: ready-for-human\n\nBot: Dev/);
    assert.equal(setTriage(d, "needs-info").match(/^Triage:/gm)?.length, 1);
    const c = appendComment(appendComment("body", "2026-11-18", "one"), "2026-11-18", "two");
    assert.equal(c.match(/^## Comments$/gm)?.length, 1);
    assert.match(c, /\*\*2026-11-18:\*\* one\n\n\*\*2026-11-18:\*\* two/);
  });
});

describe("pick", () => {
  it("takes the oldest todo task addressed to a configured bot, skipping human-triaged ones", () => {
    const tasks = [
      task("ccc", "Bot: Dev\nnewest"),
      task("a", "Bot: Dev\nTriage: ready-for-human"),
      task("bb", "Bot: Dev\noldest eligible"),
      task("d", "Bot: Stranger\nunknown bot"),
      task("e", "no bot line"),
    ];
    assert.equal(pick(tasks, config, { runs: [] })?.task.id, "bb");
  });
});

describe("tick", () => {
  it("hands one task to its bot, marks it in-progress and records the thread", async () => {
    const w = world([task("bb", "Bot: Dev\nDo the thing")]);
    const state: State = { runs: [] };
    await tick(w.deps, state);
    assert.equal(w.sent.length, 1);
    assert.equal(w.sent[0]!.bot, "Dev");
    assert.equal(w.sent[0]!.sendId, "vdt-bb-1");
    assert.match(w.sent[0]!.text, /Do the thing/);
    assert.equal(w.store.get("bb")!.status_code, "in-progress");
    assert.match(w.store.get("bb")!.description!, /Đã giao cho Dev \(OpenMausBot thread `thread-1`\)/);
    assert.equal(state.runs[0]!.status, "sent");
  });

  it("never starts a second run while one is in flight", async () => {
    const w = world([task("bb", "Bot: Dev\none"), task("ccc", "Bot: CoS\ntwo")]);
    const state: State = { runs: [] };
    await tick(w.deps, state);
    await tick(w.deps, state);
    await tick(w.deps, state);
    assert.equal(w.sent.length, 1);
  });

  it("on completion: reply on the task, todo + Triage ready-for-human, then the next task", async () => {
    const w = world([task("bb", "Bot: Dev\none"), task("ccc", "Bot: CoS\ntwo")]);
    const state: State = { runs: [] };
    await tick(w.deps, state);
    w.setJob({ status: "completed", outcome: "done", needsInput: false, result: "short" });
    await tick(w.deps, state);
    const done = w.store.get("bb")!;
    assert.equal(done.status_code, "todo");
    assert.match(done.description!, /^Triage: ready-for-human/);
    assert.match(done.description!, /> Done: branch agent\/x, commit abc\./);
    assert.equal(state.runs[0]!.status, "done");
    // The finished task now carries a Triage line, so it is not picked again.
    assert.equal(w.sent.length, 2);
    assert.equal(w.sent[1]!.bot, "CoS");
  });

  it("on failure: blocked with the reason; a rate limit pauses the bridge", async () => {
    const w = world([task("bb", "Bot: Dev\none")], { reply: "You've hit your usage limit." });
    const state: State = { runs: [] };
    await tick(w.deps, state);
    w.setJob({ status: "failed", outcome: "provider_error", needsInput: false, result: null });
    await tick(w.deps, state);
    assert.equal(w.store.get("bb")!.status_code, "blocked");
    assert.match(w.store.get("bb")!.description!, /Dev dừng: failed \(provider_error\)/);
    assert.equal(state.paused?.reason, "rate limit");
  });

  it("pings the phone once per wait, notes a long wait once, and never approves", async () => {
    const w = world([task("bb", "Bot: Dev\none")]);
    const pings: string[] = [];
    w.deps.notify = async (title, message) => void pings.push(`${title}|${message}`);
    const state: State = { runs: [] };
    await tick(w.deps, state);
    w.setJob({ status: "running", outcome: null, needsInput: true, result: null });
    await tick(w.deps, state);
    await tick(w.deps, state);
    assert.deepEqual(pings, ["Dev chờ duyệt|Task bb"]);
    w.setNow(new Date("2026-11-18T10:31:00Z"));
    await tick(w.deps, state);
    await tick(w.deps, state);
    const nudges = w.store.get("bb")!.description!.match(/đang chờ duyệt/g) ?? [];
    assert.equal(nudges.length, 1);
    assert.equal(w.sent.length, 1);
    // A new wait after the card was answered pings again.
    w.setJob({ status: "running", outcome: null, needsInput: false, result: null });
    await tick(w.deps, state);
    w.setJob({ status: "running", outcome: null, needsInput: true, result: null });
    await tick(w.deps, state);
    assert.equal(pings.length, 2);
  });

  it("pings when a run finishes, and a failing notifier never breaks the tick", async () => {
    const w = world([task("bb", "Bot: Dev\none")]);
    w.deps.notify = async () => {
      throw new Error("ntfy down");
    };
    const state: State = { runs: [] };
    await tick(w.deps, state);
    w.setJob({ status: "completed", outcome: "done", needsInput: false, result: null });
    await tick(w.deps, state);
    assert.equal(state.runs[0]!.status, "done");
    const pings: string[] = [];
    w.deps.notify = async (title) => void pings.push(title);
    const w2 = world([task("cc", "Bot: Dev\ntwo")]);
    w2.deps.notify = w.deps.notify;
    const s2: State = { runs: [] };
    await tick(w2.deps, s2);
    w2.setJob({ status: "failed", outcome: "provider_error", needsInput: false, result: null });
    await tick(w2.deps, s2);
    assert.deepEqual(pings, ["Dev bị chặn"]);
  });

  it("does nothing while paused, past the daily budget, or with a dirty worktree", async () => {
    const paused = world([task("bb", "Bot: Dev\none")]);
    await tick(paused.deps, { runs: [], paused: { reason: "manual", at: "x" } });
    assert.equal(paused.sent.length, 0);

    const budget = world([task("bb", "Bot: Dev\none")]);
    const today = "2026-11-18T01:00:00Z";
    const full: State = { runs: [1, 2, 3].map((i) => ({ taskId: `old${i}`, bot: "Dev", sendId: `s${i}`, status: "done" as const, startedAt: today, finishedAt: today })) };
    assert.equal(runsToday(full, new Date("2026-11-18T10:00:00Z")), 3);
    await tick(budget.deps, full);
    assert.equal(budget.sent.length, 0);

    const dirty = world([task("bb", "Bot: Dev\none")], { prepare: "worktree has uncommitted changes" });
    const state: State = { runs: [] };
    await tick(dirty.deps, state);
    assert.equal(dirty.sent.length, 0);
    assert.equal(state.runs.length, 0);
  });

  it("runs a due routine once a day: collect, hand to its bot, ping when done, never touch tasks", async () => {
    const w = world([task("bb", "Bot: Dev\none")]);
    w.deps.config = {
      ...config,
      bots: { ...config.bots, Ops: { ombName: "Ops" } },
      routines: [{ name: "digest", bot: "Ops", at: "08:00", collector: { cmd: "x", args: [], cwd: "/" }, instruction: "Summarise:" }],
    };
    const collected: string[] = [];
    w.deps.collect = async (c) => {
      collected.push(c.cmd);
      return '{"errors": 3}';
    };
    const pings: string[] = [];
    w.deps.notify = async (title) => void pings.push(title);
    const state: State = { runs: [] };

    // 07:59 local: not due; the task goes out instead.
    w.setNow(new Date(2026, 10, 18, 7, 59));
    await tick(w.deps, state);
    assert.equal(w.sent[0]!.bot, "Dev");
    w.setJob({ status: "completed", outcome: "done", needsInput: false, result: null });

    // 08:05: the task settles, then the routine starts (one run at a time).
    w.setNow(new Date(2026, 10, 18, 8, 5));
    w.setJob({ status: "completed", outcome: "done", needsInput: false, result: null });
    await tick(w.deps, state);
    assert.equal(w.sent.length, 2);
    assert.equal(w.sent[1]!.bot, "Ops");
    // OpenMausBot's send id rule: 16-80 of [A-Za-z0-9_-].
    assert.match(w.sent[1]!.sendId, /^vdt-routine-[0-9a-f]{12}-2026-11-18$/);
    assert.match(w.sent[1]!.text, /^Summarise:\n\n```json\n\{"errors": 3\}\n```$/);
    const updatesBefore = w.updates.length;

    // It finishes: a ping, no task write, and no second run today.
    await tick(w.deps, state);
    assert.equal(w.updates.length, updatesBefore);
    assert.ok(pings.includes("Ops: digest đã xong"));
    w.setNow(new Date(2026, 10, 18, 9, 0));
    await tick(w.deps, state);
    assert.deepEqual(collected, ["x"]);
    assert.equal(w.sent.length, 2);
  });

  it("makes a valid OpenMausBot send id from any routine name", async () => {
    const w = world([]);
    w.deps.config = {
      ...config,
      bots: { ...config.bots, Ops: { ombName: "Ops" } },
      routines: [{ name: "tóm tắt lỗi sáng nay", bot: "Ops", at: "08:00", collector: { cmd: "x", args: [], cwd: "/" }, instruction: "S" }],
    };
    w.deps.collect = async () => "{}";
    w.setNow(new Date(2026, 10, 18, 8, 1));
    await tick(w.deps, { runs: [] });
    assert.match(w.sent[0]!.sendId, /^[A-Za-z0-9_-]{16,80}$/);
  });

  it("a failing collector counts the routine as done for the day and pings once", async () => {
    const w = world([]);
    w.deps.config = {
      ...config,
      bots: { ...config.bots, Ops: { ombName: "Ops" } },
      routines: [{ name: "digest", bot: "Ops", at: "08:00", collector: { cmd: "x", args: [], cwd: "/" }, instruction: "S" }],
    };
    let calls = 0;
    w.deps.collect = async () => {
      calls++;
      throw new Error("vercel logs failed");
    };
    const pings: string[] = [];
    w.deps.notify = async (title) => void pings.push(title);
    const state: State = { runs: [] };
    w.setNow(new Date(2026, 10, 18, 8, 1));
    await tick(w.deps, state);
    await tick(w.deps, state);
    assert.equal(calls, 1);
    assert.equal(w.sent.length, 0);
    assert.deepEqual(pings, ["Ops: không lấy được dữ liệu"]);
  });

  it("recovers a run whose send failed or crashed, reusing the send id and marking the task", async () => {
    // A failed first send leaves the task untouched in `todo`.
    const w = world([task("bb", "Bot: Dev\none")]);
    const state: State = { runs: [{ taskId: "bb", bot: "Dev", sendId: "vdt-bb-1", status: "sending", startedAt: "2026-11-18T09:00:00Z" }] };
    await tick(w.deps, state);
    assert.deepEqual(w.sent.map((s) => s.sendId), ["vdt-bb-1"]);
    assert.equal(state.runs[0]!.status, "sent");
    assert.equal(w.store.get("bb")!.status_code, "in-progress");
    assert.match(w.store.get("bb")!.description!, /Đã giao cho Dev \(OpenMausBot thread `thread-1`\)/);
  });
});
