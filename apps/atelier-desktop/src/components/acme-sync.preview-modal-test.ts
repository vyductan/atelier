// @vitest-environment jsdom

import type { Root } from "react-dom/client";
import React from "react";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SyncProfile } from "../lib/types";

const noop = () => {
  return null;
};

const mocks = vi.hoisted(() => ({
  addToast: vi.fn(),
  commandExecute: vi.fn(),
  executeSyncAction: vi.fn(),
  getRepoMetadata: vi.fn(),
  getSyncConflictDetail: vi.fn(),
  invoke: vi.fn(),
  onFocusChanged: vi.fn(),
  previewSubtreeSync: vi.fn(),
  previewSyncChanges: vi.fn(),
  previewSyncFileDiff: vi.fn(),
}));

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
    create: vi.fn(() => ({ execute: mocks.commandExecute })),
  },
}));

vi.mock("lucide-react", () => ({
  FolderPlus: ({ className }: { className?: string }) =>
    React.createElement("span", { "data-icon": "folder-plus", className }),
  RefreshCw: ({ className }: { className?: string }) =>
    React.createElement("span", { "data-icon": "refresh", className }),
  Settings: ({ className }: { className?: string }) =>
    React.createElement("span", { "data-icon": "settings", className }),
  Trash2: ({ className }: { className?: string }) =>
    React.createElement("span", { "data-icon": "trash", className }),
  Upload: ({ className }: { className?: string }) =>
    React.createElement("span", { "data-icon": "upload", className }),
}));

vi.mock("@acme/ui/components/code-block", () => ({
  CodeBlock: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("pre", null, children ?? null),
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
    open
      ? React.createElement(
          "div",
          { role: "dialog", "aria-label": title },
          title ? React.createElement("h2", null, title) : null,
          description ? React.createElement("p", null, description) : null,
          React.createElement("div", null, children),
          React.createElement("div", null, footer),
        )
      : null,
}));

vi.mock("../lib/tauri", () => ({
  deleteSyncFile: vi.fn(),
  executeSyncAction: mocks.executeSyncAction,
  getRepoMetadata: mocks.getRepoMetadata,
  getSyncConflictDetail: mocks.getSyncConflictDetail,
  previewSubtreeSync: mocks.previewSubtreeSync,
  previewSyncChanges: mocks.previewSyncChanges,
  previewSyncFileDiff: mocks.previewSyncFileDiff,
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
  SyncDiffViewer: ({ diffText }: { diffText?: string }) =>
    React.createElement("div", null, diffText ?? null),
}));

vi.mock("./acme-sync-profile-modal", () => ({
  AcmeSyncProfileModal: () => null,
}));

