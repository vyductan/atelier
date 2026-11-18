import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { materializePlans, tick, type Config, type Deps, type State } from "../src/dispatch.ts";
import { planBlock, planMark, validatePlan } from "../src/plan.ts";
import type { Task } from "../src/tasks.ts";

const config: Config = {
  projects: ["vyductan", "bl3q"],
  bots: { Dev: { ombName: "Dev", worktree: "/wt" }, "g-bots": { ombName: "g-bots" }, CoS: { ombName: "CoS" } },
  maxRunsPerDay: 5,
  approvalNudgeMinutes: 30,
};

const piece = (key: string, extra: Record<string, unknown> = {}) => ({
  key,
  title: `Piece ${key}`,
  kind: "code",
  bot: "Dev",
  project: "vyductan",
  scope: "Change the thing.",
  files: ["apps/web/src/x.ts"],
  acceptance: "pnpm -F web test passes",
  depends_on: [],
  ...extra,
});
const split = (...tasks: unknown[]) => JSON.stringify({ verdict: "split", tasks });

describe("validatePlan", () => {
  it("accepts a well-formed split", () => {
    const r = validatePlan(split(piece("a"), piece("b", { kind: "investigate", bot: "g-bots", project: "bl3q", depends_on: ["a"] }), piece("c", { kind: "human", bot: undefined })), config);
    assert.equal(r.ok, true);
  });

  it("accepts close and needs-info with a reason, and nothing else", () => {
    assert.equal(validatePlan(JSON.stringify({ verdict: "close", reason: "not worth it" }), config).ok, true);
    assert.equal(validatePlan(JSON.stringify({ verdict: "needs-info", reason: "which page?" }), config).ok, true);
    assert.equal(validatePlan(JSON.stringify({ verdict: "close" }), config).ok, false);
    assert.equal(validatePlan(JSON.stringify({ verdict: "close", reason: "x", tasks: [] }), config).ok, false);
  });

  it("reports every problem at once", () => {
    const r = validatePlan(split(piece("a", { title: "", acceptance: "", project: "other", files: "x" }), piece("a")), config);
    assert.equal(r.ok, false);
    if (r.ok) return;
    for (const want of ["title", "acceptance", "project", "files", "duplicate"]) assert.ok(r.errors.some((e) => e.includes(want)), `missing ${want} in ${r.errors.join(" | ")}`);
  });

  it("matches kind to bot", () => {
    const errs = (p: unknown) => {
      const r = validatePlan(split(p), config);
      return r.ok ? [] : r.errors;
    };
    assert.match(errs(piece("a", { bot: "g-bots" })).join(), /code work needs a bot with a worktree/);
    assert.match(errs(piece("a", { kind: "investigate" })).join(), /read-only bot/);
    assert.match(errs(piece("a", { kind: "human" })).join(), /human piece has no bot/);
    assert.match(errs(piece("a", { bot: "Nobody" })).join(), /bot must be one of/);
  });

  it("rejects unknown, self and cyclic dependencies", () => {
    const errs = (...ps: unknown[]) => {
      const r = validatePlan(split(...ps), config);
      return r.ok ? "" : r.errors.join(" | ");
    };
    assert.match(errs(piece("a", { depends_on: ["zz"] })), /unknown key "zz"/);
    assert.match(errs(piece("a", { depends_on: ["a"] })), /depends on itself/);
    assert.match(errs(piece("a", { depends_on: ["b"] }), piece("b", { depends_on: ["a"] })), /cycle: a → b → a|cycle: b → a → b/);
  });

  it("rejects non-JSON, too many pieces and a bad verdict", () => {
    assert.equal(validatePlan("{nope", config).ok, false);
    assert.equal(validatePlan(JSON.stringify({ verdict: "maybe" }), config).ok, false);
    assert.equal(validatePlan(split(...Array.from({ length: 9 }, (_, i) => piece(`p${i}`))), config).ok, false);
  });
});

describe("plan markers", () => {
  it("reads the Plan line and the json block under ## Plan", () => {
    const d = 'Triage: ready-for-human\nPlan: approved\n\nbody\n\n## Plan\n\n```json\n{"verdict":"close","reason":"x"}\n```\n';
    assert.equal(planMark(d), "approved");
    assert.equal(planBlock(d), '{"verdict":"close","reason":"x"}');
    assert.equal(planMark("Plan: proposed\n"), "proposed");
    assert.equal(planMark("no plan"), null);
    assert.equal(planBlock("## Plan\n\nprose only"), null);
  });
});

function world(tasks: Task[]) {
  const store = new Map(tasks.map((t) => [t.id, { ...t }]));
  const sent: string[] = [];
  const created: string[] = [];
  const deps: Deps = {
    config,
    now: () => new Date("2026-11-18T10:00:00Z"),
    log: () => {},
    workspace: { prepare: async () => null },
    tasks: {
      listTodo: async (p) => [...store.values()].filter((t) => t.status_code === "todo" && t.project_slug === p),
      get: async (id) => {
        const t = store.get(id);
        if (!t) throw new Error("not found");
        return { ...t };
      },
      update: async (id, patch) => {
        const t = store.get(id)!;
        if (patch.status) t.status_code = patch.status;
        if (patch.description !== undefined) t.description = patch.description;
      },
      create: async (input) => {
        const id = `child-${created.length + 1}`;
        created.push(id);
        store.set(id, { id, title: input.title, description: input.description, status_code: input.status, project_slug: input.projectSlug, created_at: `2026-11-18T1${created.length}:00:00Z` });
        return id;
      },
    },
    bots: {
      send: async (_bot, text) => {
        sent.push(text);
        return `thread-${sent.length}`;
      },
      job: async () => ({ status: "running", outcome: null, needsInput: false, result: null }),
      lastReply: async () => null,
    },
  };
  return { deps, store, sent, created };
}

