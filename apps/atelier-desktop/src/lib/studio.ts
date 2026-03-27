import { assertStudioResponseOk } from "./studio-request-state";
import {
  buildStreamConnectionError,
  parseStreamEventData,
} from "./studio-stream-state";

const STUDIO_BASE = "http://127.0.0.1:3131";

export interface StreamJsonEvent {
  type: string;
  subtype?: string;
  status?: string;
  message?: {
    role: string;
    content: Array<{ type: string; text?: string }> | string;
  };
  error?: string;
  cost_usd?: number;
  session_id?: string;
  result?: Record<string, unknown>;
}

/**
 * Start active session — streams SSE events via fetch (POST body).
 * Returns a cancel function.
 */
export async function startActiveSessionStream(
  sessionId: string | undefined,
  projectPath: string,
  firstPrompt: string | undefined,
  onEvent: (event: StreamJsonEvent) => void,
  onDone: () => void,
  resumeSessionId?: string,
  resolvedModel?: string,
): Promise<() => void> {
  const controller = new AbortController();

  fetch(`${STUDIO_BASE}/session/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId,
      projectPath,
      firstPrompt,
      resumeSessionId,
      resolvedModel,
    }),
    signal: controller.signal,
  })
    .then(async (res) => {
      if (!res.ok) {
        onEvent({
          type: "error",
          error: `Studio stream failed with HTTP ${res.status}`,
        });
        onDone();
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        onEvent({
          type: "error",
          error: "Studio stream did not return a body",
        });
        onDone();
        return;
      }
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim();
            if (!data) continue;
            const parsed = parseStreamEventData(data);
            if (!parsed.ok) {
              onEvent({ type: "error", error: parsed.error });
              continue;
            }
            if (parsed.event.type === "done") {
              onEvent(parsed.event);
              onDone();
              return;
            }
            onEvent(parsed.event);
          }
        }
      }
      onDone();
    })
    .catch((error) => {
      if (error instanceof Error && error.name === "AbortError") {
        onDone();
        return;
      }

      onEvent(buildStreamConnectionError(error));
      onDone();
    });

  return () => controller.abort();
}

export async function sendSessionMessage(
  sessionId: string,
  message: string,
): Promise<void> {
  const response = await fetch(`${STUDIO_BASE}/session/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, message }),
  });

  await assertStudioResponseOk(response);
}

export async function stopActiveSession(sessionId: string): Promise<void> {
  const response = await fetch(`${STUDIO_BASE}/session/stop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });

  await assertStudioResponseOk(response);
}

export {
  buildStudioRequestError,
  shouldAllowSessionInput,
} from "./studio-request-state";
