// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { Root } from "react-dom/client";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SyncProfile, SyncStatusResult } from "../lib/types";
import {
  getAiSyncModalDescription,
  getAiSyncStepLabels,
} from "./acme-sync-ai-sync-state.ts";

type MockCodeBlockCall = {
  language?: string;
  children?: React.ReactNode;
  wrap?: boolean;
};

const mocks = vi.hoisted(() => ({
  addToast: vi.fn(),
  executeSyncAction: vi.fn(),
  getRepoMetadata: vi.fn(),
  invoke: vi.fn(),
  onFocusChanged: vi.fn(),
  previewSubtreeSync: vi.fn(),
  previewSyncChanges: vi.fn(),
}));

const recordedCodeBlockProps = vi.hoisted(() => [] as MockCodeBlockCall[]);

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onFocusChanged: mocks.onFocusChanged,
  }),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-shell", () => ({
  Command: {
    create: vi.fn(() => ({ execute: vi.fn() })),
  },
}));

vi.mock("lucide-react", () => ({
  FolderPlus: ({ className }: { className?: string }) => (
    <span data-icon="folder-plus" className={className} />
  ),
  RefreshCw: ({ className }: { className?: string }) => (
    <span data-icon="refresh" className={className} />
  ),
  Settings: ({ className }: { className?: string }) => (
    <span data-icon="settings" className={className} />
  ),
  Trash2: ({ className }: { className?: string }) => (
    <span data-icon="trash" className={className} />
  ),
  Upload: ({ className }: { className?: string }) => (
    <span data-icon="upload" className={className} />
  ),
}));

vi.mock("@acme/ui/components/code-block", () => ({
  CodeBlock: ({
    children,
    language,
    wrap,
  }: {
    children?: React.ReactNode;
    language?: string;
    wrap?: boolean;
  }) => {
    recordedCodeBlockProps.push({ children, language, wrap });
    return <pre>{children}</pre>;
  },
}));

vi.mock("@acme/ui/components/modal", () => ({
  Modal: ({
    children,
    footer,
    open,
    title,
    description,
  }: {
    children?: React.ReactNode;
    footer?: React.ReactNode;
    open?: boolean;
    title?: string;
    description?: string;
  }) =>
    open ? (
      <div role="dialog" aria-label={title}>
        {title ? <h2>{title}</h2> : null}
        {description ? <p>{description}</p> : null}
        <div>{children}</div>
        <div>{footer}</div>
      </div>
    ) : null,
}));

vi.mock("../lib/tauri", () => ({
  deleteSyncFile: vi.fn(),
  executeSyncAction: mocks.executeSyncAction,
  getRepoMetadata: mocks.getRepoMetadata,
  previewSubtreeSync: mocks.previewSubtreeSync,
  previewSyncChanges: mocks.previewSyncChanges,
  previewSyncFileDiff: vi.fn(),
}));

const storeState = {
  primaryPath: "/repo/main",
  profiles: [] as SyncProfile[],
  setPrimaryPath: vi.fn(),
  addProjectProfile: vi.fn(),
  removeProjectProfile: vi.fn(),
  updateProfileMode: vi.fn(),
  updateRsyncSettings: vi.fn(),
  updateSubtreeSettings: vi.fn(),
};

vi.mock("../store/acme-store", () => ({
  useAcmeStore: () => storeState,
}));

vi.mock("../store/toast-store", () => ({
  useToastStore: (
    selector: (state: { addToast: typeof mocks.addToast }) => unknown,
  ) => selector({ addToast: mocks.addToast }),
}));

vi.mock("./sync-diff-viewer", () => ({
  SyncDiffViewer: () => null,
}));

vi.mock("./acme-sync-profile-modal", () => ({
  AcmeSyncProfileModal: () => null,
}));

function getSubtreeSyncStatus(
  overrides: Partial<Extract<SyncStatusResult, { mode: "subtree" }>> = {},
): Extract<SyncStatusResult, { mode: "subtree" }> {
  return {
    mode: "subtree",
    state: "clean",
    aheadCount: 0,
    behindCount: 0,
    dirty: false,
    message: "Already in sync.",
    ...overrides,
  };
}

