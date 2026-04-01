import type { StreamJsonEvent } from "./studio";

export type NormalizedStudioEvent =
  | { type: "session-connected"; sessionId: string }
  | { type: "session-status"; status: string }
  | { type: "assistant-delta"; text: string }
  | {
      type: "operation-finished";
      subtype?: string;
      status?: string;
      costUsd?: number;
      result?: Record<string, unknown>;
    }
  | { type: "runtime-error"; error: string }
  | { type: "session-finished" };

function extractAssistantText(event: StreamJsonEvent): string {
  const content = event.message?.content;

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .filter(
        (item): item is { type: string; text?: string } =>
          typeof item === "object" &&
          item !== null &&
          "type" in item &&
          item.type === "text",
      )
      .map((item) => item.text ?? "")
      .join("");
  }

  return "";
}

export function extractStudioStatus(event: StreamJsonEvent): string | null {
  const candidate = (event as StreamJsonEvent & { status?: unknown }).status;

  return typeof candidate === "string" && candidate.length > 0
    ? candidate
    : null;
}

export function normalizeStudioEvent(
  event: StreamJsonEvent,
): NormalizedStudioEvent | null {
  if (event.type === "system" && event.subtype === "status") {
    const status = extractStudioStatus(event);

    if (!status) {
      return null;
    }

    return { type: "session-status", status };
  }

  if (event.type === "system" && event.session_id) {
    return { type: "session-connected", sessionId: event.session_id };
  }

  if (event.type === "assistant") {
    const text = extractAssistantText(event);

    if (!text) {
      return null;
    }

    return { type: "assistant-delta", text };
  }

  if (event.type === "error" || event.type === "runtime.error") {
    let errorMsg = "Unknown runtime error";
    if (typeof event.error === "string") {
      errorMsg = event.error;
    } else if (event.error && typeof event.error === "object") {
      errorMsg = (event.error as { message?: string }).message ?? JSON.stringify(event.error);
    }

    return {
      type: "runtime-error",
      error: errorMsg,
    };
  }

  if (event.type === "result") {
    return {
      type: "operation-finished",
      ...(event.subtype ? { subtype: event.subtype } : {}),
      ...(event.status ? { status: event.status } : {}),
      ...(typeof event.cost_usd === "number"
        ? { costUsd: event.cost_usd }
        : {}),
      ...(event.result ? { result: event.result } : {}),
    };
  }

  if (event.type === "done" || event.type === "turn.completed" || event.type === "turn_completed") {
    return { type: "session-finished" };
  }

  return null;
}
