import { act, useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionEntry } from "../lib/types";
import { useProjectsAndSessions } from "./use-projects-and-sessions";

// @vitest-environment jsdom

const mocks = vi.hoisted(() => ({
  getProjectSessions: vi.fn(),
  listProjects: vi.fn(),
  listen: vi.fn(),
  unlisten: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: mocks.listen,
}));

vi.mock("../lib/tauri", () => ({
  getProjectSessions: mocks.getProjectSessions,
  listProjects: mocks.listProjects,
}));

async function flushPromises(times = 1) {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function waitUntil(assertion: () => void, attempts = 20) {
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await flushPromises(1);
    }
  }

  throw lastError;
}

function buildSessionEntry(sessionId: string, modified: string): SessionEntry {
  return {
    sessionId,
    fullPath: `/tmp/${sessionId}.jsonl`,
    fileMtime: Date.parse(modified),
    firstPrompt: sessionId,
    messageCount: 1,
    created: modified,
    modified,
    projectPath: "/tmp/project",
    isSidechain: false,
  };
}

function HookConsumer() {
  useProjectsAndSessions();
  return null;
}

function GroupsReader({
  queryClient,
  onGroups,
}: {
  queryClient: QueryClient;
  onGroups: (groups: unknown) => void;
}) {
  useProjectsAndSessions();
  useEffect(() => {
    onGroups(queryClient.getQueryData(["all-sessions", ["alpha"]]));
  });
  return null;
}

