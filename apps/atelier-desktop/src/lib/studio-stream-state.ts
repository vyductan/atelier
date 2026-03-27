import type { StreamJsonEvent } from "./studio";

export type ParsedStreamEventResult =
  | { ok: true; event: StreamJsonEvent }
  | { ok: false; error: string };

export function parseStreamEventData(data: string): ParsedStreamEventResult {
  try {
    return {
      ok: true,
      event: JSON.parse(data) as StreamJsonEvent,
    };
  } catch {
    return {
      ok: false,
      error: `Invalid stream event payload: ${data}`,
    };
  }
}

export function buildStreamConnectionError(error: unknown): StreamJsonEvent {
  if (error instanceof Error && error.message) {
    return { type: "error", error: error.message };
  }

  return { type: "error", error: "Failed to connect to studio stream" };
}
