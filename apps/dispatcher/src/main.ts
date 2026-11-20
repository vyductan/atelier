// Atelier Dispatcher bridge: vyductan-tasks ↔ OpenMausBot.
//
//   node src/main.ts run            loop forever (the launchd service)
//   node src/main.ts tick           one tick, then exit
//   node src/main.ts status         paused?, run in flight, runs today
//   node src/main.ts pause [why]    stop handing out work ("nhường quota")
//   node src/main.ts resume
//
// Files in ~/.atelier/dispatcher/: config.json (see config.example.json),
// state.json (runs; written atomically). The MCP token is read from the file
// config.tokenFile names and never logged.

import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { active, agentConfigPaths, runsToday, tick, type Config, type Deps, type State, type Workspace } from "./dispatch.ts";
import { backlogDigest, type BacklogTask } from "./backlog.ts";
import { intakeDigest } from "./intake.ts";
import { callTool, mcpTaskStore } from "./mcp.ts";
import { ombBots } from "./omb.ts";

const exec = promisify(execFile);
const DIR = process.env.DISPATCHER_DIR ?? join(homedir(), ".atelier", "dispatcher");
const STATE = join(DIR, "state.json");

interface FileConfig extends Config {
  mcpUrl: string;
  tokenFile: string;
  ombCli: string;
  ombPort: number;
  /** Client-scope OpenMausBot access token (the server refuses session-less loopback). */
  ombTokenFile: string;
  intervalSeconds: number;
  /** Phone notifications. The topic is a secret (anyone who knows it can read), so it lives in a file. */
  ntfy?: { server: string; topicFile: string; clickUrl?: string };
}

const expand = (p: string) => p.replace(/^~(?=\/)/, homedir());

function loadConfig(): FileConfig {
  const c = JSON.parse(readFileSync(join(DIR, "config.json"), "utf8"));
  return {
    ...c,
    tokenFile: expand(c.tokenFile),
    ombCli: expand(c.ombCli),
    ombTokenFile: expand(c.ombTokenFile),
    ...(c.ntfy ? { ntfy: { ...c.ntfy, topicFile: expand(c.ntfy.topicFile) } } : {}),
  };
}

/** ntfy JSON publish (UTF-8 safe, unlike headers). */
function ntfyNotifier(ntfy: NonNullable<FileConfig["ntfy"]>) {
  const topic = readFileSync(ntfy.topicFile, "utf8").trim();
  return async (title: string, message: string) => {
    const res = await fetch(ntfy.server.replace(/\/$/, ""), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ topic, title, message, tags: ["robot"], ...(ntfy.clickUrl ? { click: ntfy.clickUrl } : {}) }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`ntfy: HTTP ${res.status}`);
  };
}

function loadState(): State {
  try {
    return JSON.parse(readFileSync(STATE, "utf8"));
  } catch {
    return { runs: [] };
  }
}

function saveState(state: State) {
  mkdirSync(DIR, { recursive: true });
  // Keep a month of finished runs; the task itself is the record.
  const cutoff = Date.now() - 31 * 24 * 3600_000;
  state.runs = state.runs.filter((r) => !r.finishedAt || new Date(r.finishedAt).getTime() > cutoff);
  writeFileSync(`${STATE}.tmp`, JSON.stringify(state, null, 2), { mode: 0o600 });
  renameSync(`${STATE}.tmp`, STATE);
}

const log = (event: string, data: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ at: new Date().toISOString(), event, ...data }));

/** A code bot's worktree: clean, then detached at a fresh origin/main. */
const gitWorkspace: Workspace = {
  async prepare(worktree, branch) {
    const git = (...args: string[]) => exec("git", ["-C", worktree, ...args], { timeout: 120_000 });
    const { stdout } = await git("status", "--porcelain");
    if (stdout.trim()) return "worktree has uncommitted changes";
    if (branch) {
      // A rework: back onto the bot's own branch (never main), as it left it.
      if (!/^agent\/[\w-]+$/.test(branch)) return `refused: not a bot branch (${branch}).`;
      // Unsandboxed checkout of a bot-made branch: never materialize files the
      // bot's next run would load as its own instructions or settings.
      // -z: raw NUL-separated names (no C-style quoting that would hide a suffix).
      const { stdout: changed } = await git("-c", "core.quotePath=false", "diff", "--name-only", "-z", "--no-renames", "--no-ext-diff", "--no-textconv", `origin/main...${branch}`);
      const bad = agentConfigPaths(changed.split("\0"));
      if (bad.length) return `refused: ${branch} changes agent config (${bad.slice(0, 3).join(", ")}).`;
      await git("switch", "-q", branch);
      return null;
    }
    await git("fetch", "-q", "origin", "main");
    await git("switch", "-q", "--detach", "origin/main");
    return null;
  },
};

