import type { NormalizedStudioEvent } from "../lib/studio-events";

export type WorkspaceEvent =
  | NormalizedStudioEvent
  | { type: "session-connecting" }
  | { type: "user-message"; text: string };

export type WorkspaceConnectionState =
  | "idle"
  | "connecting"
  | "connected"
  | "streaming"
  | "error"
  | "stopped";

export type WorkspaceTimelineItem =
  | { kind: "assistant"; text: string; isStreaming: boolean }
  | { kind: "user"; text: string }
  | { kind: "system-status"; status: string }
  | {
      kind: "operation";
      subtype?: string;
      status?: string;
      costUsd?: number;
      result?: Record<string, unknown>;
    };

export interface WorkspaceState {
  connection: WorkspaceConnectionState;
  sessionId: string | null;
  timeline: WorkspaceTimelineItem[];
  error: string | null;
}

export function createInitialWorkspaceState(): WorkspaceState {
  return {
    connection: "idle",
    sessionId: null,
    timeline: [],
    error: null,
  };
}

export function reduceWorkspaceEvent(
  state: WorkspaceState,
  event: WorkspaceEvent,
): WorkspaceState {
  if (event.type === "session-connecting") {
    return {
      ...state,
      connection: "connecting",
      error: null,
    };
  }

  if (event.type === "session-connected") {
    return {
      ...state,
      connection: "connected",
      sessionId: event.sessionId,
      error: null,
    };
  }

  if (event.type === "user-message") {
    return {
      ...state,
      timeline: [...state.timeline, { kind: "user", text: event.text }],
    };
  }

  if (event.type === "assistant-delta") {
    const lastItem = state.timeline.at(-1);

    if (lastItem?.kind === "assistant" && lastItem.isStreaming) {
      return {
        ...state,
        connection: "streaming",
        timeline: [
          ...state.timeline.slice(0, -1),
          {
            ...lastItem,
            text: `${lastItem.text}${event.text}`,
          },
        ],
      };
    }

    return {
      ...state,
      connection: "streaming",
      timeline: [
        ...state.timeline,
        {
          kind: "assistant",
          text: event.text,
          isStreaming: true,
        },
      ],
    };
  }

  if (event.type === "session-status") {
    const lastItem = state.timeline.at(-1);

    if (lastItem?.kind === "system-status") {
      return {
        ...state,
        timeline: [
          ...state.timeline.slice(0, -1),
          { kind: "system-status", status: event.status },
        ],
      };
    }

    return {
      ...state,
      timeline: [
        ...state.timeline,
        { kind: "system-status", status: event.status },
      ],
    };
  }

  if (event.type === "operation-finished") {
    return {
      ...state,
      connection: "connected",
      timeline: [
        ...finalizeTimeline(state.timeline),
        {
          kind: "operation",
          ...(event.subtype ? { subtype: event.subtype } : {}),
          ...(event.status ? { status: event.status } : {}),
          ...(typeof event.costUsd === "number"
            ? { costUsd: event.costUsd }
            : {}),
          ...(event.result ? { result: event.result } : {}),
        },
      ],
    };
  }

  if (event.type === "runtime-error") {
    return {
      ...state,
      connection: "error",
      error: event.error,
      timeline: finalizeTimeline(state.timeline),
    };
  }

  if (event.type === "session-finished") {
    return {
      ...state,
      connection: "stopped",
      timeline: finalizeTimeline(state.timeline),
    };
  }

  return state;
}

function finalizeTimeline(
  timeline: WorkspaceTimelineItem[],
): WorkspaceTimelineItem[] {
  return timeline.map((item) => {
    if (item.kind !== "assistant") {
      return item;
    }

    return {
      ...item,
      isStreaming: false,
    };
  });
}
