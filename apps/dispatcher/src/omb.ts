// OpenMausBot on 127.0.0.1: send with its CLI (validation and `--send-id`
// idempotency come for free), watch with its REST routes.

import { spawn } from "node:child_process";

export interface JobStatus {
  /** completed | failed | cancelled | running | queued | waiting | … */
  status: string;
  outcome: string | null;
  needsInput: boolean;
  /** The run's last reply (job summary; may be cut short). */
  result: string | null;
}

export interface Bots {
  send(bot: string, text: string, sendId: string): Promise<string>;
  job(threadId: string): Promise<JobStatus | null>;
  lastReply(threadId: string): Promise<string | null>;
}

export function ombBots(cli: string, port: number): Bots {
  const base = `http://127.0.0.1:${port}`;
  const get = async (path: string) => {
    const res = await fetch(base + path, { signal: AbortSignal.timeout(30_000) });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`OpenMausBot ${path.split("?")[0]}: HTTP ${res.status}`);
    return res.json();
  };
  return {
    async send(bot, text, sendId) {
      // The brief goes on stdin (message `-`), never on the command line.
      const stdout = await new Promise<string>((resolve, reject) => {
        const child = spawn(
          cli,
          ["send", bot, "-", "--task", "new", "--send-id", sendId, "--port", String(port), "--json", "--quiet"],
          { stdio: ["pipe", "pipe", "pipe"], timeout: 60_000 },
        );
        let out = "";
        child.stdout.on("data", (chunk) => (out += chunk));
        child.on("error", reject);
        child.on("close", (code) =>
          code === 0 ? resolve(out) : reject(new Error(`openmausbot send exited ${code}: ${out.slice(0, 300)}`)),
        );
        child.stdin.end(text);
      });
      return threadIdFrom(stdout);
    },
    async job(threadId) {
      const d = await get(`/api/threads/${encodeURIComponent(threadId)}/job?since=0`);
      if (!d) return null;
      const node = d.nodes?.find((n: { threadId?: string }) => n.threadId === threadId) ?? d.nodes?.[0];
      if (!node) return null;
      return {
        status: String(node.status),
        outcome: node.outcome ?? null,
        needsInput: (d.needsInput?.length ?? 0) > 0,
        result: typeof node.result === "string" ? node.result : null,
      };
    },
    async lastReply(threadId) {
      const d = await get(`/api/threads/${encodeURIComponent(threadId)}/messages?limit=20`);
      const last = d?.messages?.findLast((m: { role?: string; kind?: string; text?: string }) => m.role === "bot" && m.kind === "text" && m.text);
      return last?.text ?? null;
    },
  };
}

export function threadIdFrom(stdout: string): string {
  const out = JSON.parse(stdout);
  const id = out.taskId ?? out.threadId;
  if (out.success === false || typeof id !== "string") throw new Error(`openmausbot send: unexpected reply ${stdout.slice(0, 200)}`);
  return id;
}
