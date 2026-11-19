// The Chief of Staff's split proposal, checked by code before anything runs.
//
// CoS writes the plan into the parent task as a fenced ```json block under a
// `## Plan` heading. The person approves by adding a `Plan: approved` line.
// The bridge then validates it here and, only if it is valid, creates one
// child task per piece (`Bot:` line for bot work, `Triage: ready-for-human`
// for human work, `Depends:` for depends_on). Nothing from the plan reaches
// a bot except through those child tasks and the usual one-run gate.

import type { Config } from "./dispatch.ts";
import { LINE_BREAK } from "./tasks.ts";

export type Kind = "code" | "investigate" | "human";

export interface Piece {
  key: string;
  title: string;
  kind: Kind;
  /** The bot that does it; absent for `human`. */
  bot?: string;
  project: string;
  scope: string;
  files: string[];
  acceptance: string;
  depends_on: string[];
  /** A vyductan-tasks type code; defaults to "feat". */
  type?: string;
}

export type Plan =
  | { verdict: "split"; pieces: Piece[] }
  | { verdict: "close" | "needs-info"; reason: string };

export type PlanResult = { ok: true; plan: Plan } | { ok: false; errors: string[] };

export const MAX_PIECES = 8;
const KINDS = new Set(["code", "investigate", "human"]);
const TYPES = new Set(["feat", "bug", "test", "docs", "refactor", "api-feat", "api-bug", "api-test", "api-refactor"]);
const KEY = /^[a-z0-9][a-z0-9-]{0,23}$/;
const PLAN_LINE = /^Plan:\s*(proposed|approved|created|invalid)\s*$/m;
const PLAN_BLOCK = /^## Plan\s*\n+```json\s*\n([\s\S]*?)\n```/m;

export type PlanMark = "proposed" | "approved" | "created" | "invalid";

/** The word on a `Plan:` line, or null. */
export function planMark(description: string | null): PlanMark | null {
  if (description?.includes(CHILD_MARKER)) return null;
  return (description?.match(PLAN_LINE)?.[1] as PlanMark | undefined) ?? null;
}

/** Replaces the `Plan:` line (there must be one). */
export function setPlanMark(description: string, mark: "created" | "invalid"): string {
  return description.replace(PLAN_LINE, `Plan: ${mark}`);
}

/** The JSON text under `## Plan`, or null when there is no such block. */
export function planBlock(description: string | null): string | null {
  return description?.match(PLAN_BLOCK)?.[1] ?? null;
}

const str = (v: unknown, max: number): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max;
/** One line of text: no line breaks, so it can never start a marker line of its own. */
const line = (v: unknown, max: number): v is string => str(v, max) && !/[\r\n]/.test(v);

/** The marker the bridge writes on every child; a task carrying it is never read as a plan. */
export const CHILD_MARKER = "Part of plan in task ";

/** Free text as a blockquote: no line of it can start with `Bot:`, `Plan:`, `## Plan`… */
const quoted = (text: string) =>
  text
    .trim()
    .split(LINE_BREAK)
    .map((l) => `> ${l}`)
    .join("\n");

/**
 * Checks a plan against the shape agreed in the spec and against what this
 * bridge can actually run. Reports every problem at once, so CoS can fix the
 * plan in one pass.
 */
