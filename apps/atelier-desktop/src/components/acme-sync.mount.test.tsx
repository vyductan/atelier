// @vitest-environment jsdom

import type { Root } from "react-dom/client";
import { fireEvent, screen, within } from "@testing-library/react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const syncStrategyMarkdown = `Create crob job (claude/openclaw)

- run daily
- check github/gitlab repo
- if any commit from vyductan-react -> in project using "@acme" switch to "ui" -> merge main branch -> copy code -> review -> check pnpm typecheck/lint/format -> commit & push -> create PR
- if any commit from project using "@acme" -> in vyductan-react switch to "{project-name}" branch -> merge "main" branch -> copy code -> review -> check pnpm typecheck/lint/format -> commit & push -> create PR
`;

import type {
  PrimaryRemoteStatus,
  RepoMetadata,
  SyncProfile,
  SyncStatusResult,
} from "../lib/types";
import { getWorkspaceFileContent } from "../lib/workspace";

const getWorkspaceFileContentMock = vi.mocked(getWorkspaceFileContent);

const noop = () => {
  return null;
};

const mocks = vi.hoisted(() => ({
  addToast: vi.fn(),
  executeSubtreeAdd: vi.fn(),
  executeSyncAction: vi.fn(),
  getPrimaryRemoteStatus: vi.fn(),
  getRepoMetadata: vi.fn(),
  invoke: vi.fn(),
  onFocusChanged: vi.fn(),
  previewSubtreeSync: vi.fn(),
  previewSyncChanges: vi.fn(),
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
  CodeBlock: ({ children }: { children?: React.ReactNode }) => children ?? null,
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
  executeSubtreeAdd: mocks.executeSubtreeAdd,
  executeSyncAction: mocks.executeSyncAction,
  getPrimaryRemoteStatus: mocks.getPrimaryRemoteStatus,
  getRepoMetadata: mocks.getRepoMetadata,
  previewSubtreeSync: mocks.previewSubtreeSync,
  previewSyncChanges: mocks.previewSyncChanges,
  previewSyncFileDiff: vi.fn(),
}));

vi.mock("../lib/workspace", () => ({
  getWorkspaceFileContent: vi.fn(),
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

async function flushAsyncWork() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

function getProjectRow(projectPath: string) {
  const row = [...document.querySelectorAll("li")].find((item) =>
    item.textContent?.includes(projectPath),
  );

  expect(row).toBeTruthy();
  return row as HTMLLIElement;
}

function getSubtreeRepoMetadata(): RepoMetadata {
  return {
    branch: "main",
    lastCommitMessage: "chore: refresh acme sync fixtures",
    lastUpdated: "2026-03-10 12:00:00",
  };
}

function getPrimaryRemoteStatusFixture(
  overrides: Partial<PrimaryRemoteStatus> = {},
): PrimaryRemoteStatus {
  return {
    upstreamBranch: "origin/main",
    workingTreeDirty: false,
    aheadCount: 0,
    behindCount: 0,
    status: "synced",
    message: null,
    ...overrides,
  };
}

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

describe("AcmeSync mount behavior", () => {
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
      {
        id: "subtree-1",
        projectPath: "/repo/project-b/worktree",
        primaryPath: "/repo/main",
        mode: "subtree",
        subtree: {
          repoRoot: "/repo/project-b",
          prefix: "@acme",
          remote: "origin",
          branch: "main",
          squash: true,
        },
      },
      {
        id: "patch-1",
        projectPath: "/repo/project-c",
        primaryPath: "/repo/main",
        mode: "patch",
      },
    ];

    mocks.addToast.mockReset();
    mocks.executeSubtreeAdd.mockReset();
    mocks.executeSyncAction.mockReset();
    mocks.getPrimaryRemoteStatus.mockReset();
    mocks.getRepoMetadata.mockReset();
    mocks.invoke.mockReset();
    mocks.onFocusChanged.mockReset();
    mocks.previewSubtreeSync.mockReset();
    mocks.previewSyncChanges.mockReset();
    getWorkspaceFileContentMock.mockReset();

    mocks.getRepoMetadata.mockImplementation(async () =>
      getSubtreeRepoMetadata(),
    );
    mocks.getPrimaryRemoteStatus.mockResolvedValue(
      getPrimaryRemoteStatusFixture(),
    );
    mocks.invoke.mockResolvedValue("2026-03-10 12:00:00");
    mocks.onFocusChanged.mockResolvedValue(noop);
    getWorkspaceFileContentMock.mockResolvedValue({
      filePath: "SYNC_STRATEGY.md",
      content: "",
      exists: false,
      isBinary: false,
      tooLarge: false,
    });
    mocks.previewSyncChanges.mockResolvedValue({
      files: [],
      summary: { added: 0, modified: 0, deleted: 0 },
    });
    mocks.executeSyncAction.mockImplementation(async () => {
      return;
    });
    mocks.previewSubtreeSync.mockResolvedValue(getSubtreeSyncStatus());
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

  it("shows compact subtree status wording on the row without preview interaction", async () => {
    mocks.previewSubtreeSync.mockResolvedValueOnce(
      getSubtreeSyncStatus({
        state: "behind",
        behindCount: 3,
        message: "Primary branch is ahead by 3 commits.",
      }),
    );

    const { AcmeSync } = await import("./acme-sync");

    flushSync(() => {
      root?.render(<AcmeSync />);
    });

    await flushAsyncWork();

    const subtreeRow = getProjectRow("/repo/project-b/worktree");
    expect(subtreeRow.textContent).toContain("Project @acme: No local changes");
    expect(subtreeRow.textContent).toContain("Source sync: Behind source (3)");

    const rsyncRow = getProjectRow("/repo/project-a");
    expect(rsyncRow.textContent).not.toContain("Project @acme:");
    expect(rsyncRow.textContent).not.toContain("Source sync:");
    expect(mocks.previewSubtreeSync).toHaveBeenCalledWith(
      storeState.profiles[1],
      "from-primary",
    );
  });

  it("prioritizes subtree status wording for clean, misconfigured, missing subtree, and dirty states", async () => {
    const { AcmeSync } = await import("./acme-sync");

    mocks.previewSubtreeSync.mockResolvedValueOnce(
      getSubtreeSyncStatus({
        state: "clean",
      }),
    );
    flushSync(() => {
      root?.render(<AcmeSync key="clean-status" />);
    });
    await flushAsyncWork();
    expect(getProjectRow("/repo/project-b/worktree").textContent).toContain(
      "Project @acme: No local changes",
    );
    expect(getProjectRow("/repo/project-b/worktree").textContent).toContain(
      "Source sync: In sync",
    );

    mocks.previewSubtreeSync.mockResolvedValueOnce(
      getSubtreeSyncStatus({
        state: "misconfigured",
        message: "Missing subtree prefix.",
      }),
    );
    flushSync(() => {
      root?.render(<AcmeSync key="misconfigured-status" />);
    });
    await flushAsyncWork();
    expect(getProjectRow("/repo/project-b/worktree").textContent).toContain(
      "Project @acme: Unknown",
    );
    expect(getProjectRow("/repo/project-b/worktree").textContent).toContain(
      "Source sync: Misconfigured",
    );
    expect(
      within(getProjectRow("/repo/project-b/worktree")).queryByRole("button", {
        name: 'Add subtree "@acme"',
      }),
    ).toBeNull();

    mocks.previewSubtreeSync.mockResolvedValueOnce(
      getSubtreeSyncStatus({
        state: "missing_subtree",
        message: "This branch does not currently contain @acme.",
      }),
    );
    flushSync(() => {
      root?.render(<AcmeSync key="missing-subtree-status" />);
    });
    await flushAsyncWork();
    const missingSubtreeRow = getProjectRow("/repo/project-b/worktree");
    expect(missingSubtreeRow.textContent).toContain(
      "Project @acme: Missing subtree",
    );
    expect(missingSubtreeRow.textContent).toContain(
      "Source sync: Cannot compare",
    );
    expect(missingSubtreeRow.textContent).toContain(
      "This branch does not currently contain @acme.",
    );
    expect(
      within(missingSubtreeRow).getByRole("button", {
        name: 'Add subtree "@acme"',
      }),
    ).toBeTruthy();

    mocks.previewSubtreeSync.mockResolvedValueOnce(
      getSubtreeSyncStatus({
        state: "clean",
        dirty: true,
        message: "Working tree has uncommitted changes.",
      }),
    );
    flushSync(() => {
      root?.render(<AcmeSync key="dirty-status" />);
    });
    await flushAsyncWork();
    expect(getProjectRow("/repo/project-b/worktree").textContent).toContain(
      "Project @acme: Modified",
    );
    expect(getProjectRow("/repo/project-b/worktree").textContent).toContain(
      "Source sync: In sync",
    );
  });

  it("preloads and refreshes subtree status on mount and focus for current subtree profiles only", async () => {
    let focusChangeListener:
      | ((event: { payload: boolean }) => void | Promise<void>)
      | undefined;

    mocks.onFocusChanged.mockImplementation(async (callback) => {
      focusChangeListener = callback;
      return vi.fn();
    });

    mocks.previewSubtreeSync
      .mockResolvedValueOnce(
        getSubtreeSyncStatus({ state: "behind", behindCount: 3 }),
      )
      .mockResolvedValueOnce(getSubtreeSyncStatus({ state: "clean" }));

    const { AcmeSync } = await import("./acme-sync");

    flushSync(() => {
      root?.render(<AcmeSync />);
    });

    await flushAsyncWork();

    expect(mocks.previewSubtreeSync).toHaveBeenCalledTimes(1);
    expect(mocks.previewSubtreeSync).toHaveBeenNthCalledWith(
      1,
      storeState.profiles[1],
      "from-primary",
    );
    expect(mocks.previewSyncChanges).not.toHaveBeenCalled();

    mocks.previewSubtreeSync.mockClear();
    mocks.previewSyncChanges.mockClear();

    expect(focusChangeListener).toBeTruthy();
    await focusChangeListener?.({ payload: true });
    await flushAsyncWork();

    expect(mocks.previewSubtreeSync).toHaveBeenCalledTimes(1);
    expect(mocks.previewSubtreeSync).toHaveBeenNthCalledWith(
      1,
      storeState.profiles[1],
      "from-primary",
    );
    expect(mocks.previewSyncChanges).not.toHaveBeenCalled();
  });

  it("does not prefetch rsync previews on initial tab render", async () => {
    const { AcmeSync } = await import("./acme-sync");

    flushSync(() => {
      root?.render(<AcmeSync />);
    });

    await flushAsyncWork();

    expect(mocks.previewSyncChanges).not.toHaveBeenCalled();
    expect(mocks.previewSubtreeSync).toHaveBeenCalledTimes(1);
    expect(mocks.previewSubtreeSync).toHaveBeenCalledWith(
      storeState.profiles[1],
      "from-primary",
    );
  });

  it("does not scan modified times for every repo on initial tab render", async () => {
    const { AcmeSync } = await import("./acme-sync");

    flushSync(() => {
      root?.render(<AcmeSync />);
    });

    await flushAsyncWork();

    expect(mocks.invoke).not.toHaveBeenCalledWith("get_latest_modified", {
      path: "/repo/main",
    });
    expect(mocks.invoke).not.toHaveBeenCalledWith("get_latest_modified", {
      path: "/repo/project-a",
    });
    expect(mocks.invoke).not.toHaveBeenCalledWith("get_latest_modified", {
      path: "/repo/project-b",
    });
  });

  it("shows only subtree-supported row actions for subtree profiles", async () => {
    const { AcmeSync } = await import("./acme-sync");

    flushSync(() => {
      root?.render(<AcmeSync />);
    });

    await flushAsyncWork();

    const row = getProjectRow("/repo/project-b/worktree");

    expect(row.textContent).toContain("SUBTREE");
    expect(row.textContent).not.toContain("Push");
    expect(row.textContent).not.toContain("Preview Push");
    expect(row.textContent).toContain("Preview History");
    expect(row.textContent).toContain("AI Sync");

    const configureButton = row.querySelector(
      'button[title="Configure sync profile"][aria-label="Configure sync profile"]',
    );
    expect(configureButton).toBeTruthy();
  });

  it("keeps subtree preview modal on history wording without rsync conflict UI", async () => {
    mocks.previewSubtreeSync
      .mockResolvedValueOnce(
        getSubtreeSyncStatus({
          state: "clean",
          message: "Already in sync.",
        }),
      )
      .mockResolvedValueOnce(
        getSubtreeSyncStatus({
          state: "behind",
          behindCount: 2,
          message: "2 subtree commits available from primary.",
        }),
      );

    const { AcmeSync } = await import("./acme-sync");

    flushSync(() => {
      root?.render(<AcmeSync />);
    });

    await flushAsyncWork();

    const subtreeRow = getProjectRow("/repo/project-b/worktree");
    const previewHistoryButton = within(subtreeRow).getAllByRole("button", {
      name: "Preview History",
    })[1];
    expect(previewHistoryButton).toBeTruthy();
    fireEvent.click(previewHistoryButton as HTMLElement);

    const dialog = await screen.findByRole("dialog", {
      name: "Preview History",
    });
    const dialogQueries = within(dialog);

    expect(
      dialogQueries.getAllByText("2 subtree commits available from primary.")
        .length,
    ).toBeGreaterThan(0);
    expect(dialogQueries.queryByText("Conflicts")).toBeNull();
    expect(
      dialogQueries.queryByRole("button", { name: "Continue to Confirm" }),
    ).toBeNull();
  });

  it("shows patch row actions with patch badge", async () => {
    const { AcmeSync } = await import("./acme-sync");

    flushSync(() => {
      root?.render(<AcmeSync />);
    });

    await flushAsyncWork();

    const row = getProjectRow("/repo/project-c");

    expect(row.textContent).toContain("PATCH");
    expect(row.textContent).toContain("Pull");
    expect(row.textContent).toContain("Push");
    expect(row.textContent).toContain("Preview Pull");
    expect(row.textContent).toContain("Preview Push");
    expect(row.textContent).toContain("AI Sync");
  });

  it("shows the full rsync row action set for rsync profiles", async () => {
    const { AcmeSync } = await import("./acme-sync");

    flushSync(() => {
      root?.render(<AcmeSync />);
    });

    await flushAsyncWork();

    const row = getProjectRow("/repo/project-a");

    expect(row.textContent).toContain("RSYNC");
    expect(row.textContent).toContain("Pull");
    expect(row.textContent).toContain("Push");
    expect(row.textContent).toContain("Preview Pull");
    expect(row.textContent).toContain("Preview Push");
    expect(row.textContent).toContain("AI Sync");

    const configureButton = row.querySelector(
      'button[title="Configure sync profile"][aria-label="Configure sync profile"]',
    );
    expect(configureButton).toBeTruthy();
  });

  it("shows subtree project metadata only for subtree rows", async () => {
    mocks.getRepoMetadata.mockImplementation(async (path: string) => {
      if (path === "/repo/main") {
        return {
          branch: "main",
          lastCommitMessage: "chore: refresh acme sync fixtures",
          lastUpdated: "2026-03-10 12:00:00",
        };
      }

      if (path === "/repo/project-b") {
        return {
          branch: "main",
          lastCommitMessage: "chore: refresh acme sync fixtures",
          lastUpdated: "2026-03-10 12:00:00",
        };
      }

      return {
        branch: "feature/demo",
        lastCommitMessage: "feat: rsync metadata should stay hidden",
        lastUpdated: "2026-03-09 08:30:00",
      };
    });

    const { AcmeSync } = await import("./acme-sync");

    flushSync(() => {
      root?.render(<AcmeSync />);
    });

    await flushAsyncWork();

    const subtreeRow = getProjectRow("/repo/project-b/worktree");
    expect(subtreeRow.textContent).not.toContain(
      "Updated: 2026-03-10 12:00:00",
    );
    expect(subtreeRow.textContent).toContain("Branch: main");
    expect(subtreeRow.textContent).toContain(
      "Repo updated: 2026-03-10 12:00:00",
    );
    expect(subtreeRow.textContent).toContain(
      "Last commit: chore: refresh acme sync fixtures",
    );

    const rsyncRow = getProjectRow("/repo/project-a");
    expect(rsyncRow.textContent).not.toContain("Branch:");
    expect(rsyncRow.textContent).not.toContain("Repo updated:");
    expect(rsyncRow.textContent).not.toContain("Last commit:");
  });

  it("refreshes subtree repo metadata using repoRoot on window focus without leaking listeners across profile changes", async () => {
    const firstRegistration = createDeferred<() => void>();
    let focusChangeListener:
      | ((event: { payload: boolean }) => void | Promise<void>)
      | undefined;
    const unlistenFirst = vi.fn();
    const unlistenSecond = vi.fn();

    mocks.onFocusChanged
      .mockImplementationOnce(async (callback) => {
        focusChangeListener = callback;
        return await firstRegistration.promise;
      })
      .mockImplementationOnce(async (callback) => {
        focusChangeListener = callback;
        return unlistenSecond;
      });

    mocks.getRepoMetadata.mockImplementation(async (path: string) => {
      if (path === "/repo/main") {
        return {
          branch: "main",
          lastCommitMessage: "chore: refresh acme sync fixtures",
          lastUpdated: "2026-03-10 12:00:00",
        };
      }

      if (path === "/repo/project-b" || path === "/repo/project-c") {
        return {
          branch: "main",
          lastCommitMessage: "chore: refresh acme sync fixtures",
          lastUpdated: "2026-03-10 12:00:00",
        };
      }

      throw new Error(`Unexpected metadata lookup for ${path}`);
    });

    const { AcmeSync } = await import("./acme-sync");

    flushSync(() => {
      root?.render(<AcmeSync />);
    });

    await flushAsyncWork();

    expect(mocks.onFocusChanged).toHaveBeenCalledTimes(1);
    expect(mocks.getRepoMetadata).toHaveBeenCalledWith("/repo/main");
    expect(mocks.getRepoMetadata).toHaveBeenCalledWith("/repo/project-b");
    expect(mocks.getRepoMetadata).not.toHaveBeenCalledWith("/repo/project-a");

    const firstProfile = storeState.profiles[0];
    expect(firstProfile).toBeTruthy();

    storeState.profiles = [
      firstProfile as SyncProfile,
      {
        id: "subtree-2",
        projectPath: "/repo/project-c/worktree",
        primaryPath: "/repo/main",
        mode: "subtree",
        subtree: {
          repoRoot: "/repo/project-c",
          prefix: "@acme",
          remote: "origin",
          branch: "main",
          squash: true,
        },
      },
    ];

    flushSync(() => {
      root?.render(<AcmeSync />);
    });

    await flushAsyncWork();

    expect(mocks.onFocusChanged).toHaveBeenCalledTimes(1);

    firstRegistration.resolve(unlistenFirst);
    await flushAsyncWork();

    expect(unlistenFirst).not.toHaveBeenCalled();
    expect(unlistenSecond).not.toHaveBeenCalled();

    mocks.getRepoMetadata.mockClear();
    mocks.invoke.mockClear();

    expect(focusChangeListener).toBeTruthy();
    await focusChangeListener?.({ payload: true });
    await flushAsyncWork();

    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).toHaveBeenCalledWith("get_latest_modified", {
      path: "/repo/main",
    });
    expect(mocks.getRepoMetadata).toHaveBeenCalledTimes(2);
    expect(mocks.getRepoMetadata).toHaveBeenNthCalledWith(1, "/repo/main");
    expect(mocks.getRepoMetadata).toHaveBeenNthCalledWith(2, "/repo/project-c");
  });

  it("shows the refined Primary card layout with an icon-only path action", async () => {
    const latestCommitMessage = "chore: refresh acme sync fixtures";
    mocks.getRepoMetadata.mockResolvedValueOnce({
      branch: "main",
      lastCommitMessage: latestCommitMessage,
      lastUpdated: "2026-03-10 12:00:00",
    });

    const { AcmeSync } = await import("./acme-sync");

    flushSync(() => {
      root?.render(<AcmeSync />);
    });

    await flushAsyncWork();

    const primarySectionTitle = [...document.querySelectorAll("h3")].find(
      (heading) => heading.textContent?.includes("Primary @acme Path"),
    );
    expect(primarySectionTitle).toBeTruthy();

    const primaryCard = primarySectionTitle?.closest("div[data-section]");
    expect(primaryCard).toBeTruthy();
    expect(primaryCard?.textContent).toContain("Primary @acme Path");
    expect(primaryCard?.textContent).toContain("/repo/main");

    const setPrimaryPathButton = primaryCard?.querySelector(
      'button[title="Set primary path"][aria-label="Set primary path"]',
    );
    expect(setPrimaryPathButton).toBeTruthy();
    expect(primaryCard?.textContent).not.toContain("Set Path");

    expect(primaryCard?.textContent).toContain("Branch: main");
    expect(primaryCard?.textContent).toContain("Updated: 2026-03-10 12:00:00");
    expect(primaryCard?.textContent).toContain("Synced to Remote");
    expect(primaryCard?.textContent).toContain(
      `Last commit: ${latestCommitMessage}`,
    );
  });

  it("shows Synced to Remote for a clean primary repo", async () => {
    mocks.getPrimaryRemoteStatus.mockResolvedValueOnce(
      getPrimaryRemoteStatusFixture(),
    );

    const { AcmeSync } = await import("./acme-sync");

    flushSync(() => {
      root?.render(<AcmeSync />);
    });

    await flushAsyncWork();

    expect(screen.getByText("Synced to Remote")).toBeTruthy();
    expect(
      screen.queryByText("Uncommitted changes in primary repo"),
    ).toBeNull();
  });

  it("shows Not Synced to Remote with uncommitted changes", async () => {
    mocks.getPrimaryRemoteStatus.mockResolvedValueOnce(
      getPrimaryRemoteStatusFixture({
        workingTreeDirty: true,
        status: "unpublished",
      }),
    );

    const { AcmeSync } = await import("./acme-sync");

    flushSync(() => {
      root?.render(<AcmeSync />);
    });

    await flushAsyncWork();

    expect(screen.getByText("Not Synced to Remote")).toBeTruthy();
    expect(
      screen.getByText("Uncommitted changes in primary repo"),
    ).toBeTruthy();
  });

  it("calls the schedule callback with a prefilled scheduled sync draft", async () => {
    const onCreateScheduledSyncTask = vi.fn();
    getWorkspaceFileContentMock
      .mockResolvedValueOnce({
        filePath: "SYNC_STRATEGY.md",
        content: syncStrategyMarkdown,
        exists: true,
        isBinary: false,
        tooLarge: false,
      })
      .mockResolvedValueOnce({
        filePath: "SYNC_STRAITEGY.md",
        content: syncStrategyMarkdown,
        exists: true,
        isBinary: false,
        tooLarge: false,
      });

    const { AcmeSync } = await import("./acme-sync");

    flushSync(() => {
      root?.render(
        <AcmeSync onCreateScheduledSyncTask={onCreateScheduledSyncTask} />,
      );
    });

    await flushAsyncWork();

    fireEvent.click(screen.getAllByRole("button", { name: /schedule sync/i })[0]!);
    await flushAsyncWork();

    expect(getWorkspaceFileContentMock).toHaveBeenCalledWith(
      "/repo/main",
      "SYNC_STRATEGY.md",
    );
    expect(onCreateScheduledSyncTask).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "@acme sync project-a",
        workspacePath: "/repo/project-a",
        frequency: "daily",
        cron: "0 9 * * *",
        worktreeEnabled: true,
        prompt: expect.stringContaining("Create crob job (claude/openclaw)"),
      }),
    );
  });

  it("falls back to the legacy misspelled strategy filename", async () => {
    const onCreateScheduledSyncTask = vi.fn();
    getWorkspaceFileContentMock
      .mockResolvedValueOnce({
        filePath: "SYNC_STRATEGY.md",
        content: "",
        exists: false,
        isBinary: false,
        tooLarge: false,
      })
      .mockResolvedValueOnce({
        filePath: "SYNC_STRAITEGY.md",
        content: syncStrategyMarkdown,
        exists: true,
        isBinary: false,
        tooLarge: false,
      });

    const { AcmeSync } = await import("./acme-sync");

    flushSync(() => {
      root?.render(
        <AcmeSync onCreateScheduledSyncTask={onCreateScheduledSyncTask} />,
      );
    });

    await flushAsyncWork();

    fireEvent.click(screen.getAllByRole("button", { name: /schedule sync/i })[0]!);
    await flushAsyncWork();

    expect(getWorkspaceFileContentMock).toHaveBeenNthCalledWith(
      1,
      "/repo/main",
      "SYNC_STRATEGY.md",
    );
    expect(getWorkspaceFileContentMock).toHaveBeenNthCalledWith(
      2,
      "/repo/main",
      "SYNC_STRAITEGY.md",
    );
    expect(onCreateScheduledSyncTask).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining("Create crob job (claude/openclaw)"),
      }),
    );
  });

  it("shows an error and skips draft creation when the strategy file is invalid", async () => {
    const onCreateScheduledSyncTask = vi.fn();
    getWorkspaceFileContentMock.mockResolvedValueOnce({
      filePath: "SYNC_STRATEGY.md",
      content: "Create crob job (claude/openclaw)\n\n- run weekly\n",
      exists: true,
      isBinary: false,
      tooLarge: false,
    });

    const { AcmeSync } = await import("./acme-sync");

    flushSync(() => {
      root?.render(
        <AcmeSync onCreateScheduledSyncTask={onCreateScheduledSyncTask} />,
      );
    });

    await flushAsyncWork();

    fireEvent.click(screen.getAllByRole("button", { name: /schedule sync/i })[0]!);
    await flushAsyncWork();

    expect(onCreateScheduledSyncTask).not.toHaveBeenCalled();
    expect(mocks.addToast).toHaveBeenCalledWith(
      "Sync strategy must explicitly include 'run daily' for the V1 preset",
      "error",
    );
  });

  it("shows Not Synced to Remote with ahead count", async () => {
    mocks.getPrimaryRemoteStatus.mockResolvedValueOnce(
      getPrimaryRemoteStatusFixture({
        aheadCount: 2,
        status: "unpublished",
      }),
    );

    const { AcmeSync } = await import("./acme-sync");

    flushSync(() => {
      root?.render(<AcmeSync />);
    });

    await flushAsyncWork();

    expect(screen.getByText("Not Synced to Remote")).toBeTruthy();
    expect(screen.getByText("Ahead of remote by 2 commits")).toBeTruthy();
  });

  it("shows combined dirty and ahead detail", async () => {
    mocks.getPrimaryRemoteStatus.mockResolvedValueOnce(
      getPrimaryRemoteStatusFixture({
        workingTreeDirty: true,
        aheadCount: 2,
        status: "unpublished",
      }),
    );

    const { AcmeSync } = await import("./acme-sync");

    flushSync(() => {
      root?.render(<AcmeSync />);
    });

    await flushAsyncWork();

    expect(screen.getByText("Not Synced to Remote")).toBeTruthy();
    expect(
      screen.getByText(
        "Uncommitted changes in primary repo • Ahead of remote by 2 commits",
      ),
    ).toBeTruthy();
  });

  it("shows Remote Unknown when no upstream is configured", async () => {
    mocks.getPrimaryRemoteStatus.mockResolvedValueOnce(
      getPrimaryRemoteStatusFixture({
        upstreamBranch: null,
        status: "unknown",
        message: "No upstream branch configured",
      }),
    );

    const { AcmeSync } = await import("./acme-sync");

    flushSync(() => {
      root?.render(<AcmeSync />);
    });

    await flushAsyncWork();

    expect(screen.getByText("Remote Unknown")).toBeTruthy();
    expect(screen.getByText("No upstream branch configured")).toBeTruthy();
  });

  it("re-fetches primary remote status on focus for the current main path", async () => {
    let focusChangeListener:
      | ((event: { payload: boolean }) => void | Promise<void>)
      | undefined;

    mocks.onFocusChanged.mockImplementation(async (callback) => {
      focusChangeListener = callback;
      return vi.fn();
    });

    const { AcmeSync } = await import("./acme-sync");

    flushSync(() => {
      root?.render(<AcmeSync />);
    });

    await flushAsyncWork();

    expect(mocks.getPrimaryRemoteStatus).toHaveBeenCalledWith("/repo/main");

    mocks.getPrimaryRemoteStatus.mockClear();

    expect(focusChangeListener).toBeTruthy();
    await focusChangeListener?.({ payload: true });
    await flushAsyncWork();

    expect(mocks.getPrimaryRemoteStatus).toHaveBeenCalledTimes(1);
    expect(mocks.getPrimaryRemoteStatus).toHaveBeenCalledWith("/repo/main");
  });

  it("shows immediate feedback and success toast when adding a missing subtree", async () => {
    const deferred = createDeferred<void>();
    mocks.executeSubtreeAdd.mockReturnValueOnce(deferred.promise);
    mocks.previewSubtreeSync.mockResolvedValueOnce(
      getSubtreeSyncStatus({
        state: "missing_subtree",
        message: "This branch does not currently contain @acme.",
      }),
    );

    const { AcmeSync } = await import("./acme-sync");

    flushSync(() => {
      root?.render(<AcmeSync key="missing-subtree-click-success" />);
    });

    await flushAsyncWork();

    const row = getProjectRow("/repo/project-b/worktree");
    const addButton = within(row).getByRole("button", {
      name: 'Add subtree "@acme"',
    });

    fireEvent.click(addButton);
    await flushAsyncWork();

    expect(mocks.executeSubtreeAdd).toHaveBeenCalledWith(
      storeState.profiles[1],
    );
    expect(row.textContent).toContain("Adding subtree @acme…");
    expect(
      addButton.querySelector('[data-icon="refresh"]')?.className,
    ).toContain("animate-spin");

    deferred.resolve();
    await flushAsyncWork();

    expect(mocks.addToast).toHaveBeenCalledWith(
      'Added subtree "@acme" successfully!',
      "success",
    );
  });

  it("shows an error toast when adding a missing subtree fails", async () => {
    mocks.executeSubtreeAdd.mockRejectedValueOnce(
      new Error("git subtree add failed"),
    );
    mocks.previewSubtreeSync.mockResolvedValueOnce(
      getSubtreeSyncStatus({
        state: "missing_subtree",
        message: "This branch does not currently contain @acme.",
      }),
    );

    const { AcmeSync } = await import("./acme-sync");

    flushSync(() => {
      root?.render(<AcmeSync key="missing-subtree-click-error" />);
    });

    await flushAsyncWork();

    const row = getProjectRow("/repo/project-b/worktree");
    fireEvent.click(
      within(row).getByRole("button", {
        name: 'Add subtree "@acme"',
      }),
    );
    await flushAsyncWork();

    expect(mocks.executeSubtreeAdd).toHaveBeenCalledWith(
      storeState.profiles[1],
    );
    expect(mocks.addToast).toHaveBeenCalledWith(
      "git subtree add failed",
      "error",
    );
  });

  it("shows the active pull spinner while a confirmed rsync pull is running", async () => {
    const deferred = createDeferred<void>();
    mocks.executeSyncAction.mockReturnValueOnce(deferred.promise);

    const { AcmeSync } = await import("./acme-sync");

    flushSync(() => {
      root?.render(<AcmeSync />);
    });

    await flushAsyncWork();

    const row = getProjectRow("/repo/project-a");
    const pullButton = [...row.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Pull"),
    );

    expect(pullButton).toBeTruthy();
    pullButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushAsyncWork();

    const continueButton = [...document.querySelectorAll("button")].find(
      (button) => button.textContent?.includes("Continue to Confirm"),
    );
    expect(continueButton).toBeTruthy();
    continueButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushAsyncWork();

    const confirmButton = [...document.querySelectorAll("button")].find(
      (button) => button.textContent?.includes("Confirm Pull"),
    );
    expect(confirmButton).toBeTruthy();
    confirmButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushAsyncWork();

    expect(mocks.executeSyncAction).toHaveBeenCalledWith(
      storeState.profiles[0],
      "from-primary",
      undefined,
    );

    const refreshIcon = pullButton?.querySelector('[data-icon="refresh"]');
    expect(refreshIcon?.className).toContain("animate-spin");

    deferred.resolve();
    await flushAsyncWork();
  });
});
