import { beforeEach, describe, expect, it, vi } from "vitest";

const workspaceMocks = vi.hoisted(() => ({
  getWorkspaceDiff: vi.fn(),
  getWorkspaceStatus: vi.fn(),
  getWorkspaceFileContent: vi.fn(),
}));

vi.mock("./workspace", () => ({
  getWorkspaceDiff: workspaceMocks.getWorkspaceDiff,
  getWorkspaceStatus: workspaceMocks.getWorkspaceStatus,
  getWorkspaceFileContent: workspaceMocks.getWorkspaceFileContent,
}));

describe("atelierClient.workspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards getStatus by project path", async () => {
    const { atelierClient } = await import("./atelier-client");

    workspaceMocks.getWorkspaceStatus.mockResolvedValue({
      branch: "feature/atelier",
      changedFiles: [],
      isGitRepo: true,
      totalChanged: 0,
      worktreeLabel: "atelier",
    });

    const result = await atelierClient.workspace.getStatus("/tmp/project");

    expect(workspaceMocks.getWorkspaceStatus).toHaveBeenCalledWith(
      "/tmp/project",
    );
    expect(result.branch).toBe("feature/atelier");
  });

  it("returns a neutral payload for non-git workspaces", async () => {
    const { atelierClient } = await import("./atelier-client");

    const payload = {
      branch: null,
      changedFiles: [],
      isGitRepo: false,
      totalChanged: 0,
      worktreeLabel: null,
    };

    workspaceMocks.getWorkspaceStatus.mockResolvedValue(payload);

    await expect(
      atelierClient.workspace.getStatus("/tmp/plain-folder"),
    ).resolves.toEqual(payload);
  });

  it("returns branch, changed count, and file statuses for git workspaces", async () => {
    const { atelierClient } = await import("./atelier-client");

    const payload = {
      branch: "feature/atelier",
      changedFiles: [
        { path: "src/app.tsx", status: "modified" as const },
        { path: "README.md", status: "added" as const },
      ],
      isGitRepo: true,
      totalChanged: 2,
      worktreeLabel: "atelier",
    };

    workspaceMocks.getWorkspaceStatus.mockResolvedValue(payload);

    await expect(
      atelierClient.workspace.getStatus("/tmp/project"),
    ).resolves.toEqual(payload);
  });

  it("forwards getDiff with project and file path", async () => {
    const { atelierClient } = await import("./atelier-client");

    workspaceMocks.getWorkspaceDiff.mockResolvedValue({
      filePath: "src/app.tsx",
      isGitRepo: true,
      status: "modified",
      unifiedDiff: "@@ -1 +1 @@",
    });

    const result = await atelierClient.workspace.getDiff(
      "/tmp/project",
      "src/app.tsx",
    );

    expect(workspaceMocks.getWorkspaceDiff).toHaveBeenCalledWith(
      "/tmp/project",
      "src/app.tsx",
    );
    expect(result.filePath).toBe("src/app.tsx");
  });

  it("returns a unified diff for the selected file path", async () => {
    const { atelierClient } = await import("./atelier-client");

    const payload = {
      filePath: "src/app.tsx",
      isGitRepo: true,
      status: "modified" as const,
      unifiedDiff: [
        "diff --git a/src/app.tsx b/src/app.tsx",
        "@@ -1 +1 @@",
        "-old line",
        "+new line",
      ].join("\n"),
    };

    workspaceMocks.getWorkspaceDiff.mockResolvedValue(payload);

    await expect(
      atelierClient.workspace.getDiff("/tmp/project", "src/app.tsx"),
    ).resolves.toEqual(payload);
  });

  it("preserves payload shapes without component mapping", async () => {
    const { atelierClient } = await import("./atelier-client");

    const statusPayload = {
      branch: "feature/atelier",
      changedFiles: [{ path: "README.md", status: "added" as const }],
      isGitRepo: true,
      totalChanged: 1,
      worktreeLabel: "atelier",
    };
    const diffPayload = {
      filePath: "README.md",
      isGitRepo: true,
      status: "added" as const,
      unifiedDiff: "+hello\n",
    };

    workspaceMocks.getWorkspaceStatus.mockResolvedValue(statusPayload);
    workspaceMocks.getWorkspaceDiff.mockResolvedValue(diffPayload);

    await expect(
      atelierClient.workspace.getStatus("/tmp/project"),
    ).resolves.toEqual(statusPayload);
    await expect(
      atelierClient.workspace.getDiff("/tmp/project", "README.md"),
    ).resolves.toEqual(diffPayload);
  });

  it("forwards getFileContent by project and file path", async () => {
    const { atelierClient } = await import("./atelier-client");

    workspaceMocks.getWorkspaceFileContent.mockResolvedValue({
      filePath: "src/app.tsx",
      content: "export const App = () => null;",
      exists: true,
      isBinary: false,
      tooLarge: false,
    });

    const result = await atelierClient.workspace.getFileContent(
      "/tmp/project",
      "src/app.tsx",
    );

    expect(workspaceMocks.getWorkspaceFileContent).toHaveBeenCalledWith(
      "/tmp/project",
      "src/app.tsx",
    );
    expect(result.content).toContain("App");
  });

  it("returns raw preview payload shape without component-specific mapping", async () => {
    const { atelierClient } = await import("./atelier-client");

    const payload = {
      filePath: "src/app.tsx",
      content: "export const App = () => null;\n",
      exists: true,
      isBinary: false,
      tooLarge: false,
    };

    workspaceMocks.getWorkspaceFileContent.mockResolvedValue(payload);

    await expect(
      atelierClient.workspace.getFileContent("/tmp/project", "src/app.tsx"),
    ).resolves.toEqual(payload);
  });

  it("preserves neutral preview states for missing, binary, and oversized files", async () => {
    const { atelierClient } = await import("./atelier-client");

    const payloads = [
      {
        filePath: "missing.txt",
        content: "",
        exists: false,
        isBinary: false,
        tooLarge: false,
      },
      {
        filePath: "assets/logo.png",
        content: "",
        exists: true,
        isBinary: true,
        tooLarge: false,
      },
      {
        filePath: "logs/big.txt",
        content: "",
        exists: true,
        isBinary: false,
        tooLarge: true,
      },
    ];

    workspaceMocks.getWorkspaceFileContent
      .mockResolvedValueOnce(payloads[0])
      .mockResolvedValueOnce(payloads[1])
      .mockResolvedValueOnce(payloads[2]);

    await expect(
      atelierClient.workspace.getFileContent("/tmp/project", "missing.txt"),
    ).resolves.toEqual(payloads[0]);
    await expect(
      atelierClient.workspace.getFileContent("/tmp/project", "assets/logo.png"),
    ).resolves.toEqual(payloads[1]);
    await expect(
      atelierClient.workspace.getFileContent("/tmp/project", "logs/big.txt"),
    ).resolves.toEqual(payloads[2]);
  });
});
