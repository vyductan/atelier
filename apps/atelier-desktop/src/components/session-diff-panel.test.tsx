import type { Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  WorkspaceDiff,
  WorkspaceFileContent,
  WorkspaceStatus,
} from "../lib/workspace";
import { SessionDiffPanel } from "./session-diff-panel";

// @vitest-environment jsdom

const noop = vi.fn<(path: string) => Promise<void>>().mockResolvedValue();

describe("SessionDiffPanel", () => {
  let container: HTMLDivElement | null;
  let root: Root | null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
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

  it("renders the clean workspace empty state", () => {
    const status: WorkspaceStatus = {
      branch: "feature/atelier",
      changedFiles: [],
      isGitRepo: true,
      totalChanged: 0,
      worktreeLabel: "atelier",
    };

    flushSync(() => {
      root?.render(
        <SessionDiffPanel
          state="ready"
          status={status}
          diff={null}
          selectedPath={null}
          onSelectFile={noop}
        />,
      );
    });

    expect(container?.textContent).toContain("Changes");
    expect(container?.textContent).toContain(
      "No changed files in this workspace.",
    );
  });

  it("renders the non-git empty state", () => {
    const status: WorkspaceStatus = {
      branch: null,
      changedFiles: [],
      isGitRepo: false,
      totalChanged: 0,
      worktreeLabel: null,
    };

    flushSync(() => {
      root?.render(
        <SessionDiffPanel
          state="ready"
          status={status}
          diff={null}
          selectedPath={null}
          onSelectFile={noop}
        />,
      );
    });

    expect(container?.textContent).toContain("No git workspace available.");
  });

  it("renders changed files and the selected diff", () => {
    const status: WorkspaceStatus = {
      branch: "feature/atelier",
      changedFiles: [
        { path: "src/app.tsx", status: "modified" },
        { path: "README.md", status: "added" },
      ],
      isGitRepo: true,
      totalChanged: 2,
      worktreeLabel: "atelier",
    };
    const diff: WorkspaceDiff = {
      filePath: "src/app.tsx",
      isGitRepo: true,
      status: "modified",
      unifiedDiff: [
        "diff --git a/src/app.tsx b/src/app.tsx",
        "@@ -1 +1 @@",
        "-old line",
        "+new line",
      ].join("\n"),
    };

    flushSync(() => {
      root?.render(
        <SessionDiffPanel
          state="ready"
          status={status}
          diff={diff}
          selectedPath="src/app.tsx"
          onSelectFile={noop}
        />,
      );
    });

    expect(container?.textContent).toContain("app.tsx");
    expect(container?.textContent).toContain("README.md");
    expect(container?.textContent).toContain("Modified");
    expect(container?.textContent).toContain("Added");
    expect(container?.textContent).toContain(
      "diff --git a/src/app.tsx b/src/app.tsx",
    );
    expect(container?.textContent).toContain("+new line");
  });

  it("renders loading copy while workspace inspection is pending", () => {
    flushSync(() => {
      root?.render(
        <SessionDiffPanel
          state="loading"
          status={null}
          diff={null}
          selectedPath={null}
          onSelectFile={noop}
        />,
      );
    });

    expect(container?.textContent).toContain("Loading changes…");
  });

  it("renders selected diff loading copy without showing stale diff text", () => {
    const status: WorkspaceStatus = {
      branch: "feature/atelier",
      changedFiles: [{ path: "src/app.tsx", status: "modified" }],
      isGitRepo: true,
      totalChanged: 1,
      worktreeLabel: "atelier",
    };

    flushSync(() => {
      root?.render(
        <SessionDiffPanel
          state="ready"
          status={status}
          diff={null}
          selectedPath="src/app.tsx"
          onSelectFile={noop}
        />,
      );
    });

    expect(container?.textContent).toContain("Loading diff…");
    expect(container?.textContent).not.toContain(
      "Select a changed file to inspect its diff.",
    );
  });

  it("renders an error message when inspection fails", () => {
    flushSync(() => {
      root?.render(
        <SessionDiffPanel
          state="error"
          status={null}
          diff={null}
          selectedPath={null}
          errorMessage="Failed to load changes"
          onSelectFile={noop}
        />,
      );
    });

    expect(container?.textContent).toContain("Failed to load changes");
  });

  it("renders preview mode with file content", () => {
    const status: WorkspaceStatus = {
      branch: "feature/atelier",
      changedFiles: [{ path: "src/app.tsx", status: "modified" }],
      isGitRepo: true,
      totalChanged: 1,
      worktreeLabel: "atelier",
    };
    const preview: WorkspaceFileContent = {
      filePath: "src/app.tsx",
      content: "export const App = () => null;\n",
      exists: true,
      isBinary: false,
      tooLarge: false,
    };

    flushSync(() => {
      root?.render(
        <SessionDiffPanel
          state="ready"
          status={status}
          diff={null}
          preview={preview}
          mode="preview"
          selectedPath="src/app.tsx"
          onSelectFile={noop}
          onModeChange={vi.fn()}
        />,
      );
    });

    expect(container?.textContent).toContain("Preview");
    expect(container?.textContent).toContain("export const App = () => null;");
  });

  it("renders preview loading copy while preview is pending", () => {
    const status: WorkspaceStatus = {
      branch: "feature/atelier",
      changedFiles: [{ path: "src/app.tsx", status: "modified" }],
      isGitRepo: true,
      totalChanged: 1,
      worktreeLabel: "atelier",
    };

    flushSync(() => {
      root?.render(
        <SessionDiffPanel
          state="ready"
          status={status}
          diff={null}
          preview={null}
          mode="preview"
          selectedPath="src/app.tsx"
          onSelectFile={noop}
          onModeChange={vi.fn()}
        />,
      );
    });

    expect(container?.textContent).toContain("Loading preview…");
  });

  it("renders neutral preview states for binary and oversized files", () => {
    const status: WorkspaceStatus = {
      branch: "feature/atelier",
      changedFiles: [{ path: "assets/logo.png", status: "modified" }],
      isGitRepo: true,
      totalChanged: 1,
      worktreeLabel: "atelier",
    };
    const binaryPreview: WorkspaceFileContent = {
      filePath: "assets/logo.png",
      content: "",
      exists: true,
      isBinary: true,
      tooLarge: false,
    };
    const largePreview: WorkspaceFileContent = {
      filePath: "assets/logo.png",
      content: "",
      exists: true,
      isBinary: false,
      tooLarge: true,
    };

    flushSync(() => {
      root?.render(
        <SessionDiffPanel
          state="ready"
          status={status}
          diff={null}
          preview={binaryPreview}
          mode="preview"
          selectedPath="assets/logo.png"
          onSelectFile={noop}
          onModeChange={vi.fn()}
        />,
      );
    });

    expect(container?.textContent).toContain(
      "Preview unavailable for this file type.",
    );

    flushSync(() => {
      root?.render(
        <SessionDiffPanel
          state="ready"
          status={status}
          diff={null}
          preview={largePreview}
          mode="preview"
          selectedPath="assets/logo.png"
          onSelectFile={noop}
          onModeChange={vi.fn()}
        />,
      );
    });

    expect(container?.textContent).toContain("Preview too large to display.");
  });
});
