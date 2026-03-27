import type { WorkspaceConnectionState } from "./session-workspace-state";

export function buildHistoryLoadErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return `Failed to load session history: ${error.message}`;
  }

  return "Failed to load session history.";
}

export function buildSessionCwdLoadErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return `Failed to load session directory metadata: ${error.message}`;
  }

  return "Failed to load session directory metadata.";
}

export function buildMissingSessionDirectoryMessage(): string {
  return "Failed to determine the session directory.";
}

export function shouldResumeSessionWithFallbackCwd(
  isExistingSession: boolean,
  fallbackCwd: string,
  didLoadSessionCwd: boolean,
): boolean {
  if (!fallbackCwd.trim()) {
    return false;
  }

  if (!isExistingSession) {
    return true;
  }

  return didLoadSessionCwd;
}

export function shouldIgnoreExportPreparationError(error: unknown): boolean {
  return (
    error instanceof Error && /no such file or directory/i.test(error.message)
  );
}

export function buildStreamEventErrorMessage(
  error: string | undefined,
): string {
  if (error) {
    return `Studio stream error: ${error}`;
  }

  return "Studio stream error.";
}

export function shouldIgnoreSessionStopError(error: unknown): boolean {
  return error instanceof Error && /session not active/i.test(error.message);
}

export function buildSessionStopErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return `Failed to stop active session: ${error.message}`;
  }

  return "Failed to stop active session.";
}

export function getSessionStopToastMessage(error: unknown): string | null {
  if (shouldIgnoreSessionStopError(error)) {
    return null;
  }

  return buildSessionStopErrorMessage(error);
}

export function buildLifecycleStatusLabel(
  connection: WorkspaceConnectionState,
): string {
  if (connection === "connecting") {
    return "Connecting";
  }

  if (connection === "streaming") {
    return "Responding";
  }

  if (connection === "error") {
    return "Error";
  }

  if (connection === "stopped") {
    return "Disconnected";
  }

  return "Ready";
}

const defaultComposerPlaceholder =
  "Message Claude... (Enter to send, Shift+Enter for newline)";

export function buildComposerPlaceholder(
  connection: WorkspaceConnectionState,
  canSend: boolean,
): string {
  if (canSend) {
    return defaultComposerPlaceholder;
  }

  if (connection === "connecting") {
    return "Connecting to session…";
  }

  if (connection === "error" || connection === "stopped") {
    return "Session unavailable. Reopen or start a new session.";
  }

  return defaultComposerPlaceholder;
}

export function formatSystemStatusMessage(status: string): string {
  if (status === "compacting") {
    return "Preparing session handoff…";
  }

  if (status.startsWith("Exported")) {
    return `Handoff ready: ${status}`;
  }

  return `Session status: ${status}`;
}

export function formatRuntimeCostLabel(costUsd: number | null): string | null {
  if (typeof costUsd !== "number") {
    return null;
  }

  return `$${costUsd.toFixed(2)}`;
}