async function flushAsyncWork() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("AcmeSync preview modal conflict controls", () => {
  let container: HTMLDivElement | null;
  let root: Root | null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

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
    mocks.commandExecute.mockReset();
    mocks.executeSyncAction.mockReset();
    mocks.getRepoMetadata.mockReset();
    mocks.invoke.mockReset();
    mocks.getSyncConflictDetail.mockReset();
    mocks.onFocusChanged.mockReset();
    mocks.previewSubtreeSync.mockReset();
    mocks.previewSyncChanges.mockReset();
    mocks.previewSyncFileDiff.mockReset();

    mocks.getRepoMetadata.mockResolvedValue({
      branch: "main",
      lastCommitMessage: "chore: refresh fixtures",
      lastUpdated: "2026-03-10 12:00:00",
    });
    mocks.invoke.mockResolvedValue("2026-03-10 12:00:00");
    mocks.onFocusChanged.mockResolvedValue(noop);
    mocks.commandExecute.mockResolvedValue({ code: 0, stderr: "", stdout: "" });
    mocks.getSyncConflictDetail.mockImplementation(
      async (_src: string, _dest: string, relativePath: string) => {
        if (relativePath === "components/button.tsx") {
          return {
            path: relativePath,
            kind: "text",
            current: {
              label: "Ours (Project)",
              content: "export const button = 'current';",
            },
            incoming: {
              label: "Theirs (Primary)",
              content: "export const button = 'incoming';",
            },
            bothPreview:
              "<<<<<<< OURS\nexport const button = 'current';\n=======\nexport const button = 'incoming';\n>>>>>>> THEIRS\n",
          };
        }

        return {
          path: relativePath,
          kind: "binary",
          message: "Binary conflict. Choose Ours or Theirs.",
          current: null,
          incoming: null,
          bothPreview: null,
        };
      },
    );
    mocks.previewSyncFileDiff.mockResolvedValue("diff --git a/file b/file");
    mocks.previewSubtreeSync.mockResolvedValue({
      mode: "subtree",
      state: "clean",
      aheadCount: 0,
      behindCount: 0,
      dirty: false,
      message: "Already in sync.",
    });
    mocks.previewSyncChanges.mockResolvedValue({
      files: [
        { path: "components/button.tsx", changeType: "modified" },
        { path: "assets/logo.png", changeType: "modified" },
      ],
      summary: { added: 0, modified: 2, deleted: 0 },
      conflicts: [
        {
          path: "components/button.tsx",
          kind: "text",
          allowedResolutions: ["current", "incoming", "both"],
        },
        {
          path: "assets/logo.png",
          kind: "binary",
          allowedResolutions: ["current", "incoming"],
        },
      ],
      fingerprint: "preview-123",
    });
    mocks.executeSyncAction.mockImplementation(async () => {
      return;
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

  it("renders subtree preview content through AcmeSync", async () => {
    storeState.profiles = [
      {
        id: "subtree-1",
        projectPath: "/repo/project-a",
        primaryPath: "/repo/main",
        mode: "subtree",
        subtree: {
          repoRoot: "/repo/project-a",
          remote: "origin",
          branch: "main",
          prefix: "@acme",
          squash: false,
        },
      },
    ];

    const { AcmeSync } = await import("./acme-sync");

    flushSync(() => {
      root?.render(React.createElement(AcmeSync));
    });

    await flushAsyncWork();

    fireEvent.click(
      screen.getAllByRole("button", {
        name: "Preview History",
      })[0] as HTMLButtonElement,
    );

    await waitFor(() => {
      expect(mocks.previewSubtreeSync).toHaveBeenCalled();
    });

    const dialog = await screen.findByRole("dialog", {
      name: "Preview History",
    });
    const dialogQueries = within(dialog);

    expect(dialogQueries.getByText("Already in sync.")).toBeTruthy();
    expect(dialogQueries.getByText(/Behind:/i)).toBeTruthy();
    expect(dialogQueries.getByText(/Ahead:/i)).toBeTruthy();
    expect(dialogQueries.getByText(/Working tree:/i)).toBeTruthy();
  });

  it("renders rsync preview modal shell through AcmeSync", async () => {
    mocks.previewSyncChanges.mockResolvedValueOnce({
      files: [{ path: "tokens/new.ts", changeType: "added" }],
      summary: { added: 1, modified: 0, deleted: 0 },
      decisions: [
        {
          path: "tokens/new.ts",
          kind: "added",
          allowedActions: ["keep", "delete"],
        },
      ],
      fingerprint: "preview-shell-123",
    });

    const { AcmeSync } = await import("./acme-sync");

    flushSync(() => {
      root?.render(React.createElement(AcmeSync));
    });

    await flushAsyncWork();

    fireEvent.click(screen.getByRole("button", { name: "Push to Primary" }));

    await waitFor(() => {
      expect(mocks.previewSyncChanges).toHaveBeenCalled();
    });

    const dialog = await screen.findByRole("dialog", { name: "Preview Push" });
    const dialogQueries = within(dialog);

    expect(dialogQueries.getByRole("button", { name: "Close" })).toBeTruthy();
    expect(
      dialogQueries.getByRole("button", { name: "Continue to Confirm" }),
    ).toBeTruthy();
    expect(dialogQueries.getByText("File Actions")).toBeTruthy();
  });

  it("does not render the conflicts section in preview modal", async () => {
    const { AcmeSync } = await import("./acme-sync");

    flushSync(() => {
      root?.render(React.createElement(AcmeSync));
    });

    await flushAsyncWork();

    fireEvent.click(screen.getByRole("button", { name: "Pull from Primary" }));

    await waitFor(() => {
      expect(mocks.previewSyncChanges).toHaveBeenCalled();
    });

    const dialog = await screen.findByRole("dialog", { name: "Preview Pull" });
    const dialogQueries = within(dialog);

    expect(dialogQueries.queryByText("Conflicts")).toBeNull();
  });

  it("shows contextual ours/theirs mapping for push previews", async () => {
    mocks.getSyncConflictDetail.mockImplementationOnce(
      async (_src: string, _dest: string, relativePath: string) => ({
        path: relativePath,
        kind: "text",
        current: {
          label: "Ours (Primary)",
          content: "export const button = 'current';",
        },
        incoming: {
          label: "Theirs (Project)",
          content: "export const button = 'incoming';",
        },
        bothPreview:
          "<<<<<<< OURS\nexport const button = 'current';\n=======\nexport const button = 'incoming';\n>>>>>>> THEIRS\n",
      }),
    );

    const { AcmeSync } = await import("./acme-sync");

    flushSync(() => {
      root?.render(React.createElement(AcmeSync));
    });

    await flushAsyncWork();

    fireEvent.click(screen.getByRole("button", { name: "Push to Primary" }));

    await waitFor(() => {
      expect(mocks.previewSyncChanges).toHaveBeenCalled();
    });

    const dialog = await screen.findByRole("dialog", { name: "Preview Push" });
    const dialogQueries = within(dialog);

    fireEvent.click(
      dialogQueries.getByRole("button", { name: /components\/button\.tsx/i }),
    );

    await waitFor(() => {
      expect(mocks.getSyncConflictDetail).toHaveBeenCalledWith(
        "/repo/project-a",
        "/repo/main",
        "components/button.tsx",
        "to-primary",
      );
    });

    expect(
      dialogQueries.getByText("Ours = Primary • Theirs = Project"),
    ).toBeTruthy();
  });

  it("shows file action controls when selecting a decision file after viewing another file", async () => {
    mocks.previewSyncChanges.mockResolvedValueOnce({
      files: [
        { path: "components/button.tsx", changeType: "modified" },
        { path: "tokens/new.ts", changeType: "added" },
      ],
      summary: { added: 1, modified: 1, deleted: 0 },
      conflicts: [
        {
          path: "components/button.tsx",
          kind: "text",
          allowedResolutions: ["current", "incoming", "both"],
        },
      ],
      decisions: [
        {
          path: "tokens/new.ts",
          kind: "added",
          allowedActions: ["keep", "delete"],
        },
      ],
      fingerprint: "preview-decision-123",
    });

    const { AcmeSync } = await import("./acme-sync");

    flushSync(() => {
      root?.render(React.createElement(AcmeSync));
    });

    await flushAsyncWork();

    fireEvent.click(screen.getByRole("button", { name: "Push to Primary" }));

    await waitFor(() => {
      expect(mocks.previewSyncChanges).toHaveBeenCalled();
    });

    const dialog = await screen.findByRole("dialog", { name: "Preview Push" });
    const dialogQueries = within(dialog);

    expect(
      dialogQueries.getByText(
        "1 unresolved file decision(s). Choose an action for each file before continuing.",
      ),
    ).toBeTruthy();
    expect(dialogQueries.queryByText("Conflicts")).toBeNull();

    const continueButton = dialogQueries.getByRole("button", {
      name: "Continue to Confirm",
    }) as HTMLButtonElement;
    expect(continueButton.disabled).toBe(true);

    fireEvent.click(
      dialogQueries.getByRole("button", { name: /components\/button\.tsx/i }),
    );

    await waitFor(() => {
      expect(mocks.getSyncConflictDetail).toHaveBeenCalledWith(
        "/repo/project-a",
        "/repo/main",
        "components/button.tsx",
        "to-primary",
      );
    });
    expect(
      dialogQueries.getByText("Ours = Primary • Theirs = Project"),
    ).toBeTruthy();

    fireEvent.click(
      dialogQueries.getByRole("button", { name: /tokens\/new\.ts/i }),
    );

    await waitFor(() => {
      expect(
        dialogQueries.getByRole("button", { name: "Delete" }),
      ).toBeTruthy();
    });
    expect(dialogQueries.getByRole("button", { name: "Keep" })).toBeTruthy();
    expect(dialogQueries.getByText("Push this file to Primary")).toBeTruthy();
    expect(
      dialogQueries.getByText(
        "Delete this file from Project instead of pushing it",
      ),
    ).toBeTruthy();
    expect(mocks.previewSyncFileDiff).toHaveBeenCalledWith(
      "/repo/project-a",
      "/repo/main",
      "tokens/new.ts",
      "added",
    );

    fireEvent.click(dialogQueries.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(dialogQueries.getByText(/Selected: Delete/)).toBeTruthy();
      expect(
        dialogQueries.getByText(
          "All required file actions selected. You can continue to confirmation.",
        ),
      ).toBeTruthy();
    });
    expect(continueButton.disabled).toBe(true);
  });

  it("renders Restore/Delete controls and file preview for deleted decision files", async () => {
    mocks.previewSyncChanges.mockResolvedValueOnce({
      files: [{ path: ".claude/settings.local.json", changeType: "deleted" }],
      summary: { added: 0, modified: 0, deleted: 1 },
      decisions: [
        {
          path: ".claude/settings.local.json",
          kind: "deleted",
          allowedActions: ["keep", "delete"],
        },
      ],
      fingerprint: "preview-deleted-decision-123",
    });
    mocks.previewSyncFileDiff.mockResolvedValueOnce(
      "diff --git a/.claude/settings.local.json b/.claude/settings.local.json",
    );

    const { AcmeSync } = await import("./acme-sync");

    flushSync(() => {
      root?.render(React.createElement(AcmeSync));
    });

    await flushAsyncWork();

    fireEvent.click(screen.getByRole("button", { name: "Push to Primary" }));

    await waitFor(() => {
      expect(mocks.previewSyncChanges).toHaveBeenCalled();
    });

    const dialog = await screen.findByRole("dialog", { name: "Preview Push" });
    const dialogQueries = within(dialog);

    fireEvent.click(
      dialogQueries.getByRole("button", {
        name: /\.claude\/settings\.local\.json/i,
      }),
    );

    await waitFor(() => {
      expect(
        dialogQueries.getByRole("button", { name: "Restore" }),
      ).toBeTruthy();
      expect(
        dialogQueries.getByRole("button", { name: "Delete" }),
      ).toBeTruthy();
    });

    expect(dialogQueries.queryByRole("button", { name: "Keep" })).toBeNull();
    expect(dialogQueries.getByText("Action required")).toBeTruthy();
    expect(
      dialogQueries.getByText("Restore this file back to Project"),
    ).toBeTruthy();
    expect(
      dialogQueries.getByText("Delete this file from Primary"),
    ).toBeTruthy();
    await waitFor(() => {
      expect(mocks.previewSyncFileDiff).toHaveBeenCalledWith(
        "/repo/project-a",
        "/repo/main",
        ".claude/settings.local.json",
        "deleted",
      );
    });
    expect(
      dialogQueries.getByText(
        "diff --git a/.claude/settings.local.json b/.claude/settings.local.json",
      ),
    ).toBeTruthy();

    fireEvent.click(dialogQueries.getByRole("button", { name: "Restore" }));

    await waitFor(() => {
      expect(dialogQueries.getByText("Selected: Restore")).toBeTruthy();
    });
  });

  it("applies the selected file action immediately and refreshes preview", async () => {
    mocks.previewSyncChanges
      .mockResolvedValueOnce({
        files: [{ path: ".claude/settings.local.json", changeType: "deleted" }],
        summary: { added: 0, modified: 0, deleted: 1 },
        decisions: [
          {
            path: ".claude/settings.local.json",
            kind: "deleted",
            allowedActions: ["keep", "delete"],
          },
        ],
        fingerprint: "preview-apply-123",
      })
      .mockResolvedValueOnce({
        files: [],
        summary: { added: 0, modified: 0, deleted: 0 },
        decisions: [],
        fingerprint: "preview-apply-124",
      });
    mocks.previewSyncFileDiff.mockResolvedValueOnce(
      "diff --git a/.claude/settings.local.json b/.claude/settings.local.json",
    );

    const { AcmeSync } = await import("./acme-sync");

    flushSync(() => {
      root?.render(React.createElement(AcmeSync));
    });

    await flushAsyncWork();

    fireEvent.click(screen.getByRole("button", { name: "Push to Primary" }));

    const dialog = await screen.findByRole("dialog", { name: "Preview Push" });
    const dialogQueries = within(dialog);

    fireEvent.click(
      dialogQueries.getByRole("button", {
        name: /\.claude\/settings\.local\.json/i,
      }),
    );

    await waitFor(() => {
      expect(
        dialogQueries.getByRole("button", { name: "Restore" }),
      ).toBeTruthy();
    });

    fireEvent.click(dialogQueries.getByRole("button", { name: "Restore" }));

    await waitFor(() => {
      expect(dialogQueries.getByText("Selected: Restore")).toBeTruthy();
    });

    fireEvent.click(
      dialogQueries.getByRole("button", { name: "Apply selected action" }),
    );

    await waitFor(() => {
      expect(mocks.commandExecute).toHaveBeenCalled();
      expect(mocks.previewSyncChanges).toHaveBeenCalledTimes(2);
      expect(dialogQueries.getByText("No file changes.")).toBeTruthy();
    });
  });

  it("falls back to file diff when preview has no conflicts", async () => {
    mocks.previewSyncChanges.mockResolvedValueOnce({
      files: [{ path: "components/button.tsx", changeType: "modified" }],
      summary: { added: 0, modified: 1, deleted: 0 },
      fingerprint: "preview-no-conflicts",
    });

    const { AcmeSync } = await import("./acme-sync");

    flushSync(() => {
      root?.render(React.createElement(AcmeSync));
    });

    await flushAsyncWork();

    fireEvent.click(screen.getByRole("button", { name: "Pull from Primary" }));

    await waitFor(() => {
      expect(mocks.previewSyncChanges).toHaveBeenCalled();
    });

    const dialog = await screen.findByRole("dialog", { name: "Preview Pull" });
    const dialogQueries = within(dialog);

    fireEvent.click(
      dialogQueries.getByRole("button", { name: /components\/button\.tsx/i }),
    );

    await waitFor(() => {
      expect(mocks.previewSyncFileDiff).toHaveBeenCalledWith(
        "/repo/main",
        "/repo/project-a",
        "components/button.tsx",
        "modified",
      );
    });

    expect(mocks.getSyncConflictDetail).not.toHaveBeenCalled();
    expect(dialogQueries.getByText("diff --git a/file b/file")).toBeTruthy();
  });
  it("hides the conflicts section in pull preview modal", async () => {
    const { AcmeSync } = await import("./acme-sync");

    flushSync(() => {
      root?.render(React.createElement(AcmeSync));
    });

    await flushAsyncWork();

    fireEvent.click(screen.getByRole("button", { name: "Pull from Primary" }));

    const previewDialog = await screen.findByRole("dialog", {
      name: "Preview Pull",
    });
    const previewQueries = within(previewDialog);

    expect(previewQueries.queryByText("Conflicts")).toBeNull();
  });

  it("keeps confirmation open and shows stale preview errors when execution fails", async () => {
    mocks.executeSyncAction.mockRejectedValueOnce(
      new Error("Conflict preview is stale. Refresh preview and try again."),
    );
    mocks.previewSyncChanges.mockResolvedValueOnce({
      files: [{ path: "tokens/new.ts", changeType: "added" }],
      summary: { added: 1, modified: 0, deleted: 0 },
      decisions: [
        {
          path: "tokens/new.ts",
          kind: "added",
          allowedActions: ["keep", "delete"],
        },
      ],
      fingerprint: "preview-stale-123",
    });

    const { AcmeSync } = await import("./acme-sync");

    flushSync(() => {
      root?.render(React.createElement(AcmeSync));
    });

    await flushAsyncWork();

    fireEvent.click(screen.getByRole("button", { name: "Push to Primary" }));

    const previewDialog = await screen.findByRole("dialog", {
      name: "Preview Push",
    });
    const previewQueries = within(previewDialog);

    fireEvent.click(previewQueries.getByRole("button", { name: "Delete" }));
    fireEvent.click(
      previewQueries.getByRole("button", { name: "Continue to Confirm" }),
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Confirm Push" })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Confirm Push" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "Conflict preview is stale. Refresh preview and try again.",
        ),
      ).toBeTruthy();
    });

    expect(screen.getByRole("button", { name: "Confirm Push" })).toBeTruthy();
    expect(mocks.addToast).toHaveBeenCalledWith(
      "Conflict preview is stale. Refresh preview and try again.",
      "error",
    );
  });
});

console.log("preview modal conflict control checks passed");
