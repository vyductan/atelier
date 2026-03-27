export type RenameAttemptResult = { ok: true } | { ok: false; error: unknown };

export function shouldCloseRenameEditor(result: RenameAttemptResult): boolean {
  return result.ok;
}

export function buildRenameFailureMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return `Rename failed: ${error.message}`;
  }

  return "Rename failed.";
}
