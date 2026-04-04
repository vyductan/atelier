import type { Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StrictMode } from "react";
import type React from "react";

import type { StreamJsonEvent } from "../lib/studio";
import type { UpdateSessionModelMetadataInput } from "../lib/tauri";
import type { SessionEntry } from "../lib/types";
import { useSessionStore } from "../store/session-store";

// @vitest-environment jsdom

const mocks = vi.hoisted(() => ({
  addToast: vi.fn(),
  dialogSave: vi.fn(),
  exportSession: vi.fn(),
  exportSessionToCodex: vi.fn(),
  getSessionCwd: vi.fn(),
  getWorkspaceDiff: vi.fn(),
  getWorkspaceFileContent: vi.fn(),
  getWorkspaceStatus: vi.fn(),
  moveToTrash: vi.fn(),
  readGlobalClaudeConfig: vi.fn(),
  readSessionMessages: vi.fn(() => Promise.resolve([])),
  sendSessionMessage: vi.fn<
    (sessionId: string, message: string) => Promise<void>
  >(),
  shouldAllowSessionInput: vi.fn(
    (isConnected: boolean, isLoading: boolean, sessionId: string) =>
      isConnected && !isLoading && Boolean(sessionId),
  ),
  startActiveSessionStream: vi.fn(),
  stopActiveSession: vi.fn<(sessionId: string) => Promise<void>>(),
  updateSessionModelMetadata: vi.fn<
    (input: UpdateSessionModelMetadataInput) => Promise<void>
  >(),
}));

vi.mock("../store/toast-store", () => ({
  useToastStore: (
    selector: (state: { addToast: typeof mocks.addToast }) => unknown,
  ) => selector({ addToast: mocks.addToast }),
}));

vi.mock("../lib/studio", () => ({
  buildStudioRequestError: vi.fn(() => "studio request failed"),
  sendSessionMessage: mocks.sendSessionMessage,
  shouldAllowSessionInput: mocks.shouldAllowSessionInput,
  startActiveSessionStream: mocks.startActiveSessionStream,
  stopActiveSession: mocks.stopActiveSession,
}));

vi.mock("../lib/tauri", () => ({
  getSessionCwd: mocks.getSessionCwd,
  readGlobalClaudeConfig: mocks.readGlobalClaudeConfig,
  updateSessionModelMetadata: mocks.updateSessionModelMetadata,
}));

vi.mock("../lib/atelier-client", () => ({
  atelierClient: {
    sessions: {
      readHistory: mocks.readSessionMessages,
      getCwd: mocks.getSessionCwd,
      rename: vi.fn(),
    },
    runtime: {
      start: (input: {
        sessionId: string | undefined;
        projectPath: string;
        firstPrompt: string | undefined;
        onEvent: (event: unknown) => void;
        onDone: () => void;
        resumeSessionId?: string;
        resolvedModel?: string | null;
      }) =>
        mocks.startActiveSessionStream(
          input.sessionId,
          input.projectPath,
          input.firstPrompt,
          input.onEvent,
          input.onDone,
          input.resumeSessionId,
          input.resolvedModel,
        ),
      send: mocks.sendSessionMessage,
      stop: mocks.stopActiveSession,
    },
    exports: {
      session: mocks.exportSession,
      codex: mocks.exportSessionToCodex,
      preparePath: mocks.moveToTrash,
    },
    workspace: {
      getStatus: mocks.getWorkspaceStatus,
      getDiff: mocks.getWorkspaceDiff,
      getFileContent: mocks.getWorkspaceFileContent,
    },
  },
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: mocks.dialogSave,
}));

vi.mock("react-markdown", () => ({
  default: ({ children }: { children?: React.ReactNode }) => children ?? null,
}));

vi.mock("remark-gfm", () => ({ default: vi.fn() }));

vi.mock("lucide-react", () => ({
  Bot: () => null,
  CheckIcon: () => null,
  ChevronDownIcon: () => null,
  ChevronRight: () => null,
  ChevronUpIcon: () => null,
  Copy: () => null,
  Download: () => null,
  FileText: () => null,
  Loader2: () => null,
  MoreHorizontal: () => null,
  Send: () => null,
  Upload: () => null,
  User: () => null,
  Wrench: () => null,
}));

vi.mock("@acme/ui/components/code-block", () => ({
  CodeBlock: ({ children }: { children?: React.ReactNode }) => children ?? null,
}));

vi.mock("@acme/ui/components/button", () => ({
  Button: ({
    children,
    type = "button",
    onClick,
    disabled,
  }: {
    children?: React.ReactNode;
    type?: "button" | "submit" | "reset";
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button type={type} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));

vi.mock("@acme/ui/components/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuContent: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    onClick,
    disabled,
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  DropdownMenuTrigger: ({ children }: { children?: React.ReactNode }) =>
    children ?? null,
}));

vi.mock("./session-diff-panel", () => ({
  SessionDiffPanel: ({
    state,
    status,
    diff,
    preview,
    mode = "diff",
    selectedPath,
    errorMessage,
    onSelectFile,
    onModeChange,
  }: {
    state: "loading" | "ready" | "error";
    status:
      | {
          isGitRepo?: boolean;
          changedFiles?: Array<{ path: string; status: string }>;
        }
      | null;
    diff?: { unifiedDiff?: string | null } | null;
    preview?: { content?: string | null } | null;
    mode?: "diff" | "preview";
    selectedPath: string | null;
    errorMessage?: string;
    onSelectFile: (path: string) => void;
    onModeChange?: (mode: "diff" | "preview") => void;
  }) => {
    const files = status?.changedFiles ?? [];

    return (
      <section data-testid="session-diff-panel">
        <div>Changes</div>
        {state === "loading" ? <div>Loading changes…</div> : null}
        {state === "error" ? (
          <div>{errorMessage ?? "Failed to load changes"}</div>
        ) : null}
        {state === "ready" && files.length === 0 ? (
          <div>No changes</div>
        ) : null}
        {state === "ready"
          ? files.map((file) => (
              <button
                key={file.path}
                type="button"
                onClick={() => onSelectFile(file.path)}
              >
                {file.path}
              </button>
            ))
          : null}
        <button type="button" onClick={() => onModeChange?.("diff")}>
          Diff
        </button>
        <button type="button" onClick={() => onModeChange?.("preview")}>
          Preview
        </button>
        <pre>
          {mode === "preview"
            ? (preview?.content ?? errorMessage ?? "")
            : (diff?.unifiedDiff ??
              (selectedPath ? (errorMessage ?? "Loading diff…") : ""))}
        </pre>
      </section>
    );
  },
}));

vi.mock("./session-header", () => ({
  SessionHeader: ({
    title,
    meta,
    statusLabel,
    runtimeCost,
    canStopSession,
    hasSessionActions,
    isExporting,
    sessionContextWindowSelector,
    onCopyToClipboard,
    onStopSession,
    onExportToFile,
    onExportToCodex,
    onGenerateHandoff,
  }: {
    title: string;
    meta?: string | null;
    statusLabel: string;
    runtimeCost?: string | null;
    canStopSession: boolean;
    hasSessionActions: boolean;
    isExporting: boolean;
    sessionContextWindowSelector?: React.ReactNode;
    onCopyToClipboard: () => void;
    onStopSession: () => void;
    onExportToFile: () => void;
    onExportToCodex: () => void;
    onGenerateHandoff: () => void;
  }) => (
    <div data-testid="session-header">
      <div>{title}</div>
      <div>{meta}</div>
      <div>{statusLabel}</div>
      {runtimeCost ? <div>{runtimeCost}</div> : null}
      {sessionContextWindowSelector}
      <button
        type="button"
        title="Copy to clipboard"
        onClick={onCopyToClipboard}
        disabled={isExporting}
      >
        Copy
      </button>
      {canStopSession ? (
        <button type="button" title="Stop session" onClick={onStopSession} disabled={isExporting}>
          Stop
        </button>
      ) : null}
      {hasSessionActions ? (
        <>
          <button type="button" title="More actions" disabled={isExporting}>
            More actions
          </button>
          <button type="button" onClick={onExportToFile} disabled={isExporting}>
            Export to .txt file
          </button>
          <button type="button" onClick={onExportToCodex} disabled={isExporting}>
            Export to Codex
          </button>
          <button type="button" onClick={onGenerateHandoff} disabled={isExporting}>
            Generate Handoff (.md)
          </button>
        </>
      ) : null}
    </div>
  ),
}));

vi.mock("./session-context-window-selector", () => ({
  SessionContextWindowSelector: ({
    baseModel,
    value,
    options,
    onChange,
  }: {
    baseModel: string | null;
    value: "default" | "1m" | null;
    options: Array<{ value: "default" | "1m"; label: string }>;
    onChange: (value: "default" | "1m") => void;
  }) => {
    if (!baseModel || options.length < 2) {
      return null;
    }

    return (
      <select
        aria-label="Context Window"
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value as "default" | "1m")}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  },
}));

vi.mock("./session-composer", () => ({
  SessionComposer: ({
    input,
    canSend,
    isLoading,
    placeholder,
    onInputChange,
    onSend,
  }: {
    input: string;
    canSend: boolean;
    isLoading: boolean;
    placeholder?: string;
    onInputChange: (value: string) => void;
    onSend: () => void | Promise<void>;
  }) => (
    <div data-testid="session-composer">
      <textarea
        value={input}
        onChange={(event) =>
          onInputChange((event.target as HTMLTextAreaElement).value)
        }
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void onSend();
          }
        }}
        placeholder={placeholder}
        disabled={!canSend}
      />
      <button
        type="button"
        onClick={() => void onSend()}
        disabled={!input.trim() || !canSend}
        aria-busy={isLoading}
      >
        Send
      </button>
    </div>
  ),
}));

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

async function flushMicrotasks(times = 1) {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve();
  }
}

async function flushAsyncWork() {
  await flushMicrotasks(10);
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function flushUntil(
  predicate: () => boolean,
  attempts = 10,
): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (predicate()) {
      return;
    }

    await flushAsyncWork();
  }
}