export function validatePlan(raw: string, config: Config): PlanResult {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, errors: ["not valid JSON"] };
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return { ok: false, errors: ["top level must be an object"] };
  const top = data as Record<string, unknown>;
  const errors: string[] = [];

  if (top.verdict === "close" || top.verdict === "needs-info") {
    if (!str(top.reason, 2000)) errors.push(`verdict ${top.verdict} needs a "reason"`);
    if (top.tasks !== undefined) errors.push(`verdict ${top.verdict} must not have "tasks"`);
    return errors.length ? { ok: false, errors } : { ok: true, plan: { verdict: top.verdict, reason: top.reason as string } };
  }
  if (top.verdict !== "split") return { ok: false, errors: [`verdict must be "split", "close" or "needs-info"`] };
  if (!Array.isArray(top.tasks) || top.tasks.length === 0) return { ok: false, errors: [`"tasks" must be a non-empty array`] };
  if (top.tasks.length > MAX_PIECES) errors.push(`at most ${MAX_PIECES} tasks (got ${top.tasks.length}); split the work into stages`);

  const keys = new Set<string>();
  const pieces: Piece[] = [];
  top.tasks.forEach((item: unknown, i: number) => {
    const at = `tasks[${i}]`;
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      errors.push(`${at} must be an object`);
      return;
    }
    const t = item as Record<string, unknown>;
    const name = typeof t.key === "string" ? `${at} (${t.key})` : at;

    if (typeof t.key !== "string" || !KEY.test(t.key)) errors.push(`${at}.key must match ${KEY}`);
    else if (keys.has(t.key)) errors.push(`${name}: duplicate key`);
    else keys.add(t.key);

    if (!line(t.title, 120)) errors.push(`${name}.title: 1-120 characters`);
    if (!str(t.scope, 2000)) errors.push(`${name}.scope is required`);
    if (!str(t.acceptance, 1000)) errors.push(`${name}.acceptance is required (something checkable)`);
    if (!Array.isArray(t.files) || !t.files.every((f) => line(f, 300) && !f.includes("`"))) errors.push(`${name}.files must be an array of paths (may be empty)`);
    if (!Array.isArray(t.depends_on) || !t.depends_on.every((d) => typeof d === "string")) errors.push(`${name}.depends_on must be an array of keys (may be empty)`);
    if (t.type !== undefined && !(typeof t.type === "string" && TYPES.has(t.type))) errors.push(`${name}.type must be one of ${[...TYPES].join(", ")}`);
    if (typeof t.project !== "string" || !config.projects.includes(t.project)) errors.push(`${name}.project must be one of ${config.projects.join(", ")}`);

    if (typeof t.kind !== "string" || !KINDS.has(t.kind)) {
      errors.push(`${name}.kind must be code, investigate or human`);
    } else {
      errors.push(...kindRules(name, t.kind as Kind, t.bot, config));
    }
    pieces.push(t as unknown as Piece);
  });

  // References and cycles, only once every key is known.
  for (const p of pieces) {
    for (const d of Array.isArray(p.depends_on) ? p.depends_on : []) {
      if (d === p.key) errors.push(`${p.key} depends on itself`);
      else if (!keys.has(d)) errors.push(`${p.key} depends on unknown key "${d}"`);
    }
  }
  const cycle = findCycle(pieces);
  if (cycle) errors.push(`depends_on has a cycle: ${cycle.join(" → ")}`);

  return errors.length ? { ok: false, errors } : { ok: true, plan: { verdict: "split", pieces } };
}

/**
 * Which bots may take which kind of piece. Returns the problems for one piece
 * (empty when it is fine). `bot` is whatever CoS wrote, unchecked.
 */
export function kindRules(name: string, kind: Kind, bot: unknown, config: Config): string[] {
  if (kind === "human") return bot === undefined ? [] : [`${name}: a human piece has no bot`];
  if (typeof bot !== "string" || !(bot in config.bots)) return [`${name}.bot must be one of ${Object.keys(config.bots).join(", ")}`];
  const codeBot = Boolean(config.bots[bot]!.worktree);
  if (kind === "code" && !codeBot) return [`${name}: code work needs a bot with a worktree (${bot} has none)`];
  if (kind === "investigate" && codeBot) return [`${name}: ${bot} edits code; give investigate work to a read-only bot`];
  return [];
}

/** A dependency cycle as a list of keys, or null. */
function findCycle(pieces: Piece[]): string[] | null {
  const deps = new Map(pieces.filter((p) => typeof p.key === "string").map((p) => [p.key, Array.isArray(p.depends_on) ? p.depends_on : []]));
  const state = new Map<string, "visiting" | "done">();
  const path: string[] = [];
  const visit = (k: string): string[] | null => {
    if (state.get(k) === "done" || !deps.has(k)) return null;
    if (state.get(k) === "visiting") return [...path.slice(path.indexOf(k)), k];
    state.set(k, "visiting");
    path.push(k);
    for (const d of deps.get(k)!) {
      const c = d === k ? null : visit(d);
      if (c) return c;
    }
    path.pop();
    state.set(k, "done");
    return null;
  };
  for (const k of deps.keys()) {
    const c = visit(k);
    if (c) return c;
  }
  return null;
}

/** A child task's description: the bridge's lines first, then the piece. */
export function childDescription(piece: Piece, parentId: string, dependsOn: string[]): string {
  const head = piece.kind === "human" ? ["Triage: ready-for-human"] : [`Bot: ${piece.bot}`];
  if (dependsOn.length) head.push(`Depends: ${dependsOn.join(", ")}`);
  return [
    ...head,
    "",
    `${CHILD_MARKER}${parentId} (piece \`${piece.key}\`, ${piece.kind}).`,
    "",
    "## Scope",
    "",
    quoted(piece.scope),
    "",
    "## Likely files",
    "",
    piece.files.length ? piece.files.map((f) => `- \`${f}\``).join("\n") : "- (none named)",
    "",
    "## Acceptance",
    "",
    quoted(piece.acceptance),
    "",
  ].join("\n");
}