describe("AI Sync modal wording", () => {
  it("keeps the expected rsync description copy", () => {
    assert.equal(
      getAiSyncModalDescription("rsync"),
      "Copy the command + prompt below, then paste them into Claude Code / Codex to review both push and pull previews.",
    );
  });

  it("keeps the expected subtree description copy", () => {
    assert.equal(
      getAiSyncModalDescription("subtree"),
      "Copy the command + prompt below, then paste them into Claude Code / Codex to review the subtree history preview.",
    );
  });

  it("keeps the expected rsync step labels", () => {
    assert.deepEqual(getAiSyncStepLabels("rsync"), {
      command: "1) CD command",
      prompt: "2) Prompt for AI review of push + pull previews",
    });
  });

  it("keeps the expected subtree step labels", () => {
    assert.deepEqual(getAiSyncStepLabels("subtree"), {
      command: "1) CD command",
      prompt: "2) Prompt for AI review of subtree history",
    });
  });
});

describe("AI Sync modal CodeBlock usage", () => {
  let container: HTMLDivElement | null;
  let root: Root | null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    recordedCodeBlockProps.length = 0;
    storeState.primaryPath = "/repo/main";
    storeState.profiles = [
      {
        id: "rsync-1",
        projectPath: "/repo/project-a",
        primaryPath: "/repo/main",
        mode: "rsync",
      },
    ];

    mocks.addToast.mockReset();
    mocks.executeSyncAction.mockReset();
    mocks.getRepoMetadata.mockReset();
    mocks.invoke.mockReset();
    mocks.onFocusChanged.mockReset();
    mocks.previewSubtreeSync.mockReset();
    mocks.previewSyncChanges.mockReset();

    mocks.getRepoMetadata.mockResolvedValue({
      branch: "main",
      lastCommitMessage: "chore: refresh acme sync fixtures",
      lastUpdated: "2026-03-10 12:00:00",
    });
    mocks.invoke.mockResolvedValue("2026-03-10 12:00:00");
    mocks.onFocusChanged.mockImplementation(async () => vi.fn());
    mocks.previewSubtreeSync.mockResolvedValue(getSubtreeSyncStatus());
    mocks.previewSyncChanges
      .mockResolvedValueOnce({
        files: [
          {
            path: "@acme/ui/src/components/code-block/code-block.tsx",
            changeType: "modified",
          },
        ],
        summary: { added: 0, modified: 1, deleted: 0 },
      })
      .mockResolvedValueOnce({
        files: [
          {
            path: "apps/atelier-desktop/src/components/acme-sync.tsx",
            changeType: "modified",
          },
        ],
        summary: { added: 0, modified: 1, deleted: 0 },
      });
  });

  afterEach(() => {
    if (root) {
      flushSync(() => {
        root?.unmount();
      });
      root = null;
    }

    container?.remove();
    container = null;
  });

  it("keeps the command block non-wrapping and expects prompt wrapping for AI review text", async () => {
    const { AcmeSync } = await import("./acme-sync");

    flushSync(() => {
      root?.render(<AcmeSync />);
    });

    const aiSyncButton = await screen.findByRole("button", { name: "AI Sync" });
    fireEvent.click(aiSyncButton);

    await waitFor(() => {
      expect(mocks.previewSyncChanges).toHaveBeenCalledTimes(2);
    });

    await screen.findByRole("dialog", { name: "AI Sync" });

    const commandBlock = recordedCodeBlockProps.find(
      (entry) => entry.language === "bash",
    );
    const promptBlock = recordedCodeBlockProps.find(
      (entry) => entry.language === "markdown",
    );

    expect(commandBlock).toBeTruthy();
    expect(promptBlock).toBeTruthy();
    expect(commandBlock?.wrap).not.toBe(true);
    expect(promptBlock?.wrap).toBe(true);
  });
});

console.log("ai sync modal wording checks passed");