describe("ActiveSessionPanel", () => {
  let container: HTMLDivElement | null;
  let root: Root | null;
  let randomUuidSpy: ReturnType<typeof vi.spyOn> | null;

  const defaultSession: SessionEntry = {
    sessionId: "session-123",
    fullPath: "/Users/demo/.claude/projects/tmp__project-a/session-123.jsonl",
    fileMtime: 0,
    firstPrompt: "Existing conversation",
    messageCount: 0,
    created: "2026-03-27T00:00:00.000Z",
    modified: "2026-03-27T00:00:00.000Z",
    projectPath: "/tmp/project-a",
    isSidechain: false,
    claudeModel: null,
    claudeContextWindow: null,
  };

  beforeEach(() => {
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    randomUuidSpy = vi
      .spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValue("00000000-0000-0000-0000-000000000000");
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    mocks.addToast.mockReset();
    mocks.dialogSave.mockReset();
    mocks.exportSession.mockReset();
    mocks.exportSessionToCodex.mockReset();
    mocks.getSessionCwd.mockReset();
    mocks.moveToTrash.mockReset();
    mocks.readGlobalClaudeConfig.mockReset();
    mocks.readSessionMessages.mockReset();
    mocks.sendSessionMessage.mockReset();
    mocks.startActiveSessionStream.mockReset();
    mocks.stopActiveSession.mockReset();
    mocks.updateSessionModelMetadata.mockReset();
    mocks.getWorkspaceDiff.mockReset();
    mocks.getWorkspaceFileContent.mockReset();
    mocks.getWorkspaceStatus.mockReset();
    mocks.getSessionCwd.mockResolvedValue("/tmp/project-a");
    mocks.getWorkspaceStatus.mockResolvedValue({
      branch: "feature/atelier",
      changedFiles: [],
      isGitRepo: true,
      totalChanged: 0,
      worktreeLabel: "atelier",
    });
    mocks.getWorkspaceDiff.mockResolvedValue({
      filePath: null,
      isGitRepo: true,
      status: null,
      unifiedDiff: "",
    });
    mocks.getWorkspaceFileContent.mockResolvedValue({
      filePath: "",
      content: "",
      exists: true,
      isBinary: false,
      tooLarge: false,
    });
    mocks.readSessionMessages.mockResolvedValue([]);
    useSessionStore.setState({ newSessionPrompt: null });
  });

  afterEach(() => {
    if (root) {
      flushSync(() => {
        root?.unmount();
      });
      root = null;
    }

    randomUuidSpy?.mockRestore();
    randomUuidSpy = null;
    container?.remove();
    container = null;
  });

  it("hides the session context window selector when no known base model exists", async () => {
    const { ActiveSessionPanel } = await import("./active-session-panel");

    mocks.readGlobalClaudeConfig.mockResolvedValueOnce(JSON.stringify({ model: "claude-sonnet-4-6" }));
    mocks.startActiveSessionStream.mockResolvedValue(vi.fn());
    mocks.stopActiveSession.mockResolvedValue();

    flushSync(() => {
      root?.render(<ActiveSessionPanel session={defaultSession} />);
    });

    await flushUntil(
      () => Boolean(container?.querySelector('[data-testid="session-header"]')),
      20,
    );

    expect(container?.querySelector('select[aria-label="Context Window"]')).toBeNull();
  });

  it("shows the session context window selector using the session model before global config", async () => {
    const { ActiveSessionPanel } = await import("./active-session-panel");

    mocks.readGlobalClaudeConfig.mockResolvedValueOnce(JSON.stringify({ model: "claude-sonnet-4-6" }));
    mocks.startActiveSessionStream.mockResolvedValue(vi.fn());
    mocks.stopActiveSession.mockResolvedValue();

    flushSync(() => {
      root?.render(
        <ActiveSessionPanel
          session={{
            ...defaultSession,
            claudeModel: "claude-opus-4-6",
          }}
        />,
      );
    });

    await flushUntil(
      () => Boolean(container?.querySelector('select[aria-label="Context Window"]')),
      20,
    );

    const selector = container?.querySelector(
      'select[aria-label="Context Window"]',
    ) as HTMLSelectElement | null;

    expect(selector).not.toBeNull();
    expect(selector?.value).toBe("default");
  });

  it("sends a live /model command and persists metadata after a successful connected switch", async () => {
    const { ActiveSessionPanel } = await import("./active-session-panel");

    mocks.readGlobalClaudeConfig.mockResolvedValueOnce(JSON.stringify({ model: "claude-opus-4-6" }));
    mocks.startActiveSessionStream.mockResolvedValue(vi.fn());
    mocks.stopActiveSession.mockResolvedValue();
    mocks.sendSessionMessage.mockResolvedValue();
    mocks.updateSessionModelMetadata.mockResolvedValue();
    useSessionStore.setState({
      selectedProject: {
        path: "/tmp/project-a",
        name: "project-a",
        sessionCount: 1,
        lastModified: "2026-03-27T00:00:00.000Z",
        escapedPath: "tmp__project-a",
        isMissing: false,
      },
    });

    flushSync(() => {
      root?.render(
        <ActiveSessionPanel
          session={{
            ...defaultSession,
            claudeModel: "claude-opus-4-6",
            claudeContextWindow: "1m",
          }}
        />,
      );
    });

    await flushUntil(
      () => Boolean(container?.querySelector('select[aria-label="Context Window"]')),
      20,
    );

    const selector = container?.querySelector(
      'select[aria-label="Context Window"]',
    ) as HTMLSelectElement | null;

    expect(selector?.value).toBe("1m");

    if (selector) {
      selector.value = "default";
      selector.dispatchEvent(new Event("change", { bubbles: true }));
    }

    expect(selector?.value).toBe("default");

    await flushUntil(
      () => mocks.sendSessionMessage.mock.calls.length > 0,
      20,
    );

    expect(mocks.sendSessionMessage).toHaveBeenCalledWith(
      "session-123",
      "/model claude-opus-4-6",
    );

    await flushUntil(
      () => mocks.updateSessionModelMetadata.mock.calls.length > 0,
      20,
    );

    expect(mocks.updateSessionModelMetadata).toHaveBeenCalledWith({
      escapedPath: "tmp__project-a",
      sessionId: "session-123",
      claudeModel: "claude-opus-4-6",
      claudeContextWindow: "default",
    });
  });

  it("persists live-switch metadata against the rendered session project when selectedProject differs", async () => {
    const { ActiveSessionPanel } = await import("./active-session-panel");

    mocks.readGlobalClaudeConfig.mockResolvedValueOnce(JSON.stringify({ model: "claude-opus-4-6" }));
    mocks.startActiveSessionStream.mockResolvedValue(vi.fn());
    mocks.stopActiveSession.mockResolvedValue();
    mocks.sendSessionMessage.mockResolvedValue();
    mocks.updateSessionModelMetadata.mockResolvedValue();
    useSessionStore.setState({
      selectedProject: {
        path: "/tmp/project-b",
        name: "project-b",
        sessionCount: 1,
        lastModified: "2026-03-27T00:00:00.000Z",
        escapedPath: "tmp__project-b",
        isMissing: false,
      },
    });

    flushSync(() => {
      root?.render(
        <ActiveSessionPanel
          session={{
            ...defaultSession,
            claudeModel: "claude-opus-4-6",
            claudeContextWindow: "1m",
          }}
        />,
      );
    });

    await flushUntil(
      () => Boolean(container?.querySelector('select[aria-label="Context Window"]')),
      20,
    );

    const selector = container?.querySelector(
      'select[aria-label="Context Window"]',
    ) as HTMLSelectElement | null;

    expect(selector?.value).toBe("1m");

    if (selector) {
      selector.value = "default";
      selector.dispatchEvent(new Event("change", { bubbles: true }));
    }

    await flushUntil(
      () => mocks.sendSessionMessage.mock.calls.length > 0,
      20,
    );

    expect(mocks.sendSessionMessage).toHaveBeenCalledWith(
      "session-123",
      "/model claude-opus-4-6",
    );

    await flushUntil(
      () => mocks.updateSessionModelMetadata.mock.calls.length > 0,
      20,
    );

    expect(mocks.updateSessionModelMetadata).toHaveBeenCalledWith({
      escapedPath: "tmp__project-a",
      sessionId: "session-123",
      claudeModel: "claude-opus-4-6",
      claudeContextWindow: "default",
    });
  });

  it("shows an error toast when a live switch persistence update fails", async () => {
    const { ActiveSessionPanel } = await import("./active-session-panel");

    mocks.readGlobalClaudeConfig.mockResolvedValueOnce(JSON.stringify({ model: "claude-opus-4-6" }));
    mocks.startActiveSessionStream.mockResolvedValue(vi.fn());
    mocks.stopActiveSession.mockResolvedValue();
    mocks.sendSessionMessage.mockResolvedValue();
    mocks.updateSessionModelMetadata.mockRejectedValueOnce(
      new Error("persist failed"),
    );

    flushSync(() => {
      root?.render(
        <ActiveSessionPanel
          session={{
            ...defaultSession,
            claudeModel: "claude-opus-4-6",
            claudeContextWindow: "1m",
          }}
        />,
      );
    });

    await flushUntil(
      () => Boolean(container?.querySelector('select[aria-label="Context Window"]')),
      20,
    );

    const selector = container?.querySelector(
      'select[aria-label="Context Window"]',
    ) as HTMLSelectElement | null;

    expect(selector?.value).toBe("1m");

    if (selector) {
      selector.value = "default";
      selector.dispatchEvent(new Event("change", { bubbles: true }));
    }

    await flushUntil(() => mocks.addToast.mock.calls.length > 0, 20);

    expect(mocks.sendSessionMessage).toHaveBeenCalledWith(
      "session-123",
      "/model claude-opus-4-6",
    );
    expect(mocks.addToast).toHaveBeenCalledWith(
      "studio request failed",
      "error",
    );
  });

  it("reverts the local context window selector when a live switch fails before persistence", async () => {
    const { ActiveSessionPanel } = await import("./active-session-panel");

    mocks.readGlobalClaudeConfig.mockResolvedValueOnce(JSON.stringify({ model: "claude-opus-4-6" }));
    mocks.startActiveSessionStream.mockResolvedValue(vi.fn());
    mocks.stopActiveSession.mockResolvedValue();
    mocks.sendSessionMessage.mockRejectedValueOnce(new Error("send failed"));

    flushSync(() => {
      root?.render(
        <ActiveSessionPanel
          session={{
            ...defaultSession,
            claudeModel: "claude-opus-4-6",
            claudeContextWindow: "1m",
          }}
        />,
      );
    });

    await flushUntil(
      () => Boolean(container?.querySelector('select[aria-label="Context Window"]')),
      20,
    );

    const selector = container?.querySelector(
      'select[aria-label="Context Window"]',
    ) as HTMLSelectElement | null;

    expect(selector?.value).toBe("1m");

    if (selector) {
      selector.value = "default";
      selector.dispatchEvent(new Event("change", { bubbles: true }));
    }

    expect(selector?.value).toBe("default");

    await flushUntil(() => mocks.addToast.mock.calls.length > 0, 20);

    expect(mocks.updateSessionModelMetadata).not.toHaveBeenCalled();
    expect(selector?.value).toBe("1m");
  });

  it("uses the global default context window when the session has no override", async () => {
    const { ActiveSessionPanel } = await import("./active-session-panel");

    mocks.readGlobalClaudeConfig.mockResolvedValueOnce(JSON.stringify({ model: "claude-opus-4-6[1m]" }));
    mocks.startActiveSessionStream.mockResolvedValue(vi.fn());
    mocks.stopActiveSession.mockResolvedValue();

    flushSync(() => {
      root?.render(
        <ActiveSessionPanel
          session={{
            ...defaultSession,
            claudeModel: null,
            claudeContextWindow: null,
          }}
        />,
      );
    });

    await flushUntil(
      () => Boolean(container?.querySelector('select[aria-label="Context Window"]')),
      20,
    );

    const selector = container?.querySelector(
      'select[aria-label="Context Window"]',
    ) as HTMLSelectElement | null;

    expect(selector?.value).toBe("1m");
  });

  it("does not send /model when the desired model already matches the connected session", async () => {
    const { ActiveSessionPanel } = await import("./active-session-panel");

    mocks.readGlobalClaudeConfig.mockResolvedValueOnce(JSON.stringify({ model: "claude-opus-4-6" }));
    mocks.startActiveSessionStream.mockResolvedValue(vi.fn());
    mocks.stopActiveSession.mockResolvedValue();

    flushSync(() => {
      root?.render(
        <ActiveSessionPanel
          session={{
            ...defaultSession,
            claudeModel: "claude-opus-4-6",
            claudeContextWindow: "default",
          }}
        />,
      );
    });

    await flushUntil(
      () => Boolean(container?.querySelector('select[aria-label="Context Window"]')),
      20,
    );

    const selector = container?.querySelector(
      'select[aria-label="Context Window"]',
    ) as HTMLSelectElement | null;

    expect(selector?.value).toBe("default");

    if (selector) {
      selector.value = "default";
      selector.dispatchEvent(new Event("change", { bubbles: true }));
    }

    await flushAsyncWork();

    expect(mocks.sendSessionMessage).not.toHaveBeenCalled();
    expect(mocks.updateSessionModelMetadata).not.toHaveBeenCalled();
  });

  it("does not send /model for a resumed session before the reconnect event, then reconciles after reconnect", async () => {
    const { ActiveSessionPanel } = await import("./active-session-panel");
    let onEvent:
      | ((event: Parameters<typeof mocks.startActiveSessionStream>[3]) => void)
      | undefined;

    mocks.readGlobalClaudeConfig.mockResolvedValueOnce(JSON.stringify({ model: "claude-opus-4-6" }));
    mocks.startActiveSessionStream.mockImplementationOnce(
      async (_sessionId, _cwd, _firstPrompt, handleEvent) => {
        onEvent = handleEvent;
        return vi.fn();
      },
    );
    mocks.stopActiveSession.mockResolvedValue();
    mocks.sendSessionMessage.mockResolvedValue();
    mocks.updateSessionModelMetadata.mockResolvedValue();

    flushSync(() => {
      root?.render(
        <ActiveSessionPanel
          session={{
            ...defaultSession,
            claudeModel: "claude-opus-4-6[1m]",
            claudeContextWindow: null,
          }}
        />,
      );
    });

    await flushAsyncWork();

    expect(mocks.startActiveSessionStream).toHaveBeenCalledWith(
      "session-123",
      "/tmp/project-a",
      undefined,
      expect.any(Function),
      expect.any(Function),
      "session-123",
      undefined,
    );
    expect(mocks.sendSessionMessage).not.toHaveBeenCalled();
    expect(mocks.updateSessionModelMetadata).not.toHaveBeenCalled();

    onEvent?.({ type: "system", session_id: "session-123" });
    await flushUntil(() => mocks.sendSessionMessage.mock.calls.length > 0, 20);

    expect(mocks.sendSessionMessage).toHaveBeenCalledWith(
      "session-123",
      "/model claude-opus-4-6",
    );
    expect(mocks.updateSessionModelMetadata).toHaveBeenCalledWith({
      escapedPath: "tmp__project-a",
      sessionId: "session-123",
      claudeModel: "claude-opus-4-6",
      claudeContextWindow: "default",
    });
  });

  it("does not reconcile a resumed session before a real reconnect event arrives", async () => {
    const { ActiveSessionPanel } = await import("./active-session-panel");

    mocks.readGlobalClaudeConfig.mockResolvedValueOnce(JSON.stringify({ model: "claude-opus-4-6" }));
    mocks.startActiveSessionStream.mockResolvedValue(vi.fn());
    mocks.stopActiveSession.mockResolvedValue();

    flushSync(() => {
      root?.render(
        <ActiveSessionPanel
          session={{
            ...defaultSession,
            claudeModel: "claude-opus-4-6[1m]",
            claudeContextWindow: "default",
          }}
        />,
      );
    });

    await flushUntil(
      () => Boolean(container?.querySelector('button[title="Stop session"]')),
      20,
    );

    expect(mocks.sendSessionMessage).not.toHaveBeenCalled();
    expect(mocks.updateSessionModelMetadata).not.toHaveBeenCalled();
  });

  it("retries resumed-session reconciliation after an initial live switch failure", async () => {
    const { ActiveSessionPanel } = await import("./active-session-panel");
    let onEvent:
      | ((event: Parameters<typeof mocks.startActiveSessionStream>[3]) => void)
      | undefined;

    mocks.readGlobalClaudeConfig.mockResolvedValueOnce(JSON.stringify({ model: "claude-opus-4-6" }));
    mocks.startActiveSessionStream.mockImplementationOnce(
      async (_sessionId, _cwd, _firstPrompt, handleEvent) => {
        onEvent = handleEvent;
        return vi.fn();
      },
    );
    mocks.stopActiveSession.mockResolvedValue();
    mocks.sendSessionMessage
      .mockRejectedValueOnce(new Error("send failed"))
      .mockResolvedValueOnce();
    mocks.updateSessionModelMetadata.mockResolvedValue();

    flushSync(() => {
      root?.render(
        <ActiveSessionPanel
          session={{
            ...defaultSession,
            claudeModel: "claude-opus-4-6[1m]",
            claudeContextWindow: null,
          }}
        />,
      );
    });

    await flushAsyncWork();

    onEvent?.({ type: "system", session_id: "session-123" });
    await flushUntil(() => mocks.addToast.mock.calls.length > 0, 20);

    expect(mocks.sendSessionMessage).toHaveBeenCalledTimes(1);
    expect(mocks.sendSessionMessage).toHaveBeenNthCalledWith(
      1,
      "session-123",
      "/model claude-opus-4-6",
    );
    expect(mocks.updateSessionModelMetadata).not.toHaveBeenCalled();

    onEvent?.({ type: "system", session_id: "session-123" });
    await flushUntil(() => mocks.sendSessionMessage.mock.calls.length > 1, 20);

    expect(mocks.sendSessionMessage).toHaveBeenCalledTimes(2);
    expect(mocks.sendSessionMessage).toHaveBeenNthCalledWith(
      2,
      "session-123",
      "/model claude-opus-4-6",
    );
    expect(mocks.updateSessionModelMetadata).toHaveBeenCalledWith({
      escapedPath: "tmp__project-a",
      sessionId: "session-123",
      claudeModel: "claude-opus-4-6",
      claudeContextWindow: "default",
    });
  });

  it("does not reconcile a resumed session when the desired model already matches stored metadata", async () => {
    const { ActiveSessionPanel } = await import("./active-session-panel");
    let onEvent:
      | ((event: Parameters<typeof mocks.startActiveSessionStream>[3]) => void)
      | undefined;

    mocks.readGlobalClaudeConfig.mockResolvedValueOnce(JSON.stringify({ model: "claude-opus-4-6" }));
    mocks.startActiveSessionStream.mockImplementationOnce(
      async (_sessionId, _cwd, _firstPrompt, handleEvent) => {
        onEvent = handleEvent;
        return vi.fn();
      },
    );
    mocks.stopActiveSession.mockResolvedValue();

    flushSync(() => {
      root?.render(
        <ActiveSessionPanel
          session={{
            ...defaultSession,
            claudeModel: "claude-opus-4-6",
            claudeContextWindow: "default",
          }}
        />,
      );
    });

    await flushAsyncWork();

    onEvent?.({ type: "system", session_id: "session-123" });
    await flushAsyncWork();

    expect(mocks.sendSessionMessage).not.toHaveBeenCalled();
    expect(mocks.updateSessionModelMetadata).not.toHaveBeenCalled();
  });

  it("does not add an error toast when cancelled init hits a benign session-not-active race", async () => {
    const { ActiveSessionPanel } = await import("./active-session-panel");
    const deferred = createDeferred<() => void>();
    const stop = vi.fn();

    mocks.startActiveSessionStream.mockReturnValueOnce(deferred.promise);
    mocks.stopActiveSession.mockImplementation(() =>
      Promise.reject(new Error("session not active")),
    );

    flushSync(() => {
      root?.render(<ActiveSessionPanel newSessionProject="/tmp/project" />);
    });

    await Promise.resolve();

    flushSync(() => {
      root?.unmount();
      root = null;
    });

    deferred.resolve(stop);
    await deferred.promise;
    await Promise.resolve();
    await Promise.resolve();

    expect(stop).toHaveBeenCalledTimes(1);
    expect(mocks.stopActiveSession).toHaveBeenCalledWith(
      "00000000-0000-0000-0000-000000000000",
    );
    expect(mocks.stopActiveSession).toHaveBeenCalledTimes(1);
    expect(mocks.addToast).not.toHaveBeenCalled();
  });

  it("adds one error toast when cancelled init hits a real stop failure", async () => {
    const { ActiveSessionPanel } = await import("./active-session-panel");
    const deferred = createDeferred<() => void>();
    const stop = vi.fn();

    mocks.startActiveSessionStream.mockReturnValueOnce(deferred.promise);
    mocks.stopActiveSession.mockImplementation(() =>
      Promise.reject(new Error("stop signal failed")),
    );

    flushSync(() => {
      root?.render(<ActiveSessionPanel newSessionProject="/tmp/project" />);
    });

    await Promise.resolve();

    flushSync(() => {
      root?.unmount();
      root = null;
    });

    deferred.resolve(stop);
    await deferred.promise;
    await Promise.resolve();
    await Promise.resolve();

    expect(stop).toHaveBeenCalledTimes(1);
    expect(mocks.stopActiveSession).toHaveBeenCalledWith(
      "00000000-0000-0000-0000-000000000000",
    );
    expect(mocks.stopActiveSession).toHaveBeenCalledTimes(1);
    expect(mocks.addToast).toHaveBeenCalledTimes(1);
    expect(mocks.addToast).toHaveBeenCalledWith(
      "Failed to stop active session: stop signal failed",
      "error",
    );
  });

  it("uses the streamed session id for cancelled-init cleanup", async () => {
    const { ActiveSessionPanel } = await import("./active-session-panel");
    const deferred = createDeferred<() => void>();
    const stop = vi.fn();

    mocks.startActiveSessionStream.mockImplementationOnce(
      async (_sessionId, _cwd, _firstPrompt, onEvent) => {
        onEvent({ type: "system", session_id: "session-123" });
        return deferred.promise;
      },
    );
    mocks.stopActiveSession.mockImplementation(async () => {
      await Promise.resolve();
    });

    flushSync(() => {
      root?.render(<ActiveSessionPanel newSessionProject="/tmp/project" />);
    });

    await Promise.resolve();

    flushSync(() => {
      root?.unmount();
      root = null;
    });

    deferred.resolve(stop);
    await deferred.promise;
    await Promise.resolve();
    await Promise.resolve();

    expect(stop).toHaveBeenCalledTimes(1);
    expect(mocks.stopActiveSession).toHaveBeenCalledTimes(1);
    expect(mocks.stopActiveSession).toHaveBeenCalledWith("session-123");
    expect(mocks.addToast).not.toHaveBeenCalled();
  });

  it("uses a generated session id for cleanup before the first system event arrives", async () => {
    const { ActiveSessionPanel } = await import("./active-session-panel");
    const deferred = createDeferred<() => void>();
    const stop = vi.fn();

    mocks.startActiveSessionStream.mockReturnValueOnce(deferred.promise);
    mocks.stopActiveSession.mockImplementation(async () => {
      await Promise.resolve();
    });

    flushSync(() => {
      root?.render(<ActiveSessionPanel newSessionProject="/tmp/project" />);
    });

    await Promise.resolve();

    flushSync(() => {
      root?.unmount();
      root = null;
    });

    deferred.resolve(stop);
    await deferred.promise;
    await Promise.resolve();
    await Promise.resolve();

    expect(mocks.startActiveSessionStream).toHaveBeenCalledWith(
      "00000000-0000-0000-0000-000000000000",
      "/tmp/project",
      undefined,
      expect.any(Function),
      expect.any(Function),
      undefined,
      undefined,
    );
    expect(stop).toHaveBeenCalledTimes(1);
    expect(mocks.stopActiveSession).toHaveBeenCalledTimes(1);
    expect(mocks.stopActiveSession).toHaveBeenCalledWith(
      "00000000-0000-0000-0000-000000000000",
    );
    expect(mocks.addToast).not.toHaveBeenCalled();
  });

  it("uses a fresh generated session id when switching to a different new session in place", async () => {
    const { ActiveSessionPanel } = await import("./active-session-panel");
    const firstStop = vi.fn();
    const secondStop = vi.fn();

    randomUuidSpy?.mockRestore();
    randomUuidSpy = vi
      .spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValueOnce("11111111-1111-1111-1111-111111111111")
      .mockReturnValueOnce("22222222-2222-2222-2222-222222222222");

    mocks.startActiveSessionStream
      .mockResolvedValueOnce(firstStop)
      .mockResolvedValueOnce(secondStop);
    mocks.stopActiveSession.mockImplementation(async () => {
      await Promise.resolve();
    });

    flushSync(() => {
      root?.render(<ActiveSessionPanel newSessionProject="/tmp/project-a" />);
    });

    await Promise.resolve();
    await Promise.resolve();

    flushSync(() => {
      root?.render(<ActiveSessionPanel newSessionProject="/tmp/project-b" />);
    });

    await Promise.resolve();
    await Promise.resolve();

    const firstStartCall = mocks.startActiveSessionStream.mock.calls[0];
    expect(firstStartCall?.[0]).toBe("11111111-1111-1111-1111-111111111111");
    expect(firstStartCall?.[1]).toBe("/tmp/project-a");
    expect(firstStartCall?.[2]).toBeUndefined();
    expect(firstStartCall?.[3]).toEqual(expect.any(Function));
    expect(firstStartCall?.[4]).toEqual(expect.any(Function));
    expect(firstStartCall?.[5]).toBeUndefined();

    const secondStartCall = mocks.startActiveSessionStream.mock.calls[1];
    expect(secondStartCall?.[0]).toBe("22222222-2222-2222-2222-222222222222");
    expect(secondStartCall?.[1]).toBe("/tmp/project-b");
    expect(secondStartCall?.[2]).toBeUndefined();
    expect(secondStartCall?.[3]).toEqual(expect.any(Function));
    expect(secondStartCall?.[4]).toEqual(expect.any(Function));
    expect(secondStartCall?.[5]).toBeUndefined();
    expect(firstStop).toHaveBeenCalledTimes(1);
  });

  it("does not reuse the previous stop handle when the next session unmounts before init settles", async () => {
    const { ActiveSessionPanel } = await import("./active-session-panel");
    const secondStartDeferred = createDeferred<() => void>();
    const firstStop = vi.fn();
    const secondStop = vi.fn();

    randomUuidSpy?.mockRestore();
    randomUuidSpy = vi
      .spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValueOnce("11111111-1111-1111-1111-111111111111")
      .mockReturnValueOnce("22222222-2222-2222-2222-222222222222");

    mocks.startActiveSessionStream
      .mockResolvedValueOnce(firstStop)
      .mockReturnValueOnce(secondStartDeferred.promise);
    mocks.stopActiveSession.mockImplementation(async () => {
      await Promise.resolve();
    });

    flushSync(() => {
      root?.render(<ActiveSessionPanel newSessionProject="/tmp/project-a" />);
    });

    await Promise.resolve();
    await Promise.resolve();

    flushSync(() => {
      root?.render(<ActiveSessionPanel newSessionProject="/tmp/project-b" />);
    });

    await Promise.resolve();

    flushSync(() => {
      root?.unmount();
      root = null;
    });

    secondStartDeferred.resolve(secondStop);
    await secondStartDeferred.promise;
    await Promise.resolve();
    await Promise.resolve();

    expect(firstStop).toHaveBeenCalledTimes(1);
    expect(secondStop).toHaveBeenCalledTimes(1);
    expect(mocks.stopActiveSession).toHaveBeenCalledTimes(2);
    expect(mocks.stopActiveSession).toHaveBeenNthCalledWith(
      1,
      "11111111-1111-1111-1111-111111111111",
    );
    expect(mocks.stopActiveSession).toHaveBeenNthCalledWith(
      2,
      "22222222-2222-2222-2222-222222222222",
    );
  });

  it("ignores stale callbacks from the previous session after an in-place switch", async () => {
    const { ActiveSessionPanel } = await import("./active-session-panel");
    const firstStop = vi.fn();
    const secondStop = vi.fn();
    let firstOnEvent:
      | ((event: Parameters<typeof mocks.startActiveSessionStream>[3]) => void)
      | undefined;
    let firstOnDone: (() => void) | undefined;

    randomUuidSpy?.mockRestore();
    randomUuidSpy = vi
      .spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValueOnce("11111111-1111-1111-1111-111111111111")
      .mockReturnValueOnce("22222222-2222-2222-2222-222222222222");

    mocks.startActiveSessionStream
      .mockImplementationOnce(
        async (_sessionId, _cwd, _firstPrompt, onEvent, onDone) => {
          firstOnEvent = onEvent;
          firstOnDone = onDone;
          return firstStop;
        },
      )
      .mockResolvedValueOnce(secondStop);
    mocks.stopActiveSession.mockImplementation(async () => {
      await Promise.resolve();
    });

    flushSync(() => {
      root?.render(<ActiveSessionPanel newSessionProject="/tmp/project-a" />);
    });

    await Promise.resolve();
    await Promise.resolve();

    flushSync(() => {
      root?.render(<ActiveSessionPanel newSessionProject="/tmp/project-b" />);
    });

    await Promise.resolve();
    await Promise.resolve();

    firstOnEvent?.({ type: "system", session_id: "stale-session-id" });
    firstOnEvent?.({ type: "error", error: "stale stream error" });
    firstOnDone?.();
    await Promise.resolve();

    flushSync(() => {
      root?.unmount();
      root = null;
    });

    expect(mocks.addToast).not.toHaveBeenCalled();
    expect(mocks.stopActiveSession).toHaveBeenCalledTimes(2);
    expect(mocks.stopActiveSession).toHaveBeenNthCalledWith(
      1,
      "11111111-1111-1111-1111-111111111111",
    );
    expect(mocks.stopActiveSession).toHaveBeenNthCalledWith(
      2,
      "22222222-2222-2222-2222-222222222222",
    );
  });

  it("renders extracted header, transcript, composer, and diff inspector regions", async () => {
    const { ActiveSessionPanel } = await import("./active-session-panel");

    mocks.getSessionCwd.mockResolvedValueOnce("/tmp/resolved-project-a");
    mocks.getWorkspaceStatus.mockResolvedValueOnce({
      branch: "feature/atelier",
      changedFiles: [{ path: "src/app.tsx", status: "modified" }],
      isGitRepo: true,
      totalChanged: 1,
      worktreeLabel: "atelier",
    });
    mocks.getWorkspaceDiff.mockResolvedValueOnce({
      filePath: "src/app.tsx",
      isGitRepo: true,
      status: "modified",
      unifiedDiff: [
        "diff --git a/src/app.tsx b/src/app.tsx",
        "@@ -1 +1 @@",
        "-old line",
        "+new line",
      ].join("\n"),
    });
    mocks.startActiveSessionStream.mockResolvedValue(vi.fn());
    mocks.stopActiveSession.mockImplementation(async () => {
      await Promise.resolve();
    });

    flushSync(() => {
      root?.render(
        <ActiveSessionPanel
          session={{
            sessionId: "session-a",
            fullPath: "/tmp/session-a.jsonl",
            fileMtime: 1,
            firstPrompt: "Session A",
            messageCount: 1,
            created: "2026-03-08T00:00:00.000Z",
            modified: "2026-03-08T00:00:00.000Z",
            projectPath: "",
            isSidechain: false,
          }}
        />,
      );
    });

    await flushUntil(
      () =>
        Boolean(
          container?.textContent?.includes(
            "diff --git a/src/app.tsx b/src/app.tsx",
          ),
        ),
      20,
    );

    expect(
      container?.querySelector('[data-testid="session-header"]'),
    ).not.toBeNull();
    expect(
      container?.querySelector('[data-testid="session-transcript"]'),
    ).not.toBeNull();
    expect(
      container?.querySelector('[data-testid="session-composer"]'),
    ).not.toBeNull();
    expect(
      container?.querySelector('[data-testid="session-diff-panel"]'),
    ).not.toBeNull();
    expect(container?.textContent).toContain("Session A");
    expect(container?.textContent).toContain("/tmp/resolved-project-a");
    expect(container?.textContent).toContain("Ready");
    expect(container?.textContent).toContain("Changes");
    expect(container?.textContent).toContain("app.tsx");
    expect(container?.textContent).toContain(
      "diff --git a/src/app.tsx b/src/app.tsx",
    );
  });

  it("keeps the file list visible when a selected diff fails to load", async () => {
    const { ActiveSessionPanel } = await import("./active-session-panel");

    mocks.getSessionCwd.mockResolvedValueOnce("/tmp/resolved-project-a");
    mocks.getWorkspaceStatus.mockResolvedValueOnce({
      branch: "feature/atelier",
      changedFiles: [{ path: "src/app.tsx", status: "modified" }],
      isGitRepo: true,
      totalChanged: 1,
      worktreeLabel: "atelier",
    });
    mocks.getWorkspaceDiff.mockRejectedValueOnce(new Error("diff failed"));
    mocks.startActiveSessionStream.mockResolvedValue(vi.fn());
    mocks.stopActiveSession.mockImplementation(async () => {
      await Promise.resolve();
    });

    flushSync(() => {
      root?.render(
        <ActiveSessionPanel
          session={{
            sessionId: "session-a",
            fullPath: "/tmp/session-a.jsonl",
            fileMtime: 1,
            firstPrompt: "Session A",
            messageCount: 1,
            created: "2026-03-08T00:00:00.000Z",
            modified: "2026-03-08T00:00:00.000Z",
            projectPath: "",
            isSidechain: false,
          }}
        />,
      );
    });

    await flushUntil(
      () => Boolean(container?.textContent?.includes("diff failed")),
      20,
    );

    expect(
      container?.querySelector('[data-testid="session-diff-panel"]'),
    ).not.toBeNull();
    expect(container?.textContent).toContain("Changes");
    expect(container?.textContent).toContain("app.tsx");
    expect(container?.textContent).toContain("diff failed");
  });

  it("renders read-only file preview for the selected changed file", async () => {
    const { ActiveSessionPanel } = await import("./active-session-panel");

    mocks.getWorkspaceStatus.mockResolvedValueOnce({
      branch: "feature/atelier",
      changedFiles: [{ path: "src/app.tsx", status: "modified" }],
      isGitRepo: true,
      totalChanged: 1,
      worktreeLabel: "atelier",
    });
    mocks.getWorkspaceDiff.mockResolvedValueOnce({
      filePath: "src/app.tsx",
      isGitRepo: true,
      status: "modified",
      unifiedDiff: "@@ -1 +1 @@\n-old\n+new",
    });
    mocks.getWorkspaceFileContent.mockResolvedValueOnce({
      filePath: "src/app.tsx",
      content: "export const App = () => null;\n",
      exists: true,
      isBinary: false,
      tooLarge: false,
    });
    mocks.startActiveSessionStream.mockResolvedValue(vi.fn());
    mocks.stopActiveSession.mockImplementation(async () => {
      await Promise.resolve();
    });

    flushSync(() => {
      root?.render(<ActiveSessionPanel newSessionProject="/tmp/project-a" />);
    });

    await flushUntil(
      () => Boolean(container?.textContent?.includes("app.tsx")),
      20,
    );

    const previewButton = [
      ...(container?.querySelectorAll("button") ?? []),
    ].find((button) => button.textContent?.includes("Preview"));
    previewButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await flushUntil(
      () =>
        Boolean(
          container?.textContent?.includes("export const App = () => null;"),
        ),
      20,
    );

    expect(mocks.getWorkspaceFileContent).toHaveBeenCalledWith(
      "/tmp/project-a",
      "src/app.tsx",
    );
    expect(container?.textContent).toContain("export const App = () => null;");
  });

  it("keeps file list and diff mode usable when preview load fails", async () => {
    const { ActiveSessionPanel } = await import("./active-session-panel");

    mocks.getWorkspaceStatus.mockResolvedValueOnce({
      branch: "feature/atelier",
      changedFiles: [{ path: "src/app.tsx", status: "modified" }],
      isGitRepo: true,
      totalChanged: 1,
      worktreeLabel: "atelier",
    });
    mocks.getWorkspaceDiff.mockResolvedValueOnce({
      filePath: "src/app.tsx",
      isGitRepo: true,
      status: "modified",
      unifiedDiff: "diff --git a/src/app.tsx b/src/app.tsx\n+new line",
    });
    mocks.getWorkspaceFileContent.mockRejectedValueOnce(
      new Error("preview exploded"),
    );
    mocks.startActiveSessionStream.mockResolvedValue(vi.fn());
    mocks.stopActiveSession.mockImplementation(async () => {
      await Promise.resolve();
    });

    flushSync(() => {
      root?.render(<ActiveSessionPanel newSessionProject="/tmp/project-a" />);
    });

    await flushUntil(
      () => Boolean(container?.textContent?.includes("app.tsx")),
      20,
    );

    const previewButton = [
      ...(container?.querySelectorAll("button") ?? []),
    ].find((button) => button.textContent?.includes("Preview"));
    previewButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await flushUntil(
      () => Boolean(container?.textContent?.includes("preview exploded")),
      20,
    );

    const diffButton = [...(container?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent?.includes("Diff"),
    );
    diffButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await flushUntil(
      () => Boolean(container?.textContent?.includes("+new line")),
      20,
    );

    expect(container?.textContent).toContain("app.tsx");
    expect(container?.textContent).toContain("+new line");
  });

  it("enables the composer after stream startup before the first system event arrives", async () => {
    const { ActiveSessionPanel } = await import("./active-session-panel");

    mocks.startActiveSessionStream.mockResolvedValueOnce(vi.fn());
    mocks.stopActiveSession.mockImplementation(async () => {
      await Promise.resolve();
    });

    flushSync(() => {
      root?.render(<ActiveSessionPanel newSessionProject="/tmp/project" />);
    });

    await flushAsyncWork();

    const textarea = container?.querySelector("textarea");
    if (!(textarea instanceof HTMLTextAreaElement)) {
      throw new TypeError("Failed to find session textarea");
    }

    expect(textarea.disabled).toBe(false);
    expect(textarea.placeholder).toBe(
      "Message Claude... (Enter to send, Shift+Enter for newline)",
    );
  });

  it("keeps showing a connecting indicator while waiting for the first stream event after the optimize-rules prompt appears", async () => {
    const { ActiveSessionPanel } = await import("./active-session-panel");
    const optimizeRulesPrompt =
      "Please review my ~/.claude/settings.json 'allow' and 'deny' lists and group similar commands together using wildcards.";

    useSessionStore.setState({ newSessionPrompt: optimizeRulesPrompt });
    mocks.startActiveSessionStream.mockResolvedValue(vi.fn());
    mocks.stopActiveSession.mockImplementation(async () => {
      await Promise.resolve();
    });

    flushSync(() => {
      root?.render(<ActiveSessionPanel newSessionProject="/tmp/project" />);
    });

    await flushAsyncWork();

    expect(container?.textContent).toContain(optimizeRulesPrompt);
    expect(container?.textContent).toContain("Connecting to session...");
  });

  it("keeps the optimize-rules session in connecting state when only the handshake event arrives", async () => {
    const { ActiveSessionPanel } = await import("./active-session-panel");
    const optimizeRulesPrompt =
      "Please review my ~/.claude/settings.json 'allow' and 'deny' lists and group similar commands together using wildcards.";
    let onEvent:
      | ((event: Parameters<typeof mocks.startActiveSessionStream>[3]) => void)
      | undefined;

    useSessionStore.setState({ newSessionPrompt: optimizeRulesPrompt });
    mocks.startActiveSessionStream.mockImplementationOnce(
      async (_sessionId, _cwd, _firstPrompt, handleEvent) => {
        onEvent = handleEvent;
        return vi.fn();
      },
    );
    mocks.stopActiveSession.mockImplementation(async () => {
      await Promise.resolve();
    });

    flushSync(() => {
      root?.render(<ActiveSessionPanel newSessionProject="/tmp/project" />);
    });

    await flushAsyncWork();

    onEvent?.({ type: "system", session_id: "session-123" });
    await flushAsyncWork();

    expect(container?.textContent).toContain(optimizeRulesPrompt);
    expect(container?.textContent).toContain("Connecting to session...");
    expect(container?.textContent).not.toContain("Ready");
  });

  it("renders collapsed tool calls from loaded history", async () => {
    const { ActiveSessionPanel } = await import("./active-session-panel");

    mocks.readSessionMessages.mockResolvedValueOnce([
      {
        role: "assistant",
        content: [
          { type: "text", text: "Before" },
          {
            type: "tool_use",
            name: "Skill",
            input: { skill: "using-superpowers" },
          },
          { type: "text", text: "After" },
        ],
      },
    ] as Awaited<ReturnType<typeof mocks.readSessionMessages>>);
    mocks.startActiveSessionStream.mockResolvedValue(vi.fn());
    mocks.stopActiveSession.mockResolvedValue();

    flushSync(() => {
      root?.render(<ActiveSessionPanel session={defaultSession} />);
    });

    await flushUntil(() => Boolean(container?.textContent?.includes("Skill tool call")), 20);

    const details = container?.querySelector("details");
    if (!(details instanceof HTMLDetailsElement)) {
      throw new TypeError("Expected tool call details element");
    }

    expect(container?.textContent).toContain("Before");
    expect(container?.textContent).toContain("After");
    expect(container?.textContent).toContain("Skill tool call");
    expect(details.open).toBe(false);
  });

  it("does not render meta skill payloads from history as user messages", async () => {
    const { ActiveSessionPanel } = await import("./active-session-panel");

    mocks.readSessionMessages.mockResolvedValueOnce([
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            name: "Skill",
            input: { skill: "verification-before-completion" },
          },
        ],
      },
      {
        role: "user",
        isMeta: true,
        content: [
          {
            type: "text",
            text: "Base directory for this skill: /Users/vyductan/.claude/plugins/cache/claude-plugins-official/superpowers/4.3.1/skills/verification-before-completion",
          },
        ],
      },
    ] as Awaited<ReturnType<typeof mocks.readSessionMessages>>);
    mocks.startActiveSessionStream.mockResolvedValue(vi.fn());
    mocks.stopActiveSession.mockResolvedValue();

    flushSync(() => {
      root?.render(<ActiveSessionPanel session={defaultSession} />);
    });

    await flushUntil(() => Boolean(container?.textContent?.includes("Skill tool call")), 20);

    expect(container?.textContent).toContain("Skill tool call");
    expect(container?.textContent).not.toContain("Base directory for this skill:");
  });

  it("collapses compacted history summaries from loaded history", async () => {
    const { ActiveSessionPanel } = await import("./active-session-panel");

    mocks.readSessionMessages.mockResolvedValueOnce([
      {
        role: "user",
        isCompactSummary: true,
        content:
          "This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.\n\nSummary:\n1. Primary Request and Intent...",
      },
    ] as Awaited<ReturnType<typeof mocks.readSessionMessages>>);
    mocks.startActiveSessionStream.mockResolvedValue(vi.fn());
    mocks.stopActiveSession.mockResolvedValue();

    flushSync(() => {
      root?.render(<ActiveSessionPanel session={defaultSession} />);
    });

    await flushUntil(
      () =>
        Boolean(
          container?.textContent?.includes(
            "Conversation was compacted to free up context",
          ),
        ),
      20,
    );

    const details = container?.querySelector("details");
    if (!(details instanceof HTMLDetailsElement)) {
      throw new TypeError("Expected compacted summary details element");
    }

    expect(container?.textContent).toContain(
      "Conversation was compacted to free up context",
    );
    expect(details.open).toBe(false);
  });

  it("keeps startup responses busy until the first turn completes", async () => {
    const { ActiveSessionPanel } = await import("./active-session-panel");
    const optimizeRulesPrompt =
      "Please review my ~/.claude/settings.json 'allow' and 'deny' lists and group similar commands together using wildcards.";
    let onEvent:
      | ((event: Parameters<typeof mocks.startActiveSessionStream>[3]) => void)
      | undefined;

    useSessionStore.setState({ newSessionPrompt: optimizeRulesPrompt });
    mocks.startActiveSessionStream.mockImplementationOnce(
      async (_sessionId, _cwd, _firstPrompt, handleEvent) => {
        onEvent = handleEvent;
        return vi.fn();
      },
    );
    mocks.stopActiveSession.mockImplementation(async () => {
      await Promise.resolve();
    });

    flushSync(() => {
      root?.render(<ActiveSessionPanel newSessionProject="/tmp/project" />);
    });

    await flushAsyncWork();

    const textarea = container?.querySelector("textarea");
    if (!(textarea instanceof HTMLTextAreaElement)) {
      throw new TypeError("Failed to find session textarea");
    }

    onEvent?.({ type: "system", session_id: "session-123" });
    onEvent?.({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "Using update-config to clean up your settings." },
        ],
      },
    });
    await flushAsyncWork();

    expect(container?.textContent).toContain(
      "Using update-config to clean up your settings.",
    );
    expect(container?.textContent).toContain("Claude is working...");
    expect(container?.textContent).toContain("Responding");
    expect(textarea.disabled).toBe(true);

    onEvent?.({ type: "result" });
    await flushAsyncWork();

    expect(container?.textContent).not.toContain("Claude is working...");
    expect(container?.textContent).toContain("Ready");
    expect(textarea.disabled).toBe(false);
  });

  it("renders assistant streaming updates through normalized workspace state", async () => {
    const { ActiveSessionPanel } = await import("./active-session-panel");
    let onEvent:
      | ((event: Parameters<typeof mocks.startActiveSessionStream>[3]) => void)
      | undefined;

    mocks.startActiveSessionStream.mockImplementationOnce(
      async (_sessionId, _cwd, _firstPrompt, handleEvent) => {
        onEvent = handleEvent;
        return vi.fn();
      },
    );
    mocks.stopActiveSession.mockImplementation(async () => {
      await Promise.resolve();
    });

    flushSync(() => {
      root?.render(<ActiveSessionPanel newSessionProject="/tmp/project" />);
    });

    await flushAsyncWork();

    onEvent?.({ type: "system", session_id: "session-123" });
    onEvent?.({
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Hello" }],
      },
    });
    await flushAsyncWork();

    expect(container?.textContent).toContain("Hello");
    expect(container?.textContent).toContain("Responding");
    expect(
      container?.querySelector(
        '[data-testid="session-transcript"] .animate-pulse',
      ),
    ).not.toBeNull();

    onEvent?.({
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "text", text: " there" }],
      },
    });
    onEvent?.({ type: "result" });
    await flushAsyncWork();

    expect(container?.textContent).toContain("Hello there");
    expect(container?.textContent).toContain("Ready");
    expect(
      container?.querySelector(
        '[data-testid="session-transcript"] .animate-pulse',
      ),
    ).toBeNull();
  });

  it("scrolls to the latest assistant output while workspace transcript streams", async () => {
    const { ActiveSessionPanel } = await import("./active-session-panel");
    let onEvent:
      | ((event: Parameters<typeof mocks.startActiveSessionStream>[3]) => void)
      | undefined;
    const scrollIntoViewMock = vi.mocked(Element.prototype.scrollIntoView);

    mocks.startActiveSessionStream.mockImplementationOnce(
      async (_sessionId, _cwd, _firstPrompt, handleEvent) => {
        onEvent = handleEvent;
        return vi.fn();
      },
    );
    mocks.stopActiveSession.mockImplementation(async () => {
      await Promise.resolve();
    });

    flushSync(() => {
      root?.render(<ActiveSessionPanel newSessionProject="/tmp/project" />);
    });

    await flushAsyncWork();
    scrollIntoViewMock.mockClear();

    onEvent?.({ type: "system", session_id: "session-123" });
    onEvent?.({
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Hello" }],
      },
    });
    await flushAsyncWork();

    expect(scrollIntoViewMock).toHaveBeenCalled();
  });

  it("avoids smooth scrolling while assistant output is streaming", async () => {
    const { ActiveSessionPanel } = await import("./active-session-panel");
    let onEvent:
      | ((event: Parameters<typeof mocks.startActiveSessionStream>[3]) => void)
      | undefined;
    const scrollIntoViewMock = vi.mocked(Element.prototype.scrollIntoView);

    mocks.startActiveSessionStream.mockImplementationOnce(
      async (_sessionId, _cwd, _firstPrompt, handleEvent) => {
        onEvent = handleEvent;
        return vi.fn();
      },
    );
    mocks.stopActiveSession.mockImplementation(async () => {
      await Promise.resolve();
    });

    flushSync(() => {
      root?.render(<ActiveSessionPanel newSessionProject="/tmp/project" />);
    });

    await flushAsyncWork();
    scrollIntoViewMock.mockClear();

    onEvent?.({ type: "system", session_id: "session-123" });
    await flushAsyncWork();
    scrollIntoViewMock.mockClear();

    onEvent?.({
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Hello" }],
      },
    });
    onEvent?.({
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "text", text: " there" }],
      },
    });
    await flushAsyncWork();

    expect(scrollIntoViewMock).toHaveBeenCalled();
    expect(scrollIntoViewMock).not.toHaveBeenCalledWith({ behavior: "smooth" });
  });

  it("surfaces a startup failure in the banner without inserting a transcript system message", async () => {
    const { ActiveSessionPanel } = await import("./active-session-panel");

    mocks.startActiveSessionStream.mockRejectedValueOnce(
      new Error("stream startup failed"),
    );
    mocks.stopActiveSession.mockImplementation(async () => {
      await Promise.resolve();
    });

    flushSync(() => {
      root?.render(<ActiveSessionPanel newSessionProject="/tmp/project" />);
    });

    await flushAsyncWork();

    const textarea = container?.querySelector("textarea");
    const transcript = container?.querySelector('[data-testid="session-transcript"]');
    const banner = container?.querySelector('[data-testid="session-error-banner"]');
    if (!(textarea instanceof HTMLTextAreaElement)) {
      throw new TypeError("Failed to find session textarea");
    }
    if (!(transcript instanceof HTMLElement)) {
      throw new TypeError("Failed to find session transcript");
    }
    if (!(banner instanceof HTMLElement)) {
      throw new TypeError("Failed to find session error banner");
    }

    expect(container?.textContent).toContain("studio request failed");
    expect(container?.textContent).toContain("Reopen or start a new session.");
    expect(container?.textContent).toContain("Error");
    expect(container?.textContent).not.toContain("Loading session...");
    expect(textarea.disabled).toBe(true);
    expect(textarea.placeholder).toBe(
      "Session unavailable. Reopen or start a new session.",
    );
    expect(transcript.textContent).not.toContain("studio request failed");
    expect(banner.textContent).toContain("studio request failed");
    expect(
      banner.compareDocumentPosition(transcript) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(mocks.addToast).toHaveBeenCalledWith(
      "studio request failed",
      "error",
    );
  });

  it("renders runtime errors in a dedicated banner above the transcript while keeping the composer unavailable", async () => {
    const { ActiveSessionPanel } = await import("./active-session-panel");
    let onEvent:
      | ((event: Parameters<typeof mocks.startActiveSessionStream>[3]) => void)
      | undefined;

    mocks.startActiveSessionStream.mockImplementationOnce(
      async (_sessionId, _cwd, _firstPrompt, handleEvent) => {
        onEvent = handleEvent;
        return vi.fn();
      },
    );
    mocks.stopActiveSession.mockImplementation(async () => {
      await Promise.resolve();
    });

    flushSync(() => {
      root?.render(<ActiveSessionPanel newSessionProject="/tmp/project" />);
    });

    await flushAsyncWork();

    onEvent?.({ type: "system", session_id: "session-123" });
    onEvent?.({
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Hello before failure" }],
      },
    });
    await flushAsyncWork();

    onEvent?.({ type: "error", error: "runtime exploded" } as StreamJsonEvent);
    await flushAsyncWork();

    const textarea = container?.querySelector("textarea");
    const transcript = container?.querySelector('[data-testid="session-transcript"]');
    const banner = container?.querySelector('[data-testid="session-error-banner"]');
    if (!(textarea instanceof HTMLTextAreaElement)) {
      throw new TypeError("Failed to find session textarea");
    }
    if (!(transcript instanceof HTMLElement)) {
      throw new TypeError("Failed to find session transcript");
    }
    if (!(banner instanceof HTMLElement)) {
      throw new TypeError("Failed to find session error banner");
    }

    expect(container?.textContent).toContain("runtime exploded");
    expect(transcript.textContent).toContain("Hello before failure");
    expect(transcript.textContent).not.toContain("runtime exploded");
    expect(banner.textContent).toContain("runtime exploded");
    expect(
      banner.compareDocumentPosition(transcript) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(textarea.disabled).toBe(true);
    expect(textarea.placeholder).toBe(
      "Session unavailable. Reopen or start a new session.",
    );
  });

  it("clears the runtime error banner when a new session run resets workspace state", async () => {
    const { ActiveSessionPanel } = await import("./active-session-panel");
    const firstStop = vi.fn();
    const secondStop = vi.fn();
    let firstOnEvent:
      | ((event: Parameters<typeof mocks.startActiveSessionStream>[3]) => void)
      | undefined;

    randomUuidSpy?.mockRestore();
    randomUuidSpy = vi
      .spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValueOnce("11111111-1111-1111-1111-111111111111")
      .mockReturnValueOnce("22222222-2222-2222-2222-222222222222");

    mocks.startActiveSessionStream
      .mockImplementationOnce(
        async (_sessionId, _cwd, _firstPrompt, handleEvent) => {
          firstOnEvent = handleEvent;
          return firstStop;
        },
      )
      .mockResolvedValueOnce(secondStop);
    mocks.stopActiveSession.mockImplementation(async () => {
      await Promise.resolve();
    });

    flushSync(() => {
      root?.render(<ActiveSessionPanel newSessionProject="/tmp/project-a" />);
    });

    await flushAsyncWork();

    firstOnEvent?.({ type: "system", session_id: "session-123" });
    firstOnEvent?.({ type: "error", error: "runtime exploded" } as StreamJsonEvent);
    await flushAsyncWork();

    expect(container?.querySelector('[data-testid="session-error-banner"]')?.textContent).toContain(
      "runtime exploded",
    );

    flushSync(() => {
      root?.render(<ActiveSessionPanel newSessionProject="/tmp/project-b" />);
    });

    await flushAsyncWork();

    const banner = container?.querySelector('[data-testid="session-error-banner"]');
    expect(banner).toBeNull();
    expect(container?.textContent ?? "").not.toContain("runtime exploded");
    expect(container?.querySelector('[data-testid="session-transcript"]')?.textContent ?? "").not.toContain(
      "runtime exploded",
    );
  });

  it("renders cleaner human-facing system status entries", async () => {
    const { ActiveSessionPanel } = await import("./active-session-panel");
    let onEvent:
      | ((event: Parameters<typeof mocks.startActiveSessionStream>[3]) => void)
      | undefined;

    mocks.startActiveSessionStream.mockImplementationOnce(
      async (_sessionId, _cwd, _firstPrompt, handleEvent) => {
        onEvent = handleEvent;
        return vi.fn();
      },
    );
    mocks.stopActiveSession.mockImplementation(async () => {
      await Promise.resolve();
    });

    flushSync(() => {
      root?.render(<ActiveSessionPanel newSessionProject="/tmp/project" />);
    });

    await flushAsyncWork();

    onEvent?.({
      type: "system",
      subtype: "status",
      status: "compacting",
      session_id: "session-123",
    } as StreamJsonEvent);
    await flushAsyncWork();

    expect(container?.textContent).toContain("Preparing session handoff…");
    expect(container?.textContent).not.toContain(
      "⚙️ Compacting session history",
    );
  });

  it("does not continue a stale export flow after switching sessions", async () => {
    const { ActiveSessionPanel } = await import("./active-session-panel");
    const moveToTrashDeferred = createDeferred<void>();
    let firstOnEvent:
      | ((event: Parameters<typeof mocks.startActiveSessionStream>[3]) => void)
      | undefined;

    randomUuidSpy?.mockRestore();
    randomUuidSpy = vi
      .spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValueOnce("11111111-1111-1111-1111-111111111111")
      .mockReturnValueOnce("22222222-2222-2222-2222-222222222222");

    mocks.dialogSave.mockResolvedValue("/tmp/handoff-a.md");
    mocks.moveToTrash.mockReturnValueOnce(moveToTrashDeferred.promise);
    mocks.sendSessionMessage.mockImplementation(async () => {
      await Promise.resolve();
    });
    mocks.startActiveSessionStream
      .mockImplementationOnce(
        async (_sessionId, _cwd, _firstPrompt, onEvent) => {
          firstOnEvent = onEvent;
          return vi.fn();
        },
      )
      .mockResolvedValueOnce(vi.fn());
    mocks.stopActiveSession.mockImplementation(async () => {
      await Promise.resolve();
    });

    flushSync(() => {
      root?.render(
        <ActiveSessionPanel
          session={{
            sessionId: "session-a",
            fullPath: "/tmp/session-a.jsonl",
            fileMtime: 1,
            firstPrompt: "Session A",
            messageCount: 1,
            created: "2026-03-08T00:00:00.000Z",
            modified: "2026-03-08T00:00:00.000Z",
            projectPath: "/tmp/project-a",
            isSidechain: false,
          }}
        />,
      );
    });

    await flushAsyncWork();

    const handoffButton = [
      ...(container?.querySelectorAll("button") ?? []),
    ].find((button) => button.getAttribute("title") === "More actions");
    handoffButton?.click();

    const handoffItem = [...(container?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent?.includes("Generate Handoff (.md)"),
    );
    handoffItem?.click();

    await flushUntil(() => mocks.sendSessionMessage.mock.calls.length > 0);
    expect(mocks.sendSessionMessage).toHaveBeenCalledWith(
      "session-a",
      expect.stringContaining(
        "/compact Create a complete context handoff document",
      ),
    );
    mocks.sendSessionMessage.mockClear();

    firstOnEvent?.({ type: "result" });
    await flushMicrotasks(2);

    flushSync(() => {
      root?.render(
        <ActiveSessionPanel
          session={{
            sessionId: "session-b",
            fullPath: "/tmp/session-b.jsonl",
            fileMtime: 1,
            firstPrompt: "Session B",
            messageCount: 1,
            created: "2026-03-08T00:00:00.000Z",
            modified: "2026-03-08T00:00:00.000Z",
            projectPath: "/tmp/project-b",
            isSidechain: false,
          }}
        />,
      );
    });

    await flushMicrotasks(2);

    moveToTrashDeferred.resolve();
    await flushAsyncWork();

    expect(mocks.sendSessionMessage).not.toHaveBeenCalled();
  });

  it("does not start a stale stream after getSessionCwd resolves for a replaced session", async () => {
    const { ActiveSessionPanel } = await import("./active-session-panel");
    const firstCwdDeferred = createDeferred<string | null>();

    mocks.startActiveSessionStream.mockResolvedValue(vi.fn());
    mocks.stopActiveSession.mockImplementation(async () => {
      await Promise.resolve();
    });

    const { getSessionCwd } = await import("../lib/tauri");
    vi.mocked(getSessionCwd)
      .mockReturnValueOnce(firstCwdDeferred.promise)
      .mockResolvedValueOnce("/tmp/project-b");

    flushSync(() => {
      root?.render(
        <ActiveSessionPanel
          session={{
            sessionId: "session-a",
            fullPath: "/tmp/session-a.jsonl",
            fileMtime: 1,
            firstPrompt: "Session A",
            messageCount: 1,
            created: "2026-03-08T00:00:00.000Z",
            modified: "2026-03-08T00:00:00.000Z",
            projectPath: "/tmp/project-a",
            isSidechain: false,
          }}
        />,
      );
    });

    await flushMicrotasks(2);

    flushSync(() => {
      root?.render(
        <ActiveSessionPanel
          session={{
            sessionId: "session-b",
            fullPath: "/tmp/session-b.jsonl",
            fileMtime: 1,
            firstPrompt: "Session B",
            messageCount: 1,
            created: "2026-03-08T00:00:00.000Z",
            modified: "2026-03-08T00:00:00.000Z",
            projectPath: "/tmp/project-b",
            isSidechain: false,
          }}
        />,
      );
    });

    await flushUntil(
      () => mocks.startActiveSessionStream.mock.calls.length === 1,
    );
    expect(mocks.startActiveSessionStream).toHaveBeenCalledTimes(1);
    expect(mocks.startActiveSessionStream).toHaveBeenCalledWith(
      "session-b",
      "/tmp/project-b",
      undefined,
      expect.any(Function),
      expect.any(Function),
      "session-b",
      undefined,
    );

    firstCwdDeferred.resolve("/tmp/project-a");
    await flushAsyncWork();

    expect(mocks.startActiveSessionStream).toHaveBeenCalledTimes(1);
  });

  it("does not send compact to a replacement session when the handoff dialog resolves late", async () => {
    const { ActiveSessionPanel } = await import("./active-session-panel");
    const dialogDeferred = createDeferred<string | null>();

    mocks.dialogSave.mockReturnValueOnce(dialogDeferred.promise);
    mocks.startActiveSessionStream.mockResolvedValue(vi.fn());
    mocks.stopActiveSession.mockImplementation(async () => {
      await Promise.resolve();
    });
    mocks.sendSessionMessage.mockImplementation(async () => {
      await Promise.resolve();
    });

    flushSync(() => {
      root?.render(
        <ActiveSessionPanel
          session={{
            sessionId: "session-a",
            fullPath: "/tmp/session-a.jsonl",
            fileMtime: 1,
            firstPrompt: "Session A",
            messageCount: 1,
            created: "2026-03-08T00:00:00.000Z",
            modified: "2026-03-08T00:00:00.000Z",
            projectPath: "/tmp/project-a",
            isSidechain: false,
          }}
        />,
      );
    });

    await flushAsyncWork();

    const handoffButton = [
      ...(container?.querySelectorAll("button") ?? []),
    ].find((button) => button.getAttribute("title") === "More actions");
    handoffButton?.click();

    const handoffItem = [...(container?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent?.includes("Generate Handoff (.md)"),
    );
    handoffItem?.click();

    await flushMicrotasks(2);

    flushSync(() => {
      root?.render(
        <ActiveSessionPanel
          session={{
            sessionId: "session-b",
            fullPath: "/tmp/session-b.jsonl",
            fileMtime: 1,
            firstPrompt: "Session B",
            messageCount: 1,
            created: "2026-03-08T00:00:00.000Z",
            modified: "2026-03-08T00:00:00.000Z",
            projectPath: "/tmp/project-b",
            isSidechain: false,
          }}
        />,
      );
    });

    await flushAsyncWork();

    dialogDeferred.resolve("/tmp/handoff-a.md");
    await flushAsyncWork();

    expect(mocks.sendSessionMessage).not.toHaveBeenCalledWith(
      "session-b",
      expect.stringContaining(
        "/compact Create a complete context handoff document",
      ),
    );
  });

  it("does not show stale copy success after switching sessions", async () => {
    const { ActiveSessionPanel } = await import("./active-session-panel");
    const { getSessionCwd } = await import("../lib/tauri");
    const exportDeferred = createDeferred<string>();

    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockImplementation(async () => {
          await Promise.resolve();
        }),
      },
    });

    vi.mocked(getSessionCwd)
      .mockResolvedValueOnce("/tmp/project-a")
      .mockResolvedValueOnce("/tmp/project-b");
    mocks.exportSession.mockReturnValueOnce(exportDeferred.promise);
    mocks.startActiveSessionStream.mockResolvedValue(vi.fn());
    mocks.stopActiveSession.mockImplementation(async () => {
      await Promise.resolve();
    });

    flushSync(() => {
      root?.render(
        <ActiveSessionPanel
          session={{
            sessionId: "session-a",
            fullPath: "/tmp/session-a.jsonl",
            fileMtime: 1,
            firstPrompt: "Session A",
            messageCount: 1,
            created: "2026-03-08T00:00:00.000Z",
            modified: "2026-03-08T00:00:00.000Z",
            projectPath: "/tmp/project-a",
            isSidechain: false,
          }}
        />,
      );
    });

    await flushAsyncWork();

    const copyButton = [...(container?.querySelectorAll("button") ?? [])].find(
      (button) => button.getAttribute("title") === "Copy to clipboard",
    );
    copyButton?.click();

    await flushMicrotasks(2);

    flushSync(() => {
      root?.render(
        <ActiveSessionPanel
          session={{
            sessionId: "session-b",
            fullPath: "/tmp/session-b.jsonl",
            fileMtime: 1,
            firstPrompt: "Session B",
            messageCount: 1,
            created: "2026-03-08T00:00:00.000Z",
            modified: "2026-03-08T00:00:00.000Z",
            projectPath: "/tmp/project-b",
            isSidechain: false,
          }}
        />,
      );
    });

    await flushAsyncWork();

    exportDeferred.resolve("session-a export");
    await flushAsyncWork();

    expect(mocks.addToast).not.toHaveBeenCalledWith(
      "Session copied to clipboard",
      "success",
    );
  });

  it("removes the optimistic user message when sendSessionMessage fails", async () => {
    const { ActiveSessionPanel } = await import("./active-session-panel");

    mocks.startActiveSessionStream.mockResolvedValue(vi.fn());
    mocks.stopActiveSession.mockImplementation(async () => {
      await Promise.resolve();
    });
    mocks.sendSessionMessage.mockRejectedValueOnce(new Error("socket closed"));

    flushSync(() => {
      root?.render(<ActiveSessionPanel newSessionProject="/tmp/project" />);
    });

    await flushAsyncWork();

    const textarea = container?.querySelector("textarea");

    if (!(textarea instanceof HTMLTextAreaElement)) {
      throw new TypeError("Failed to find session input controls");
    }

    const setTextareaValue = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;

    if (!setTextareaValue) {
      throw new TypeError("Failed to access textarea value setter");
    }

    flushSync(() => {
      setTextareaValue.call(textarea, "Hello Claude");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });

    textarea.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
      }),
    );
    await flushAsyncWork();

    expect(mocks.sendSessionMessage).toHaveBeenCalledWith(
      "00000000-0000-0000-0000-000000000000",
      "Hello Claude",
    );
    expect(container?.textContent).not.toContain("Hello Claude");
    expect(mocks.addToast).toHaveBeenCalledWith(
      "studio request failed",
      "error",
    );
  });

  it("does not export a stale handoff path after switching sessions", async () => {
    const { ActiveSessionPanel } = await import("./active-session-panel");
    const { getSessionCwd } = await import("../lib/tauri");
    let firstOnEvent:
      | ((event: Parameters<typeof mocks.startActiveSessionStream>[3]) => void)
      | undefined;
    let secondOnEvent:
      | ((event: Parameters<typeof mocks.startActiveSessionStream>[3]) => void)
      | undefined;

    vi.mocked(getSessionCwd)
      .mockResolvedValueOnce("/tmp/project-a")
      .mockResolvedValueOnce("/tmp/project-b");
    mocks.dialogSave.mockResolvedValue("/tmp/handoff-a.md");
    mocks.moveToTrash.mockImplementation(async () => {
      await Promise.resolve();
    });
    mocks.sendSessionMessage.mockImplementation(async () => {
      await Promise.resolve();
    });
    mocks.startActiveSessionStream
      .mockImplementationOnce(
        async (_sessionId, _cwd, _firstPrompt, onEvent) => {
          firstOnEvent = onEvent;
          return vi.fn();
        },
      )
      .mockImplementationOnce(
        async (_sessionId, _cwd, _firstPrompt, onEvent) => {
          secondOnEvent = onEvent;
          return vi.fn();
        },
      );
    mocks.stopActiveSession.mockImplementation(async () => {
      await Promise.resolve();
    });

    flushSync(() => {
      root?.render(
        <ActiveSessionPanel
          session={{
            sessionId: "session-a",
            fullPath: "/tmp/session-a.jsonl",
            fileMtime: 1,
            firstPrompt: "Session A",
            messageCount: 1,
            created: "2026-03-08T00:00:00.000Z",
            modified: "2026-03-08T00:00:00.000Z",
            projectPath: "/tmp/project-a",
            isSidechain: false,
          }}
        />,
      );
    });

    await flushAsyncWork();

    const handoffButton = [
      ...(container?.querySelectorAll("button") ?? []),
    ].find((button) => button.getAttribute("title") === "More actions");
    handoffButton?.click();

    const handoffItem = [...(container?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent?.includes("Generate Handoff (.md)"),
    );
    handoffItem?.click();

    await flushUntil(() => mocks.sendSessionMessage.mock.calls.length > 0);
    expect(mocks.sendSessionMessage).toHaveBeenCalledWith(
      "session-a",
      expect.stringContaining(
        "/compact Create a complete context handoff document",
      ),
    );
    mocks.sendSessionMessage.mockClear();

    flushSync(() => {
      root?.render(
        <ActiveSessionPanel
          session={{
            sessionId: "session-b",
            fullPath: "/tmp/session-b.jsonl",
            fileMtime: 1,
            firstPrompt: "Session B",
            messageCount: 1,
            created: "2026-03-08T00:00:00.000Z",
            modified: "2026-03-08T00:00:00.000Z",
            projectPath: "/tmp/project-b",
            isSidechain: false,
          }}
        />,
      );
    });

    await flushAsyncWork();

    secondOnEvent?.({ type: "result" });
    await flushAsyncWork();

    expect(mocks.moveToTrash).not.toHaveBeenCalled();
    expect(mocks.sendSessionMessage).not.toHaveBeenCalled();
    expect(firstOnEvent).toBeDefined();
  });

  it("does not show stale handoff failure or clear the replacement session state", async () => {
    const { ActiveSessionPanel } = await import("./active-session-panel");
    const { getSessionCwd } = await import("../lib/tauri");
    const sendDeferred = createDeferred<void>();
    const secondDialogDeferred = createDeferred<string | null>();

    vi.mocked(getSessionCwd)
      .mockResolvedValueOnce("/tmp/project-a")
      .mockResolvedValueOnce("/tmp/project-b");
    mocks.dialogSave
      .mockResolvedValueOnce("/tmp/handoff-a.md")
      .mockReturnValueOnce(secondDialogDeferred.promise);
    mocks.startActiveSessionStream.mockResolvedValue(vi.fn());
    mocks.stopActiveSession.mockImplementation(async () => {
      await Promise.resolve();
    });
    mocks.sendSessionMessage.mockReturnValueOnce(sendDeferred.promise);

    flushSync(() => {
      root?.render(
        <ActiveSessionPanel
          session={{
            sessionId: "session-a",
            fullPath: "/tmp/session-a.jsonl",
            fileMtime: 1,
            firstPrompt: "Session A",
            messageCount: 1,
            created: "2026-03-08T00:00:00.000Z",
            modified: "2026-03-08T00:00:00.000Z",
            projectPath: "/tmp/project-a",
            isSidechain: false,
          }}
        />,
      );
    });

    await flushAsyncWork();

    let handoffButton = [...(container?.querySelectorAll("button") ?? [])].find(
      (button) => button.getAttribute("title") === "More actions",
    );
    handoffButton?.click();

    let handoffItem = [...(container?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent?.includes("Generate Handoff (.md)"),
    );
    handoffItem?.click();

    await flushUntil(() => mocks.sendSessionMessage.mock.calls.length > 0);

    flushSync(() => {
      root?.render(
        <ActiveSessionPanel
          session={{
            sessionId: "session-b",
            fullPath: "/tmp/session-b.jsonl",
            fileMtime: 1,
            firstPrompt: "Session B",
            messageCount: 1,
            created: "2026-03-08T00:00:00.000Z",
            modified: "2026-03-08T00:00:00.000Z",
            projectPath: "/tmp/project-b",
            isSidechain: false,
          }}
        />,
      );
    });

    await flushAsyncWork();

    handoffButton = [...(container?.querySelectorAll("button") ?? [])].find(
      (button) => button.getAttribute("title") === "More actions",
    );
    handoffButton?.click();

    handoffItem = [...(container?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent?.includes("Generate Handoff (.md)"),
    );
    handoffItem?.click();

    await flushMicrotasks(2);

    expect(handoffButton?.hasAttribute("disabled")).toBe(true);

    sendDeferred.reject(new Error("handoff failed"));
    await flushAsyncWork();

    expect(mocks.addToast).not.toHaveBeenCalledWith(
      "studio request failed",
      "error",
    );
    expect(handoffButton?.hasAttribute("disabled")).toBe(true);

    secondDialogDeferred.resolve(null);
    await flushAsyncWork();
  });

  it("does not resume an existing session when getSessionCwd resolves null", async () => {
    const { ActiveSessionPanel } = await import("./active-session-panel");
    const { getSessionCwd } = await import("../lib/tauri");

    vi.mocked(getSessionCwd).mockResolvedValueOnce(null);
    mocks.startActiveSessionStream.mockResolvedValue(vi.fn());
    mocks.stopActiveSession.mockImplementation(async () => {
      await Promise.resolve();
    });

    flushSync(() => {
      root?.render(
        <ActiveSessionPanel
          session={{
            sessionId: "session-a",
            fullPath: "/tmp/session-a.jsonl",
            fileMtime: 1,
            firstPrompt: "Session A",
            messageCount: 1,
            created: "2026-03-08T00:00:00.000Z",
            modified: "2026-03-08T00:00:00.000Z",
            projectPath: "/tmp/project-a",
            isSidechain: false,
          }}
        />,
      );
    });

    await flushAsyncWork();

    expect(mocks.startActiveSessionStream).not.toHaveBeenCalled();
    expect(container?.textContent).toContain(
      "Failed to determine the session directory.",
    );
  });

  it("does not resume an existing session when getSessionCwd rejects", async () => {
    const { ActiveSessionPanel } = await import("./active-session-panel");
    const { getSessionCwd } = await import("../lib/tauri");

    vi.mocked(getSessionCwd).mockRejectedValueOnce(
      new Error("missing cwd metadata"),
    );
    mocks.startActiveSessionStream.mockResolvedValue(vi.fn());
    mocks.stopActiveSession.mockImplementation(async () => {
      await Promise.resolve();
    });

    flushSync(() => {
      root?.render(
        <ActiveSessionPanel
          session={{
            sessionId: "session-a",
            fullPath: "/tmp/session-a.jsonl",
            fileMtime: 1,
            firstPrompt: "Session A",
            messageCount: 1,
            created: "2026-03-08T00:00:00.000Z",
            modified: "2026-03-08T00:00:00.000Z",
            projectPath: "/tmp/project-a",
            isSidechain: false,
          }}
        />,
      );
    });

    await flushAsyncWork();

    expect(mocks.startActiveSessionStream).not.toHaveBeenCalled();
    expect(container?.textContent).toContain(
      "Failed to load session directory metadata: missing cwd metadata",
    );
    expect(container?.textContent).toContain(
      "Failed to determine the session directory.",
    );
  });

  it("preserves the pending new-session prompt across StrictMode remounts", async () => {
    const { ActiveSessionPanel } = await import("./active-session-panel");
    const optimizeRulesPrompt =
      "Please review my ~/.claude/settings.json 'allow' and 'deny' lists and group similar commands together using wildcards.";

    useSessionStore.setState({ newSessionPrompt: optimizeRulesPrompt });
    mocks.startActiveSessionStream.mockResolvedValue(vi.fn());
    mocks.stopActiveSession.mockImplementation(async () => {
      await Promise.resolve();
    });

    flushSync(() => {
      root?.render(
        <StrictMode>
          <ActiveSessionPanel newSessionProject="/tmp/project" />
        </StrictMode>,
      );
    });

    await flushAsyncWork();

    expect(
      mocks.startActiveSessionStream.mock.calls.map((call) => call[2]),
    ).toEqual([optimizeRulesPrompt, optimizeRulesPrompt]);
  });

  it("renders a normalized status update only once", async () => {
    const { ActiveSessionPanel } = await import("./active-session-panel");
    let onEvent:
      | ((event: Parameters<typeof mocks.startActiveSessionStream>[3]) => void)
      | undefined;

    mocks.startActiveSessionStream.mockImplementationOnce(
      async (_sessionId, _cwd, _firstPrompt, handleEvent) => {
        onEvent = handleEvent;
        return vi.fn();
      },
    );
    mocks.stopActiveSession.mockImplementation(async () => {
      await Promise.resolve();
    });

    flushSync(() => {
      root?.render(<ActiveSessionPanel newSessionProject="/tmp/project" />);
    });

    await flushAsyncWork();

    onEvent?.({
      type: "system",
      subtype: "status",
      status: "compacting",
    });
    await flushAsyncWork();

    const matches =
      container?.textContent?.match(/Preparing session handoff…/g) ?? [];
    expect(matches).toHaveLength(1);
  });

  it("renders runtime cost metadata after an operation completes", async () => {
    const { ActiveSessionPanel } = await import("./active-session-panel");
    let onEvent:
      | ((event: Parameters<typeof mocks.startActiveSessionStream>[3]) => void)
      | undefined;

    mocks.startActiveSessionStream.mockImplementationOnce(
      async (_sessionId, _cwd, _firstPrompt, handleEvent) => {
        onEvent = handleEvent;
        return vi.fn();
      },
    );
    mocks.stopActiveSession.mockImplementation(async () => {
      await Promise.resolve();
    });

    flushSync(() => {
      root?.render(<ActiveSessionPanel newSessionProject="/tmp/project" />);
    });

    await flushAsyncWork();

    onEvent?.({
      type: "result",
      subtype: "handoff",
      status: "completed",
      cost_usd: 1.25,
      result: { path: "/tmp/handoff.md" },
    });
    await flushAsyncWork();

    expect(container?.textContent).toContain("$1.25");
  });

  it("shows a stop action when the session is active", async () => {
    const { ActiveSessionPanel } = await import("./active-session-panel");
    let onEvent:
      | ((event: Parameters<typeof mocks.startActiveSessionStream>[3]) => void)
      | undefined;

    mocks.startActiveSessionStream.mockImplementationOnce(
      async (_sessionId, _cwd, _firstPrompt, handleEvent) => {
        onEvent = handleEvent;
        return vi.fn();
      },
    );
    mocks.stopActiveSession.mockImplementation(async () => {
      await Promise.resolve();
    });

    flushSync(() => {
      root?.render(<ActiveSessionPanel newSessionProject="/tmp/project" />);
    });

    await flushAsyncWork();

    onEvent?.({ type: "system", session_id: "session-123" });
    await flushAsyncWork();

    const stopButton = [...(container?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent?.includes("Stop"),
    );
    expect(stopButton).toBeDefined();
  });
});
