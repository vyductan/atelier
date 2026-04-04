interface ResponseLike {
  ok: boolean;
  status: number;
  statusText: string;
  json?: () => Promise<unknown>;
}

function readStudioErrorMessage(body: unknown): string | null {
  if (
    body &&
    typeof body === "object" &&
    "error" in body &&
    typeof (body as { error?: unknown }).error === "string"
  ) {
    const error = (body as { error: string }).error.trim();
    return error || null;
  }

  return null;
}

export async function assertStudioResponseOk(
  response: ResponseLike,
): Promise<void> {
  if (response.ok) {
    return;
  }

  if (response.json) {
    try {
      const body = await response.json();
      const message = readStudioErrorMessage(body);
      if (message) {
        throw new Error(message);
      }
    } catch (error) {
      if (
        error instanceof Error &&
        error.message &&
        !(error instanceof SyntaxError)
      ) {
        throw error;
      }
    }
  }

  const suffix = response.statusText ? ` ${response.statusText}` : "";
  throw new Error(
    `Studio request failed with HTTP ${response.status}${suffix}`,
  );
}

export function shouldAllowSessionInput(
  _isConnected: boolean,
  isLoading: boolean,
  sessionId: string,
): boolean {
  return _isConnected && !isLoading && sessionId.trim().length > 0;
}

export function buildStudioRequestError(
  action: string,
  error: unknown,
): string {
  if (error instanceof Error && error.message) {
    return `Failed to ${action}: ${error.message}`;
  }

  return `Failed to ${action}.`;
}
