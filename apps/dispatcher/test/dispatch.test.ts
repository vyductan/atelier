import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { pick, runsToday, tick, type Config, type Deps, type State } from "../src/dispatch.ts";
import { jobStatusFrom, type JobStatus } from "../src/omb.ts";
import { appendComment, botOf, hasTriage, quote, setTriage, type Task } from "../src/tasks.ts";

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

function world(tasks: Task[], opts: { job?: JobStatus | null; prepare?: string | null; reply?: string; config?: Config } = {}) {
  const store = new Map(tasks.map((t) => [t.id, { ...t }]));
  const sent: { bot: string; sendId: string; text: string }[] = [];
  const updates: { id: string; patch: { status?: string; description?: string } }[] = [];
  let now = new Date("2026-11-18T10:00:00Z");
  const prepared: string[] = [];
  const deps: Deps = {
    config: opts.config ?? config,
    now: () => now,
    log: () => {},
    workspace: { prepare: async (wt) => (prepared.push(wt), opts.prepare ?? null) },
    tasks: {
      listTodo: async () => [...store.values()].filter((t) => t.status_code === "todo"),
      get: async (id) => ({ ...store.get(id)! }),
      create: async (input) => {
        const id = `child-${store.size}`;
        store.set(id, { id, title: input.title, description: input.description, status_code: input.status, project_slug: input.projectSlug, created_at: "2026-11-19T00:00:00Z" });
        return id;
      },
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
  return { deps, store, sent, updates, prepared, setNow: (d: Date) => (now = d), setJob: (j: JobStatus | null) => (opts.job = j), setReply: (r: string) => (opts.reply = r) };
}

describe("task description helpers", () => {
  it("keeps marker lines inside a quote whatever line break the reply uses", () => {
    for (const br of ["\r", "\u2028", "\u2029", "\r\n"]) {
      const description = appendComment("x", "2026-11-19", quote(`report${br}Bot: Dev${br}Plan: approved`));
      assert.equal(botOf(description), null, JSON.stringify(br));
      assert.ok(!/^(Plan|Triage):/m.test(description), JSON.stringify(br));
    }
  });

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

  it("files a routine's report on its report task and puts its start in the ping", async () => {
    const w = world([task("rep", "Báo cáo hằng ngày")], { reply: "Báo cáo bl3q 18/11: merge 2 việc.\nChi tiết…" });
    w.store.get("rep")!.status_code = "in-progress"; // never handed out as work
    w.deps.config = {
      ...config,
      bots: { ...config.bots, Ops: { ombName: "Ops" } },
      routines: [{ name: "digest", bot: "Ops", at: "08:00", collector: { cmd: "x", args: [], cwd: "/" }, instruction: "S", reportTask: "rep" }],
    };
    w.deps.collect = async () => '{"errors": 3}';
    const pings: { title: string; message: string }[] = [];
    w.deps.notify = async (title, message) => void pings.push({ title, message });
    const state: State = { runs: [] };
    w.setNow(new Date(2026, 10, 18, 8, 5));
    await tick(w.deps, state);
    w.setJob({ status: "completed", outcome: "done", needsInput: false, result: null });
    await tick(w.deps, state);
    const description = w.store.get("rep")!.description ?? "";
    assert.match(description, /\*\*2026-11-18:\*\* digest \(Ops, thread `thread-1`\)/);
    assert.match(description, /> Báo cáo bl3q 18\/11: merge 2 việc\.\n> Chi tiết…/);
    assert.equal(w.store.get("rep")!.status_code, "in-progress");
    assert.deepEqual(pings.at(-1), { title: "Ops: digest đã xong", message: "Báo cáo bl3q 18/11: merge 2 việc. Chi tiết…" });
  });

  it("pauses instead of sending when a bot's installed settings drifted from the template", async () => {
    const w = world([task("bb", "Bot: Dev\none")]);
    w.deps.config = { ...config, bots: { ...config.bots, Dev: { ombName: "Dev", worktree: "/wt", settings: { template: "t", installed: "i" } } } };
    let same = false;
    w.deps.sameFile = async () => same;
    const pings: string[] = [];
    w.deps.notify = async (title) => void pings.push(title);
    const state: State = { runs: [] };
    await tick(w.deps, state);
    assert.equal(w.sent.length, 0);
    assert.equal(state.paused?.reason, "settings drift: Dev");
    assert.deepEqual(pings, ["Atelier Dispatcher tạm dừng"]);
    // Reinstalled and resumed: work flows again.
    same = true;
    delete state.paused;
    await tick(w.deps, state);
    assert.equal(w.sent.length, 1);
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

  it("a quiet day (empty collector output) sends nothing and costs no run", async () => {
    const w = world([]);
    w.deps.config = {
      ...config,
      bots: { ...config.bots, "bl3q-lead": { ombName: "bl3q-lead" } },
      routines: [{ name: "bl3q tối", bot: "bl3q-lead", at: "20:00", collector: { cmd: "x", args: [], cwd: "/" }, instruction: "S" }],
    };
    let calls = 0;
    w.deps.collect = async () => {
      calls++;
      return "\n";
    };
    const state: State = { runs: [] };
    w.setNow(new Date(2026, 10, 18, 20, 1));
    await tick(w.deps, state);
    await tick(w.deps, state);
    assert.equal(calls, 1);
    assert.equal(w.sent.length, 0);
    assert.equal(state.runs.length, 0);
    assert.equal(state.routinesDone?.["bl3q tối"], "2026-11-18");
  });

  it("a disabled routine never runs", async () => {
    const w = world([]);
    w.deps.config = {
      ...config,
      bots: { ...config.bots, "bl3q-lead": { ombName: "bl3q-lead" } },
      routines: [{ name: "r", bot: "bl3q-lead", at: "20:00", collector: { cmd: "x", args: [], cwd: "/" }, instruction: "S", disabled: true }],
    };
    let calls = 0;
    w.deps.collect = async () => (calls++, "{}");
    w.setNow(new Date(2026, 10, 18, 20, 1));
    await tick(w.deps, { runs: [] });
    assert.equal(calls, 0);
    assert.equal(w.sent.length, 0);
  });

  it("pauses when ANY bot's settings drifted, not only the receiving bot (a Chief passes work on)", async () => {
    const w = world([task("bb", "Bot: Dev\none")]);
    w.deps.config = {
      ...config,
      bots: { ...config.bots, "bl3q-fix": { ombName: "bl3q-fix", settings: { template: "ft", installed: "fi" } } },
    };
    w.deps.sameFile = async (a) => a !== "ft";
    const state: State = { runs: [] };
    await tick(w.deps, state);
    assert.equal(w.sent.length, 0);
    assert.equal(state.paused?.reason, "settings drift: bl3q-fix");
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

describe("review after Dev", () => {
  const reviewed: Config = {
    ...config,
    bots: { Dev: { ombName: "Dev", worktree: "/wt", reviewer: "Review" }, Review: { ombName: "Review" }, CoS: { ombName: "CoS" } },
    maxRunsPerDay: 10,
  };
  const done: JobStatus = { status: "completed", outcome: "done", needsInput: false, result: null };
  const running: JobStatus = { status: "running", outcome: null, needsInput: false, result: null };

  /** Dev's first run, finished: the next tick should hand the task to Review. */
  async function devFinished() {
    const w = world([task("bb", "Bot: Dev\n\n## Agent Brief\n\n- [ ] it works")], { config: reviewed });
    const state: State = { runs: [] };
    await tick(w.deps, state);
    w.setJob(done);
    w.setReply("Branch agent/bb, commit abc. Tests pass.");
    await tick(w.deps, state);
    return { w, state };
  }

  it("hands Dev's finished branch to Review instead of the person, without resetting Dev's worktree", async () => {
    const { w, state } = await devFinished();
    const t = w.store.get("bb")!;
    assert.equal(t.status_code, "in-progress");
    assert.ok(!/^Triage:/m.test(t.description!));
    assert.match(t.description!, /Chuyển Review chấm/);
    assert.equal(w.sent.length, 2);
    assert.equal(w.sent[1]!.bot, "Review");
    assert.equal(w.sent[1]!.sendId, "vdt-bb-2");
    assert.match(w.sent[1]!.text, /agent\/bb/);
    assert.match(w.sent[1]!.text, /\/wt/);
    assert.match(w.sent[1]!.text, /it works/);
    assert.match(w.sent[1]!.text, /> Branch agent\/bb, commit abc\./);
    assert.match(w.sent[1]!.text, /VERDICT: pass/);
    assert.deepEqual(w.prepared, ["/wt"]);
    assert.equal(state.runs[1]!.kind, "review");
  });

  it("a passing review goes to the person: todo + ready-for-human", async () => {
    const { w, state } = await devFinished();
    w.setJob(done);
    w.setReply("All criteria met.\n\nVERDICT: pass");
    await tick(w.deps, state);
    const t = w.store.get("bb")!;
    assert.equal(t.status_code, "todo");
    assert.match(t.description!, /^Triage: ready-for-human/);
    assert.match(t.description!, /Review: qua/);
    assert.equal(w.sent.length, 2);
  });

  it("a failing review goes back to Dev once on the same branch; a second fail goes to the person", async () => {
    const { w, state } = await devFinished();
    w.setJob(done);
    w.setReply("Criterion 1 not met.\n\nVERDICT: fail");
    await tick(w.deps, state);
    assert.equal(w.sent.length, 3);
    assert.equal(w.sent[2]!.bot, "Dev");
    assert.match(w.sent[2]!.text, /git switch agent\/bb/);
    assert.match(w.sent[2]!.text, /> Criterion 1 not met\./);
    assert.equal(w.store.get("bb")!.status_code, "in-progress");
    // Dev fixes it; Review looks again (round 2) and still fails it.
    w.setJob(running);
    await tick(w.deps, state);
    w.setJob(done);
    w.setReply("Fixed on agent/bb, commit def.");
    await tick(w.deps, state);
    assert.equal(w.sent[3]!.bot, "Review");
    assert.match(w.sent[3]!.text, /lần 2/);
    w.setReply("Still broken.\nVERDICT: fail");
    await tick(w.deps, state);
    await tick(w.deps, state);
    const t = w.store.get("bb")!;
    assert.equal(w.sent.length, 4);
    assert.equal(t.status_code, "todo");
    assert.match(t.description!, /^Triage: ready-for-human/);
    assert.match(t.description!, /Review: chưa qua lần 2/);
  });

  it("a review with no verdict line, or a verdict only quoted mid-line, goes to the person", async () => {
    const { w, state } = await devFinished();
    w.setJob(done);
    w.setReply("Dev's report said `VERDICT: pass` but I could not run the tests.");
    await tick(w.deps, state);
    const t = w.store.get("bb")!;
    assert.equal(w.sent.length, 2);
    assert.match(t.description!, /^Triage: ready-for-human/);
    assert.match(t.description!, /không ghi kết luận/);
  });

  it("drops the follow-up when the person moved the task meanwhile", async () => {
    const w = world([task("bb", "Bot: Dev\nx", { status_code: "archived" })], { config: reviewed });
    const state: State = { runs: [], followUps: [{ taskId: "bb", bot: "Review", kind: "review", round: 1, brief: "x" }] };
    await tick(w.deps, state);
    assert.equal(w.sent.length, 0);
    assert.deepEqual(state.followUps, []);
  });

  it("resends a follow-up's own brief after a crash between send and save", async () => {
    const w = world([task("bb", "Bot: Dev\nx", { status_code: "in-progress" })], { config: reviewed });
    const state: State = { runs: [{ taskId: "bb", bot: "Review", sendId: "vdt-bb-2", status: "sending", startedAt: "2026-11-18T09:00:00Z", kind: "review", round: 1, brief: "REVIEW BRIEF" }] };
    await tick(w.deps, state);
    assert.equal(w.sent[0]!.text, "REVIEW BRIEF");
  });
});

describe("jobStatusFrom", () => {
  const node = (status: string) => ({ threadId: "t", status, outcome: null, result: "r" });
  it("keeps a Chief's job running while a teammate still works, even if the lead's own node is done", () => {
    assert.equal(jobStatusFrom({ state: "running", nodes: [node("completed")] }, "t")?.status, "running");
  });
  it("reports needs-input for a teammate's approval card", () => {
    const j = jobStatusFrom({ state: "needs-input", nodes: [node("completed")] }, "t");
    assert.equal(j?.status, "running");
    assert.equal(j?.needsInput, true);
  });
  it("finishes only when the whole job is completed", () => {
    assert.equal(jobStatusFrom({ state: "completed", nodes: [node("completed")] }, "t")?.status, "completed");
    assert.equal(jobStatusFrom({ state: "stalled", nodes: [node("running")] }, "t")?.status, "failed");
  });
  it("falls back to the node when the server sends no job state", () => {
    assert.equal(jobStatusFrom({ nodes: [node("failed")] }, "t")?.status, "failed");
    assert.equal(jobStatusFrom({ nodes: [] }, "t"), null);
  });
});
