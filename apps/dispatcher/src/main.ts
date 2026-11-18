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
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { active, runsToday, tick, type Config, type Deps, type State, type Workspace } from "./dispatch.ts";
import { mcpTaskStore } from "./mcp.ts";
import { ombBots } from "./omb.ts";

const exec = promisify(execFile);
const DIR = process.env.DISPATCHER_DIR ?? join(homedir(), ".atelier", "dispatcher");
const STATE = join(DIR, "state.json");

interface FileConfig extends Config {
  mcpUrl: string;
  tokenFile: string;
  ombCli: string;
  ombPort: number;
  intervalSeconds: number;
}

function loadConfig(): FileConfig {
  const c = JSON.parse(readFileSync(join(DIR, "config.json"), "utf8"));
  const expand = (p: string) => p.replace(/^~(?=\/)/, homedir());
  return { ...c, tokenFile: expand(c.tokenFile), ombCli: expand(c.ombCli) };
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
  async prepare(worktree) {
    const git = (...args: string[]) => exec("git", ["-C", worktree, ...args], { timeout: 120_000 });
    const { stdout } = await git("status", "--porcelain");
    if (stdout.trim()) return "worktree has uncommitted changes";
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
    bots: ombBots(config.ombCli, config.ombPort),
    workspace: gitWorkspace,
    now: () => new Date(),
    log,
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
  } else {
    throw new Error(`unknown command ${command}`);
  }
}

main().catch((error) => {
  log("fatal", { message: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
});
