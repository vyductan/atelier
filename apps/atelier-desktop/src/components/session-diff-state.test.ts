import { describe, expect, it } from "vitest";

import type {
  WorkspaceFileContent,
  WorkspaceStatusFile,
} from "../lib/workspace";
import {
  buildSessionDiffEmptyStateMessage,
  buildSessionPreviewMessage,
  formatWorkspaceFileStatus,
  getDefaultSessionInspectionMode,
  mapWorkspaceFilesToDiffItems,
  reconcileSelectedDiffFile,
} from "./session-diff-state";

const workspaceFiles: WorkspaceStatusFile[] = [
  { path: "src/app.tsx", status: "modified" },
  { path: "src/new-file.ts", status: "added" },
  { path: "docs/old-plan.md", status: "deleted" },
  { path: "src/renamed.ts", status: "renamed" },
  { path: "scratch/notes.md", status: "untracked" },
];

describe("mapWorkspaceFilesToDiffItems", () => {
  it("maps raw workspace files to render items with readable labels", () => {
    expect(mapWorkspaceFilesToDiffItems(workspaceFiles)).toEqual([
      {
        path: "src/app.tsx",
        fileName: "app.tsx",
        directory: "src",
        status: "modified",
        statusLabel: "Modified",
      },
      {
        path: "src/new-file.ts",
        fileName: "new-file.ts",
        directory: "src",
        status: "added",
        statusLabel: "Added",
      },
      {
        path: "docs/old-plan.md",
        fileName: "old-plan.md",
        directory: "docs",
        status: "deleted",
        statusLabel: "Deleted",
      },
      {
        path: "src/renamed.ts",
        fileName: "renamed.ts",
        directory: "src",
        status: "renamed",
        statusLabel: "Renamed",
      },
      {
        path: "scratch/notes.md",
        fileName: "notes.md",
        directory: "scratch",
        status: "untracked",
        statusLabel: "Untracked",
      },
    ]);
  });

  it("uses a neutral directory label for root-level files", () => {
    expect(
      mapWorkspaceFilesToDiffItems([{ path: "README.md", status: "modified" }]),
    ).toEqual([
      {
        path: "README.md",
        fileName: "README.md",
        directory: ".",
        status: "modified",
        statusLabel: "Modified",
      },
    ]);
  });
});

describe("reconcileSelectedDiffFile", () => {
  it("keeps the current selection when the file still exists", () => {
    expect(reconcileSelectedDiffFile("src/new-file.ts", workspaceFiles)).toBe(
      "src/new-file.ts",
    );
  });

  it("falls back to the first changed file when the current selection disappears", () => {
    expect(reconcileSelectedDiffFile("src/missing.ts", workspaceFiles)).toBe(
      "src/app.tsx",
    );
  });

  it("returns null when there are no files to inspect", () => {
    expect(reconcileSelectedDiffFile("src/missing.ts", [])).toBeNull();
  });
});

describe("buildSessionDiffEmptyStateMessage", () => {
  it("returns the non-git empty state message", () => {
    expect(buildSessionDiffEmptyStateMessage(false, [])).toBe(
      "No git workspace available.",
    );
  });

  it("returns the clean workspace empty state message", () => {
    expect(buildSessionDiffEmptyStateMessage(true, [])).toBe(
      "No changed files in this workspace.",
    );
  });
});

describe("formatWorkspaceFileStatus", () => {
  it("formats each workspace status into a badge label", () => {
    expect(formatWorkspaceFileStatus("modified")).toBe("Modified");
    expect(formatWorkspaceFileStatus("added")).toBe("Added");
    expect(formatWorkspaceFileStatus("deleted")).toBe("Deleted");
    expect(formatWorkspaceFileStatus("renamed")).toBe("Renamed");
    expect(formatWorkspaceFileStatus("untracked")).toBe("Untracked");
  });
});

describe("getDefaultSessionInspectionMode", () => {
  it("defaults inspection mode to diff", () => {
    expect(getDefaultSessionInspectionMode()).toBe("diff");
  });
});

describe("buildSessionPreviewMessage", () => {
  it("returns a loading message when preview is pending", () => {
    expect(buildSessionPreviewMessage(null)).toBe("Loading preview…");
  });

  it("returns a missing-file preview message", () => {
    const preview: WorkspaceFileContent = {
      filePath: "src/missing.ts",
      content: "",
      exists: false,
      isBinary: false,
      tooLarge: false,
    };

    expect(buildSessionPreviewMessage(preview)).toBe(
      "File is no longer available.",
    );
  });

  it("returns a binary preview message", () => {
    const preview: WorkspaceFileContent = {
      filePath: "assets/logo.png",
      content: "",
      exists: true,
      isBinary: true,
      tooLarge: false,
    };

    expect(buildSessionPreviewMessage(preview)).toBe(
      "Preview unavailable for this file type.",
    );
  });

  it("returns an oversized preview message", () => {
    const preview: WorkspaceFileContent = {
      filePath: "logs/big.txt",
      content: "",
      exists: true,
      isBinary: false,
      tooLarge: true,
    };

    expect(buildSessionPreviewMessage(preview)).toBe(
      "Preview too large to display.",
    );
  });

  it("returns null when preview content is displayable", () => {
    const preview: WorkspaceFileContent = {
      filePath: "src/app.tsx",
      content: "export const App = () => null;\n",
      exists: true,
      isBinary: false,
      tooLarge: false,
    };

    expect(buildSessionPreviewMessage(preview)).toBeNull();
  });
});