function deps(config: FileConfig): Deps {
  const token = readFileSync(config.tokenFile, "utf8").trim();
  return {
    config,
    tasks: mcpTaskStore(config.mcpUrl, token),
    bots: ombBots(config.ombCli, config.ombPort, config.ombTokenFile),
    workspace: gitWorkspace,
    now: () => new Date(),
    log,
    ...(config.ntfy ? { notify: ntfyNotifier(config.ntfy) } : {}),
    sameFile: async (a, b) => {
      try {
        return readFileSync(expand(a)).equals(readFileSync(expand(b)));
      } catch {
        return false;
      }
    },
    trigger: {
      pending: (path) => existsSync(expand(path)),
      clear: (path) => rmSync(expand(path), { force: true }),
    },
    collect: async (collector) => {
      // execFile: no shell; the command and its arguments come from config.json.
      const { stdout } = await exec(collector.cmd, collector.args, {
        cwd: expand(collector.cwd),
        timeout: 5 * 60_000,
        maxBuffer: 8 * 1024 * 1024,
      });
      if (stdout.length > 200_000) throw new Error(`collector output too large (${stdout.length} chars)`);
      return stdout;
    },
  };
}

async function once(config: FileConfig) {
  const state = loadState();
  try {
    await tick(deps(config), state);
  } finally {
    saveState(state);
  }
}

async function main() {
  const [command = "status", ...rest] = process.argv.slice(2);
  const config = loadConfig();

  if (command === "status") {
    const state = loadState();
    const run = active(state);
    console.log(JSON.stringify({ paused: state.paused ?? null, active: run ?? null, runsToday: runsToday(state, new Date()), maxRunsPerDay: config.maxRunsPerDay }, null, 2));
  } else if (command === "pause") {
    const state = loadState();
    state.paused = { reason: rest.join(" ") || "manual", at: new Date().toISOString() };
    saveState(state);
    log("paused", { reason: state.paused.reason });
  } else if (command === "resume") {
    const state = loadState();
    delete state.paused;
    saveState(state);
    log("resumed");
  } else if (command === "tick") {
    await once(config);
  } else if (command === "run") {
    log("started", { projects: config.projects, bots: Object.keys(config.bots), intervalSeconds: config.intervalSeconds });
    for (;;) {
      try {
        await once(config);
      } catch (error) {
        log("error", { message: error instanceof Error ? error.message : String(error) });
      }
      await new Promise((r) => setTimeout(r, config.intervalSeconds * 1000));
    }
  } else if (command === "intake-digest") {
    // A routine collector: prints the project's intake reports waiting in
    // triage as JSON, or nothing on a quiet day (see src/intake.ts).
    const project = rest[0];
    if (!project) throw new Error("usage: intake-digest <project>");
    const token = readFileSync(config.tokenFile, "utf8").trim();
    const out = (await callTool(config.mcpUrl, token, "list_tasks", { projectSlug: project, status: "triage", limit: 100 })) as {
      tasks: Parameters<typeof intakeDigest>[0];
    };
    process.stdout.write(intakeDigest(out.tasks, project, new Date()));
  } else if (command === "backlog-digest") {
    // A routine collector: prints the project's tasks still waiting for a
    // triage decision as JSON, or nothing when there are none (src/backlog.ts).
    const project = rest[0];
    if (!project) throw new Error("usage: backlog-digest <project>");
    const token = readFileSync(config.tokenFile, "utf8").trim();
    const tasks: BacklogTask[] = [];
    for (const status of ["triage", "todo", "blocked", "in-progress"]) {
      const out = (await callTool(config.mcpUrl, token, "list_tasks", { projectSlug: project, status, limit: 100 })) as { tasks: BacklogTask[] };
      tasks.push(...out.tasks);
    }
    process.stdout.write(backlogDigest(tasks, project, new Date()));
  } else {
    throw new Error(`unknown command ${command}`);
  }
}

main().catch((error) => {
  log("fatal", { message: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
});