describe("useProjectsAndSessions", () => {
  let container: HTMLDivElement | null;
  let root: ReturnType<typeof createRoot> | null;
  let sessionsChangedHandler:
    | ((event: { payload: { path: string; kind: string } }) => void)
    | null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    sessionsChangedHandler = null;

    mocks.unlisten.mockReset();
    mocks.listen.mockReset();
    mocks.listProjects.mockReset();
    mocks.getProjectSessions.mockReset();

    mocks.listen.mockImplementation(async (_eventName, handler) => {
      sessionsChangedHandler = handler;
      return mocks.unlisten;
    });
    mocks.listProjects.mockResolvedValue([]);
    mocks.getProjectSessions.mockResolvedValue({ entries: [] });
  });

  afterEach(() => {
    root?.unmount();
    root = null;
    container?.remove();
    container = null;
  });

  it("registers the sessions watcher only once when multiple consumers mount", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    await act(async () => {
      root?.render(
        <QueryClientProvider client={queryClient}>
          <>
            <HookConsumer />
            <HookConsumer />
          </>
        </QueryClientProvider>,
      );

      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.listen).toHaveBeenCalledTimes(1);
    expect(mocks.listen).toHaveBeenCalledWith(
      "sessions-changed",
      expect.any(Function),
    );
  });

  it("loads sidebar sessions without scanning unindexed files or subagents", async () => {
    mocks.listProjects.mockResolvedValue([
      { name: "Alpha", escapedPath: "/projects/alpha" },
      { name: "Beta", escapedPath: "/projects/beta" },
    ]);

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    await act(async () => {
      root?.render(
        <QueryClientProvider client={queryClient}>
          <HookConsumer />
        </QueryClientProvider>,
      );

      await flushPromises(4);
    });

    await waitUntil(() => {
      expect(mocks.getProjectSessions).toHaveBeenCalledTimes(2);
    });

    expect(mocks.getProjectSessions).toHaveBeenNthCalledWith(
      1,
      "/projects/alpha",
      {
        includeSidechains: false,
        includeUnindexed: false,
      },
    );
    expect(mocks.getProjectSessions).toHaveBeenNthCalledWith(
      2,
      "/projects/beta",
      {
        includeSidechains: false,
        includeUnindexed: false,
      },
    );
  });

  it("refetches only the changed project when a session file changes", async () => {
    mocks.listProjects.mockResolvedValue([
      { name: "Alpha", escapedPath: "alpha" },
      { name: "Beta", escapedPath: "beta" },
    ]);

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    await act(async () => {
      root?.render(
        <QueryClientProvider client={queryClient}>
          <HookConsumer />
        </QueryClientProvider>,
      );

      await flushPromises(4);
    });

    await waitUntil(() => {
      expect(mocks.getProjectSessions).toHaveBeenCalledTimes(2);
    });

    mocks.getProjectSessions.mockClear();

    await act(async () => {
      sessionsChangedHandler?.({
        payload: {
          path: "/Users/demo/.claude/projects/alpha/session.jsonl",
          kind: "modify",
        },
      });

      await flushPromises(4);
    });

    await waitUntil(() => {
      expect(mocks.getProjectSessions).toHaveBeenCalledTimes(1);
    });

    expect(mocks.getProjectSessions).toHaveBeenCalledWith("alpha", {
      includeSidechains: false,
      includeUnindexed: false,
    });
  });

  it("keeps the newest project refresh when watcher loads resolve out of order", async () => {
    mocks.listProjects.mockResolvedValue([
      { name: "Alpha", escapedPath: "alpha" },
    ]);

    let callIndex = 0;
    let resolveFirstRefresh:
      | ((value: { entries: SessionEntry[] }) => void)
      | null = null;
    let resolveSecondRefresh:
      | ((value: { entries: SessionEntry[] }) => void)
      | null = null;

    mocks.getProjectSessions.mockImplementation(async () => {
      callIndex += 1;

      if (callIndex === 1) {
        return {
          entries: [buildSessionEntry("initial", "2026-03-11T10:00:00.000Z")],
        };
      }

      if (callIndex === 2) {
        return await new Promise((resolve) => {
          resolveFirstRefresh = resolve;
        });
      }

      return await new Promise((resolve) => {
        resolveSecondRefresh = resolve;
      });
    });

    const groupsSnapshots: unknown[] = [];
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    await act(async () => {
      root?.render(
        <QueryClientProvider client={queryClient}>
          <GroupsReader
            queryClient={queryClient}
            onGroups={(groups) => groupsSnapshots.push(groups)}
          />
        </QueryClientProvider>,
      );

      await flushPromises(4);
    });

    await waitUntil(() => {
      expect(mocks.getProjectSessions).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      sessionsChangedHandler?.({
        payload: {
          path: "/Users/demo/.claude/projects/alpha/session.jsonl",
          kind: "modify",
        },
      });
      sessionsChangedHandler?.({
        payload: {
          path: "/Users/demo/.claude/projects/alpha/session.jsonl",
          kind: "modify",
        },
      });

      await flushPromises(2);
    });

    expect(resolveFirstRefresh).not.toBeNull();
    expect(resolveSecondRefresh).not.toBeNull();

    await act(async () => {
      resolveSecondRefresh?.({
        entries: [buildSessionEntry("newest", "2026-03-11T12:00:00.000Z")],
      });
      await flushPromises(2);
    });

    await act(async () => {
      resolveFirstRefresh?.({
        entries: [buildSessionEntry("stale", "2026-03-11T11:00:00.000Z")],
      });
      await flushPromises(2);
    });

    const finalGroups = groupsSnapshots.at(-1) as
      | Array<{ escapedPath: string; sessions: Array<{ sessionId: string }> }>
      | undefined;

    expect(finalGroups?.[0]?.sessions[0]?.sessionId).toBe("newest");
  });

  it("keeps watcher refresh data when an older all-sessions query resolves later", async () => {
    mocks.listProjects.mockResolvedValue([
      { name: "Alpha", escapedPath: "alpha" },
    ]);

    let resolveInitialQuery:
      | ((value: { entries: SessionEntry[] }) => void)
      | null = null;

    mocks.getProjectSessions.mockImplementationOnce(
      async () =>
        await new Promise((resolve) => {
          resolveInitialQuery = resolve;
        }),
    );
    mocks.getProjectSessions.mockResolvedValue({
      entries: [buildSessionEntry("fresh", "2026-03-11T12:00:00.000Z")],
    });

    const groupsSnapshots: unknown[] = [];
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    await act(async () => {
      root?.render(
        <QueryClientProvider client={queryClient}>
          <GroupsReader
            queryClient={queryClient}
            onGroups={(groups) => groupsSnapshots.push(groups)}
          />
        </QueryClientProvider>,
      );

      await flushPromises(2);
    });

    await waitUntil(() => {
      expect(mocks.getProjectSessions).toHaveBeenCalledTimes(1);
      expect(resolveInitialQuery).not.toBeNull();
    });

    await act(async () => {
      sessionsChangedHandler?.({
        payload: {
          path: "/Users/demo/.claude/projects/alpha/session.jsonl",
          kind: "modify",
        },
      });

      await flushPromises(2);
    });

    await waitUntil(() => {
      const latestGroups = groupsSnapshots.at(-1) as
        | Array<{ escapedPath: string; sessions: Array<{ sessionId: string }> }>
        | undefined;
      expect(latestGroups?.[0]?.sessions[0]?.sessionId).toBe("fresh");
    });

    await act(async () => {
      resolveInitialQuery?.({
        entries: [buildSessionEntry("stale-query", "2026-03-11T11:00:00.000Z")],
      });
      await flushPromises(2);
    });

    const finalGroups = groupsSnapshots.at(-1) as
      | Array<{ escapedPath: string; sessions: Array<{ sessionId: string }> }>
      | undefined;

    expect(finalGroups?.[0]?.sessions[0]?.sessionId).toBe("fresh");
  });
});
