// @vitest-environment jsdom

import type { Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { WorkbenchStatusBar } from "./workbench-status-bar";

describe("WorkbenchStatusBar", () => {
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

  it("renders branch and changed count", () => {
    flushSync(() => {
      root?.render(
        <WorkbenchStatusBar
          state="ready"
          status={{
            branch: "feature/atelier",
            changedFiles: [{ path: "src/app.tsx", status: "modified" }],
            isGitRepo: true,
            totalChanged: 1,
            worktreeLabel: "atelier",
          }}
        />,
      );
    });

    expect(container?.textContent).toContain("feature/atelier");
    expect(container?.textContent).toContain("1 changed");
  });

  it("renders a neutral state for non-git workspaces", () => {
    flushSync(() => {
      root?.render(
        <WorkbenchStatusBar
          state="ready"
          status={{
            branch: null,
            changedFiles: [],
            isGitRepo: false,
            totalChanged: 0,
            worktreeLabel: null,
          }}
        />,
      );
    });

    expect(container?.textContent).toContain("No git workspace");
  });

  it("renders loading state without breaking layout", () => {
    flushSync(() => {
      root?.render(<WorkbenchStatusBar state="loading" status={null} />);
    });

    expect(
      container?.querySelector('[data-testid="workbench-status-bar"]'),
    ).not.toBeNull();
    expect(container?.textContent).toContain("Loading workspace…");
  });

  it("renders error state without breaking layout", () => {
    flushSync(() => {
      root?.render(<WorkbenchStatusBar state="error" status={null} />);
    });

    expect(
      container?.querySelector('[data-testid="workbench-status-bar"]'),
    ).not.toBeNull();
    expect(container?.textContent).toContain("Workspace unavailable");
  });
});
