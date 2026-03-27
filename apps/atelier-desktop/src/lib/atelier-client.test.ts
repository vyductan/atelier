import { describe, expect, it, vi } from "vitest";

const tauriMocks = vi.hoisted(() => ({
  exportSession: vi.fn(),
  exportSessionToCodex: vi.fn(),
  getSessionCwd: vi.fn(),
  moveToTrash: vi.fn(),
  readSessionMessages: vi.fn(),
  renameSession: vi.fn(),
}));

const studioMocks = vi.hoisted(() => ({
  sendSessionMessage: vi.fn(),
  startActiveSessionStream: vi.fn(),
  stopActiveSession: vi.fn(),
}));

vi.mock("./tauri", () => ({
  exportSession: tauriMocks.exportSession,
  exportSessionToCodex: tauriMocks.exportSessionToCodex,
  getSessionCwd: tauriMocks.getSessionCwd,
  moveToTrash: tauriMocks.moveToTrash,
  readSessionMessages: tauriMocks.readSessionMessages,
  renameSession: tauriMocks.renameSession,
}));

vi.mock("./studio", () => ({
  sendSessionMessage: studioMocks.sendSessionMessage,
  startActiveSessionStream: studioMocks.startActiveSessionStream,
  stopActiveSession: studioMocks.stopActiveSession,
}));

describe("atelierClient", () => {
  it("forwards session operations through the grouped facade", async () => {
    const { atelierClient } = await import("./atelier-client");

    await atelierClient.sessions.readHistory("/tmp/session.jsonl");
    await atelierClient.sessions.getCwd("/tmp/session.jsonl");
    await atelierClient.sessions.rename("/tmp/session.jsonl", "New title");

    expect(tauriMocks.readSessionMessages).toHaveBeenCalledWith(
      "/tmp/session.jsonl",
    );
    expect(tauriMocks.getSessionCwd).toHaveBeenCalledWith("/tmp/session.jsonl");
    expect(tauriMocks.renameSession).toHaveBeenCalledWith(
      "/tmp/session.jsonl",
      "New title",
    );
  });

  it("forwards runtime operations through the grouped facade", async () => {
    const { atelierClient } = await import("./atelier-client");
    const onEvent = vi.fn();
    const onDone = vi.fn();

    await atelierClient.runtime.start({
      sessionId: "session-123",
      projectPath: "/tmp/project",
      firstPrompt: "Hello",
      resolvedModel: "claude-opus-4-6[1m]",
      onEvent,
      onDone,
    });
    await atelierClient.runtime.send("session-123", "Continue");
    await atelierClient.runtime.stop("session-123");

    expect(studioMocks.startActiveSessionStream).toHaveBeenCalledWith(
      "session-123",
      "/tmp/project",
      "Hello",
      onEvent,
      onDone,
      undefined,
      "claude-opus-4-6[1m]",
    );
    expect(studioMocks.sendSessionMessage).toHaveBeenCalledWith(
      "session-123",
      "Continue",
    );
    expect(studioMocks.stopActiveSession).toHaveBeenCalledWith("session-123");
  });

  it("forwards resume session ids without adding a resolved model", async () => {
    const { atelierClient } = await import("./atelier-client");
    const onEvent = vi.fn();
    const onDone = vi.fn();

    await atelierClient.runtime.start({
      sessionId: "session-456",
      projectPath: "/tmp/project",
      firstPrompt: undefined,
      onEvent,
      onDone,
      resumeSessionId: "resume-123",
    });

    expect(studioMocks.startActiveSessionStream).toHaveBeenCalledWith(
      "session-456",
      "/tmp/project",
      undefined,
      onEvent,
      onDone,
      "resume-123",
      undefined,
    );
  });

  it("forwards export operations through the grouped facade", async () => {
    const { atelierClient } = await import("./atelier-client");

    await atelierClient.exports.session("/tmp/session.jsonl", "/tmp/out.txt");
    await atelierClient.exports.codex("/tmp/session.jsonl");
    await atelierClient.exports.preparePath("/tmp/out.txt");

    expect(tauriMocks.exportSession).toHaveBeenCalledWith(
      "/tmp/session.jsonl",
      "/tmp/out.txt",
    );
    expect(tauriMocks.exportSessionToCodex).toHaveBeenCalledWith(
      "/tmp/session.jsonl",
    );
    expect(tauriMocks.moveToTrash).toHaveBeenCalledWith("/tmp/out.txt");
  });
});
