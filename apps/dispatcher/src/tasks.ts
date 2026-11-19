// Pure helpers over vyductan.dev task descriptions (no I/O). The conventions are
// the repo's issue-tracker ones (docs/agents/issue-tracker.md, triage-labels.md):
// a `Triage:` line at the top, `## Comments` at the end with dated entries.

/** A task as the vyductan-tasks MCP returns it (the fields the bridge reads). */
export interface Task {
  id: string;
  title: string;
  description: string | null;
  status_code: string;
  project_slug: string | null;
  created_at: string;
}

const BOT_LINE = /^Bot:\s*([A-Za-z][\w-]{0,40})\s*$/m;
const TRIAGE_LINE = /^Triage:.*$/m;

/** The bot a task is addressed to by a `Bot: <name>` line, or null. */
export function botOf(description: string | null): string | null {
  return description?.match(BOT_LINE)?.[1] ?? null;
}

const DEPENDS_LINE = /^Depends:\s*(.+)$/m;

/** Task ids from a `Depends: <id>, <id>` line (written by the bridge for plan pieces). */
export function dependsOn(description: string | null): string[] {
  const line = description?.match(DEPENDS_LINE)?.[1];
  return line ? line.split(",").map((s) => s.trim()).filter(Boolean) : [];
}

export function hasTriage(description: string | null): boolean {
  return TRIAGE_LINE.test(description ?? "");
}

/** Puts `Triage: <role>` as the first line, replacing any existing one. */
export function setTriage(description: string, role: string): string {
  const without = description.replace(/^Triage:.*\n?/m, "");
  return `Triage: ${role}\n\n${without.replace(/^\n+/, "")}`;
}

/** Appends a dated entry under `## Comments`, creating the heading if needed. */
export function appendComment(description: string, date: string, text: string): string {
  const body = description.replace(/\s+$/, "");
  const entry = `**${date}:** ${text.trim()}`;
  return /^## Comments\s*$/m.test(body)
    ? `${body}\n\n${entry}\n`
    : `${body}\n\n## Comments\n\n${entry}\n`;
}

export const LINE_BREAK = /\r\n|[\n\r\u2028\u2029]/;

/** A reply quoted as a Markdown blockquote, cut to `max` characters. */
export function quote(text: string, max = 3000): string {
  const cut = text.length > max ? `${text.slice(0, max)}…` : text;
  return cut
    .trim()
    // Every JS line terminator, not just \n: `^…$/m` treats \r, U+2028 and U+2029 as
    // line breaks too, so a bare one would let `Bot:`/`Plan:` escape the quote.
    .split(LINE_BREAK)
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n");
}

/** Local calendar date YYYY-MM-DD (the comment convention). */
export function localDate(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** The brief a bot gets for a task. */
export function briefFor(task: Task, bot: string): string {
  return [
    `[Atelier Dispatcher] Task ${task.id} from vyductan.dev (project ${task.project_slug ?? "personal"}), assigned to you (${bot}).`,
    `Branch name if you change code: agent/${task.id.slice(0, 8)}.`,
    "Work only on this task. When done, end with a short report: what changed, branch and commit (if any), what you verified and the result, and anything the person must decide. If you are blocked, say exactly what blocks you and stop.",
    "",
    `# ${task.title}`,
    "",
    (task.description ?? "").trim() || "(no description)",
  ].join("\n");
}
