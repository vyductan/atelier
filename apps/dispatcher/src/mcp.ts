// A minimal MCP client for vyductan.dev's /api/mcp (stateless Streamable HTTP):
// one JSON-RPC POST per tool call, answered as JSON or as an SSE stream.
// Auth is a bot session token (`Bearer vdtbot_…`), never printed.

import type { Task } from "./tasks.ts";

export interface TaskStore {
  listTodo(projectSlug: string): Promise<Task[]>;
  get(taskId: string): Promise<Task>;
  update(taskId: string, patch: { status?: string; description?: string }): Promise<void>;
  /** Creates a task and returns its id. */
  create(input: NewTask): Promise<string>;
}

export interface NewTask {
  title: string;
  description: string;
  projectSlug: string;
  parentTaskId: string;
  status: string;
  type: string;
}

let nextId = 1;

export async function callTool(url: string, token: string, name: string, args: Record<string, unknown>): Promise<unknown> {
  const id = nextId++;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }),
    signal: AbortSignal.timeout(60_000),
  });
  // Status only: an error body could echo request details.
  if (!res.ok) throw new Error(`MCP ${name}: HTTP ${res.status}`);
  const raw = await res.text();
  const messages = (res.headers.get("content-type") ?? "").includes("text/event-stream")
    ? raw.split("\n").filter((l) => l.startsWith("data:")).map((l) => JSON.parse(l.slice(5)))
    : [JSON.parse(raw)];
  const reply = messages.find((m) => m?.id === id);
  if (!reply) throw new Error(`MCP ${name}: no reply`);
  if (reply.error) throw new Error(`MCP ${name}: ${reply.error.message ?? "error"}`);
  const text = reply.result?.content?.[0]?.text;
  if (reply.result?.isError) throw new Error(`MCP ${name}: tool error: ${String(text).slice(0, 200)}`);
  return typeof text === "string" ? JSON.parse(text) : reply.result;
}

export function mcpTaskStore(url: string, token: string): TaskStore {
  return {
    async listTodo(projectSlug) {
      const out = (await callTool(url, token, "list_tasks", { projectSlug, status: "todo", limit: 100 })) as { tasks: Task[] };
      return out.tasks;
    },
    async get(taskId) {
      return ((await callTool(url, token, "get_task", { taskId })) as { task: Task }).task;
    },
    async update(taskId, patch) {
      await callTool(url, token, "update_task", { taskId, ...patch });
    },
    async create(input) {
      const out = (await callTool(url, token, "create_task", { ...input })) as { task?: { id?: string }; id?: string };
      const id = out.task?.id ?? out.id;
      if (!id) throw new Error("MCP create_task: no id in reply");
      return id;
    },
  };
}