const parent = (mark: string, json: string): Task => ({
  id: "parent",
  title: "Big thing",
  description: `Triage: ready-for-human\nPlan: ${mark}\n\nDo the big thing.\n\n## Plan\n\n\`\`\`json\n${json}\n\`\`\`\n`,
  status_code: "todo",
  project_slug: "vyductan",
  created_at: "2026-11-18T00:00:00Z",
});

describe("materializePlans", () => {
  it("does nothing until the person approves", async () => {
    const w = world([parent("proposed", split(piece("a")))]);
    await materializePlans(w.deps, { runs: [] }, [...w.store.values()]);
    assert.equal(w.created.length, 0);
  });

  it("creates children in dependency order with Bot / Depends / Triage lines", async () => {
    const w = world([parent("approved", split(piece("b", { depends_on: ["a"] }), piece("a"), piece("h", { kind: "human", bot: undefined })))]);
    await materializePlans(w.deps, { runs: [] }, [...w.store.values()]);
    const byTitle = (t: string) => [...w.store.values()].find((x) => x.title === t)!;
    const a = byTitle("Piece a");
    const b = byTitle("Piece b");
    const h = byTitle("Piece h");
    assert.equal(a.id, "child-1", "a is created before b, which depends on it");
    assert.match(a.description!, /^Bot: Dev$/m);
    assert.match(b.description!, new RegExp(`^Depends: ${a.id}$`, "m"));
    assert.match(h.description!, /^Triage: ready-for-human$/m);
    assert.doesNotMatch(h.description!, /^Bot:/m);
    const p = w.store.get("parent")!;
    assert.equal(planMark(p.description), "created");
    assert.equal(p.status_code, "in-progress");
    assert.match(p.description!, /`a` → child-1/);
  });

  it("marks an invalid plan and creates nothing", async () => {
    const w = world([parent("approved", split(piece("a", { bot: "g-bots" })))]);
    await materializePlans(w.deps, { runs: [] }, [...w.store.values()]);
    assert.equal(w.created.length, 0);
    const p = w.store.get("parent")!;
    assert.equal(planMark(p.description), "invalid");
    assert.match(p.description!, /Kế hoạch không hợp lệ/);
  });

  it("archives on an approved close, blocks on needs-info", async () => {
    const w = world([parent("approved", JSON.stringify({ verdict: "close", reason: "dup of X" }))]);
    await materializePlans(w.deps, { runs: [] }, [...w.store.values()]);
    assert.equal(w.store.get("parent")!.status_code, "archived");
    const w2 = world([parent("approved", JSON.stringify({ verdict: "needs-info", reason: "which page?" }))]);
    await materializePlans(w2.deps, { runs: [] }, [...w2.store.values()]);
    assert.equal(w2.store.get("parent")!.status_code, "blocked");
    assert.match(w2.store.get("parent")!.description!, /^Triage: needs-info/);
  });

  it("does not create a piece twice after a crash mid-plan", async () => {
    const w = world([parent("approved", split(piece("a"), piece("b")))]);
    const state: State = { runs: [], plans: { parent: { a: "child-old" } } };
    await materializePlans(w.deps, state, [...w.store.values()]);
    assert.equal(w.created.length, 1);
    assert.match(w.store.get("parent")!.description!, /`a` → child-old/);
  });
});

describe("tick with a plan", () => {
  it("never hands out a proposed plan's parent, even with a Bot line", async () => {
    const t = parent("proposed", split(piece("a")));
    t.description = t.description!.replace("Triage: ready-for-human\n", "Bot: Dev\n");
    const w = world([t]);
    await tick(w.deps, { runs: [] });
    assert.equal(w.sent.length, 0);
    assert.equal(w.created.length, 0);
  });

  it("never sends the parent, sends the first child, holds the dependent one", async () => {
    const w = world([parent("approved", split(piece("a"), piece("b", { depends_on: ["a"] })))]);
    const state: State = { runs: [] };
    await tick(w.deps, state);
    assert.equal(w.created.length, 2);
    assert.equal(w.sent.length, 0, "children are created this tick, handed out from the next");

    await tick(w.deps, state);
    assert.equal(w.sent.length, 1);
    assert.match(w.sent[0]!, /Piece a/);

    // a is done; b can go next.
    state.runs[0]!.status = "done";
    w.store.get("child-1")!.status_code = "completed";
    await tick(w.deps, state);
    assert.equal(w.sent.length, 2);
    assert.match(w.sent[1]!, /Piece b/);
  });

  it("holds a child whose dependency is not completed", async () => {
    const w = world([parent("approved", split(piece("a"), piece("b", { depends_on: ["a"] })))]);
    const state: State = { runs: [] };
    await tick(w.deps, state);
    w.store.get("child-1")!.status_code = "in-progress"; // a taken by hand, not done
    await tick(w.deps, state);
    assert.equal(w.sent.length, 0);
  });
});
