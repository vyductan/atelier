import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ClaudeContextWindowValue } from "../lib/claude-model-capabilities";
import type { StreamJsonEvent } from "../lib/studio";
import type { SessionEntry } from "../lib/types";
import type { SessionDiffPanelState } from "./session-diff-panel";
import type { SessionInspectionMode } from "./session-diff-state";
import type { SessionTranscriptMessage } from "./session-transcript";
import { atelierClient } from "../lib/atelier-client";
import {
  getClaudeModelCapability,
  getDefaultClaudeContextWindow,
} from "../lib/claude-model-capabilities";
import {
  formatClaudeModelString,
  parseClaudeModelString,
} from "../lib/claude-model-config";
import {
  buildStudioRequestError,
  shouldAllowSessionInput,
} from "../lib/studio";
import {
  readGlobalClaudeConfig,
  updateSessionModelMetadata,
} from "../lib/tauri";
import { normalizeStudioEvent } from "../lib/studio-events";
import { useSessionStore } from "../store/session-store";
import { useToastStore } from "../store/toast-store";
import {
  buildComposerPlaceholder,
  buildHistoryLoadErrorMessage,
  buildLifecycleStatusLabel,
  buildMissingSessionDirectoryMessage,
  buildSessionCwdLoadErrorMessage,
  buildStreamEventErrorMessage,
  formatRuntimeCostLabel,
  formatSystemStatusMessage,
  getSessionStopToastMessage,
  shouldIgnoreExportPreparationError,
  shouldResumeSessionWithFallbackCwd,
} from "./active-session-panel-state";
import { SessionComposer } from "./session-composer";
import { SessionDiffPanel } from "./session-diff-panel";
import {
  getDefaultSessionInspectionMode,
  reconcileSelectedDiffFile,
} from "./session-diff-state";
import { SessionErrorBanner } from "./session-error-banner";
import { SessionHeader } from "./session-header";
import { SessionTranscript } from "./session-transcript";
import { SessionContextWindowSelector } from "./session-context-window-selector";
import {
  createInitialWorkspaceState,
  reduceWorkspaceEvent,
} from "./session-workspace-state";
import type { WorkspaceConnectionState } from "./session-workspace-state";

function createPendingSessionId(): string {
  return globalThis.crypto.randomUUID();
}

function readPendingNewSessionPrompt(): string | null {
  return useSessionStore.getState().newSessionPrompt;
}

function clearPendingNewSessionPrompt(expectedPrompt: string | null): void {
  if (!expectedPrompt) {
    return;
  }

  const promptState = useSessionStore.getState();
  if (promptState.newSessionPrompt === expectedPrompt) {
    promptState.setNewSessionPrompt(null);
  }
}

interface Message {
  role: "user" | "assistant" | "system";
  text: string;
  isStreaming?: boolean;
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return (content as Array<{ type?: string; text?: string }>)
      .filter(
        (c) =>
          c.type === "text" && c.text && !c.text.trimStart().startsWith("<"),
      )
      .map((c) => c.text ?? "")
      .join("")
      .trim();
  }
  return "";
}

function resolveSessionBaseModel(
  session: SessionEntry | undefined,
  globalModel: string | null,
): string | null {
  if (session?.claudeModel) {
    return parseClaudeModelString(session.claudeModel)?.baseModel ?? null;
  }

  if (globalModel) {
    return parseClaudeModelString(globalModel)?.baseModel ?? null;
  }

  return null;
}

function resolveSessionContextWindowValue(
  session: SessionEntry | undefined,
  globalModel: string | null,
  baseModel: string | null,
): ClaudeContextWindowValue | null {
  if (session?.claudeContextWindow) {
    return session.claudeContextWindow;
  }

  if (globalModel) {
    const parsedGlobalModel = parseClaudeModelString(globalModel);
    if (parsedGlobalModel?.baseModel === baseModel) {
      return parsedGlobalModel.contextWindow;
    }
  }

  if (!baseModel) {
    return null;
  }

  return getDefaultClaudeContextWindow(baseModel);
}

function buildSessionContextWindowState(
  session: SessionEntry | undefined,
  globalModel: string | null,
): {
  baseModel: string | null;
  options: Array<{ value: ClaudeContextWindowValue; label: string; isDefault?: boolean }>;
  value: ClaudeContextWindowValue | null;
} {
  const baseModel = resolveSessionBaseModel(session, globalModel);
  const capability = baseModel ? getClaudeModelCapability(baseModel) : null;

  return {
    baseModel,
    options: capability?.options ?? [],
    value: resolveSessionContextWindowValue(session, globalModel, baseModel),
  };
}

function resolveSessionDesiredModel(
  session: SessionEntry | undefined,
  globalModel: string | null,
): string | null {
  const { baseModel, value } = buildSessionContextWindowState(session, globalModel);

  if (!baseModel || !value) {
    return null;
  }

  return formatClaudeModelString(baseModel, value);
}

function resolveRenderedSessionEscapedPath(
  session: SessionEntry | undefined,
): string | null {
  const fullPath = session?.fullPath?.replaceAll("\\", "/");

  if (!fullPath) {
    return null;
  }

  const marker = "/.claude/projects/";
  const startIndex = fullPath.indexOf(marker);

  if (startIndex === -1) {
    return null;
  }

  const projectPath = fullPath.slice(startIndex + marker.length);
  const [escapedPath] = projectPath.split("/");
  return escapedPath || null;
}

function buildTranscriptLoadingMessage(
  isLoading: boolean,
  transcriptMessageCount: number,
  connection: Exclude<WorkspaceConnectionState, "idle">,
): string | null {
  if (!isLoading || transcriptMessageCount === 0) {
    return null;
  }

  if (connection === "connecting") {
    return "Connecting to session...";
  }

  if (connection === "streaming") {
    return "Claude is working...";
  }

  return null;
}

interface ActiveSessionPanelProps {
  session?: SessionEntry;
  newSessionProject?: string;
}

export function ActiveSessionPanel({
  session,
  newSessionProject,
}: ActiveSessionPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [globalClaudeModel, setGlobalClaudeModel] = useState<string | null>(null);
  const [sessionContextWindowOverride, setSessionContextWindowOverride] =
    useState<ClaudeContextWindowValue | null>(session?.claudeContextWindow ?? null);
  const [workspaceState, setWorkspaceState] = useState(
    createInitialWorkspaceState,
  );
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [sessionMeta, setSessionMeta] = useState<string | null>(
    session?.projectPath || newSessionProject || null,
  );
  const [diffPanelState, setDiffPanelState] =
    useState<SessionDiffPanelState>("loading");
  const [diffStatus, setDiffStatus] = useState<Awaited<
    ReturnType<typeof atelierClient.workspace.getStatus>
  > | null>(null);
  const [selectedDiffPath, setSelectedDiffPath] = useState<string | null>(null);
  const [inspectionMode, setInspectionMode] = useState<SessionInspectionMode>(
    getDefaultSessionInspectionMode,
  );
  const [selectedDiff, setSelectedDiff] = useState<Awaited<
    ReturnType<typeof atelierClient.workspace.getDiff>
  > | null>(null);
  const [selectedPreview, setSelectedPreview] = useState<Awaited<
    ReturnType<typeof atelierClient.workspace.getFileContent>
  > | null>(null);
  const [diffErrorMessage, setDiffErrorMessage] = useState<string | null>(null);
  const [previewErrorMessage, setPreviewErrorMessage] = useState<string | null>(
    null,
  );
  const bottomRef = useRef<HTMLDivElement>(null);
  const sessionIdRef = useRef<string>(session?.sessionId || "");
  const pendingExportRef = useRef<{
    path: string;
    sessionId: string;
  } | null>(null);
  const resumeModelReconciledRef = useRef(false);
  const [resumeReconnectGeneration, setResumeReconnectGeneration] = useState(0);
  const addToast = useToastStore((state) => state.addToast);
  const renderedSessionEscapedPath = useMemo(
    () => resolveRenderedSessionEscapedPath(session),
    [session],
  );
  const isConnected =
    workspaceState.connection === "connected" ||
    workspaceState.connection === "streaming";
  const latestOperation = useMemo(
    () =>
      workspaceState.timeline
        .toReversed()
        .find((item) => item.kind === "operation"),
    [workspaceState.timeline],
  );
  const runtimeCostLabel = formatRuntimeCostLabel(
    latestOperation?.costUsd ?? null,
  );
  const effectiveSession = useMemo(
    () =>
      session
        ? {
            ...session,
            claudeContextWindow: sessionContextWindowOverride,
          }
        : session,
    [session, sessionContextWindowOverride],
  );
  const sessionContextWindowState = useMemo(
    () => buildSessionContextWindowState(effectiveSession, globalClaudeModel),
    [effectiveSession, globalClaudeModel],
  );
  const desiredResolvedModel = useMemo(
    () => resolveSessionDesiredModel(effectiveSession, globalClaudeModel),
    [effectiveSession, globalClaudeModel],
  );
  const transcriptMessages = useMemo<SessionTranscriptMessage[]>(
    () => [
      ...messages,
      ...workspaceState.timeline.flatMap<SessionTranscriptMessage>((item) => {
        if (item.kind === "assistant") {
          return [
            {
              role: "assistant" as const,
              text: item.text,
              isStreaming: item.isStreaming,
            },
          ];
        }

        if (item.kind === "user") {
          return [
            {
              role: "user" as const,
              text: item.text,
            },
          ];
        }

        if (item.kind === "system-status") {
          return [
            {
              role: "system" as const,
              text: formatSystemStatusMessage(item.status),
            },
          ];
        }

        return [];
      }),
    ],
    [messages, workspaceState.timeline],
  );
  const isTranscriptStreaming = transcriptMessages.some(
    (message) => message.isStreaming,
  );
  const canSend = shouldAllowSessionInput(
    isConnected,
    isLoading,
    sessionIdRef.current,
  );
  const statusLabel = buildLifecycleStatusLabel(workspaceState.connection);
  const composerPlaceholder = buildComposerPlaceholder(
    workspaceState.connection,
    canSend,
  );
  const transcriptLoadingMessage = buildTranscriptLoadingMessage(
    isLoading,
    transcriptMessages.length,
    workspaceState.connection === "idle"
      ? "connecting"
      : workspaceState.connection,
  );
  const emptyStateMessage =
    workspaceState.connection === "error" ||
    workspaceState.connection === "stopped"
      ? "Reopen or start a new session."
      : null;

  useEffect(() => {
    let cancelled = false;

    async function loadGlobalClaudeModel() {
      try {
        const raw = await readGlobalClaudeConfig();
        if (cancelled) {
          return;
        }

        const parsed = JSON.parse(raw) as { model?: unknown };
        setGlobalClaudeModel(
          typeof parsed.model === "string" ? parsed.model : null,
        );
      } catch {
        if (!cancelled) {
          setGlobalClaudeModel(null);
        }
      }
    }

    void loadGlobalClaudeModel();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setSessionContextWindowOverride(session?.claudeContextWindow ?? null);
  }, [session?.claudeContextWindow, session?.sessionId]);

  useEffect(() => {
    let cancelled = false;
    let cleanupStop: (() => void) | null = null;

    resumeModelReconciledRef.current = false;
    setResumeReconnectGeneration(0);
    sessionIdRef.current = session?.sessionId || createPendingSessionId();
    setMessages([]);
    setWorkspaceState(
      reduceWorkspaceEvent(createInitialWorkspaceState(), {
        type: "session-connecting",
      }),
    );
    setIsExporting(false);
    setSessionMeta(session?.projectPath || newSessionProject || null);
    setInspectionMode(getDefaultSessionInspectionMode());
    setSelectedPreview(null);
    setPreviewErrorMessage(null);

    async function init() {
      const fallbackCwd = session?.projectPath || newSessionProject || "";
      let cwd = fallbackCwd;
      let didLoadSessionCwd = !session?.fullPath;

      if (session?.fullPath) {
        // 1. Load history from JSONL
        try {
          const raw = await atelierClient.sessions.readHistory(
            session.fullPath,
          );
          if (cancelled) return;
          const history: Message[] = raw
            .map((m) => ({
              role: m.role as "user" | "assistant",
              text: extractText(m.content),
            }))
            .filter((m) => m.text.trim());
          setMessages(history);
        } catch (error) {
          if (cancelled) return;
          setMessages([
            {
              role: "system",
              text: buildHistoryLoadErrorMessage(error),
            },
          ]);
        }

        if (cancelled) return;

        // 2. Get actual cwd from JSONL
        try {
          const sessionCwd = await atelierClient.sessions.getCwd(
            session.fullPath,
          );
          if (sessionCwd?.trim()) {
            cwd = sessionCwd;
            didLoadSessionCwd = true;
            setSessionMeta(sessionCwd);
          }
        } catch (error) {
          if (!cancelled) {
            setMessages((current) => [
              ...current,
              {
                role: "system",
                text: buildSessionCwdLoadErrorMessage(error),
              },
            ]);
          }
        }

        if (cancelled) return;
      }

      if (
        !shouldResumeSessionWithFallbackCwd(
          Boolean(session?.fullPath),
          cwd,
          didLoadSessionCwd,
        )
      ) {
        if (session?.fullPath) {
          setMessages((current) => [
            ...current,
            { role: "system", text: buildMissingSessionDirectoryMessage() },
          ]);
        }
        setIsLoading(false);
        return;
      }

      if (!cwd) {
        setMessages((current) => [
          ...current,
          { role: "system", text: buildMissingSessionDirectoryMessage() },
        ]);
        setIsLoading(false);
        return;
      }

      const initialPrompt = readPendingNewSessionPrompt();
      let isWaitingForStartupEvent = Boolean(initialPrompt);

      // 3. Connect Claude stream (resume session)
      try {
        const stop = await atelierClient.runtime.start({
          sessionId: sessionIdRef.current,
          projectPath: cwd,
          firstPrompt: initialPrompt || undefined,
          resumeSessionId: session?.sessionId,
          onEvent: (event: StreamJsonEvent) => {
            if (cancelled) {
              return;
            }

            if (event.type === "system" && event.session_id) {
              sessionIdRef.current = event.session_id;
            }

            if (event.type === "error") {
              setIsLoading(false);
              pendingExportRef.current = null;
              const message = buildStreamEventErrorMessage(event.error);
              addToast(message, "error");
            }

            if (event.type === "result" || event.type === "done") {
              setIsLoading(false);
            }

            const normalizedEvent = normalizeStudioEvent(event);
            if (normalizedEvent) {
              if (session?.fullPath && normalizedEvent.type === "session-connected") {
                setResumeReconnectGeneration((current) => current + 1);
              }

              if (
                isWaitingForStartupEvent &&
                normalizedEvent.type !== "session-connected"
              ) {
                isWaitingForStartupEvent = false;
              }

              if (
                isWaitingForStartupEvent &&
                normalizedEvent.type === "session-connected"
              ) {
                setWorkspaceState((current) => ({
                  ...current,
                  sessionId: normalizedEvent.sessionId,
                  error: null,
                }));
              } else {
                setWorkspaceState((current) =>
                  reduceWorkspaceEvent(current, normalizedEvent),
                );
              }

              if (
                normalizedEvent.type === "assistant-delta" ||
                normalizedEvent.type === "operation-finished"
              ) {
                bottomRef.current?.scrollIntoView();
              }
            }

            if (event.type === "result" && pendingExportRef.current) {
              // Handle automatic /export after /compact finishes
              const pendingExport = pendingExportRef.current;
              if (pendingExport.sessionId !== sessionIdRef.current) {
                return;
              }

              pendingExportRef.current = null;

              const exportPath = pendingExport.path;
              const exportSessionId = pendingExport.sessionId;

              void (async () => {
                try {
                  await atelierClient.exports.preparePath(exportPath);
                } catch (error) {
                  if (cancelled) {
                    return;
                  }

                  if (!shouldIgnoreExportPreparationError(error)) {
                    addToast(
                      `Export preparation failed: ${String(error)}`,
                      "error",
                    );
                    setIsLoading(false);
                    return;
                  }
                }

                if (cancelled || sessionIdRef.current !== exportSessionId) {
                  return;
                }

                const exportCmd = `/export ${exportPath}`;
                setIsLoading(true);

                try {
                  await atelierClient.runtime.send(exportSessionId, exportCmd);
                } catch (error) {
                  if (cancelled || sessionIdRef.current !== exportSessionId) {
                    return;
                  }

                  addToast(
                    buildStudioRequestError("send session message", error),
                    "error",
                  );
                  setIsLoading(false);
                }
              })();
            }
          },
          onDone: () => {
            if (cancelled) {
              return;
            }

            setWorkspaceState((current) =>
              current.connection === "error"
                ? current
                : reduceWorkspaceEvent(current, { type: "session-finished" }),
            );
            setIsLoading(false);
          },
        });

        if (cancelled) {
          stop();
          return;
        }

        if (initialPrompt) {
          setWorkspaceState((current) =>
            reduceWorkspaceEvent(current, { type: "user-message", text: initialPrompt }),
          );
        }

        clearPendingNewSessionPrompt(initialPrompt);
        cleanupStop = stop;
        if (!initialPrompt) {
          setWorkspaceState((current) =>
            current.connection === "connecting"
              ? {
                  ...current,
                  connection: "connected",
                }
              : current,
          );
          setIsLoading(false);
        }
      } catch (error) {
        if (cancelled) {
          return;
        }

        const message = buildStudioRequestError(
          "start active session stream",
          error,
        );
        addToast(message, "error");
        setWorkspaceState((current) => ({
          ...current,
          connection: "error",
          error: message,
        }));
        setIsLoading(false);
      }
    }

    void init();

    return () => {
      cancelled = true;
      pendingExportRef.current = null;
      cleanupStop?.();
      void atelierClient.runtime.stop(sessionIdRef.current).catch((error) => {
        const toastMessage = getSessionStopToastMessage(error);
        if (!toastMessage) {
          return;
        }

        addToast(toastMessage, "error");
      });
    };
  }, [
    addToast,
    session?.sessionId,
    session?.projectPath,
    session?.fullPath,
    newSessionProject,
  ]);

  useEffect(() => {
    if (isTranscriptStreaming) {
      bottomRef.current?.scrollIntoView();
      return;
    }

    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [isTranscriptStreaming, transcriptMessages]);

  useEffect(() => {
    const projectPath = sessionMeta;

    if (!projectPath) {
      setDiffPanelState("error");
      setDiffStatus(null);
      setSelectedDiffPath(null);
      setSelectedDiff(null);
      setSelectedPreview(null);
      setDiffErrorMessage("Workspace unavailable");
      setPreviewErrorMessage(null);
      return;
    }

    let cancelled = false;
    setDiffPanelState("loading");
    setDiffStatus(null);
    setSelectedDiffPath(null);
    setSelectedDiff(null);
    setSelectedPreview(null);
    setDiffErrorMessage(null);
    setPreviewErrorMessage(null);

    void atelierClient.workspace
      .getStatus(projectPath)
      .then((status) => {
        if (cancelled) {
          return;
        }

        setDiffStatus(status);
        setSelectedDiffPath((current) =>
          reconcileSelectedDiffFile(current, status.changedFiles),
        );
        setDiffPanelState("ready");
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setDiffStatus(null);
        setSelectedDiffPath(null);
        setSelectedDiff(null);
        setSelectedPreview(null);
        setDiffPanelState("error");
        setDiffErrorMessage(String(error));
        setPreviewErrorMessage(null);
      });

    return () => {
      cancelled = true;
    };
  }, [sessionMeta]);

  useEffect(() => {
    const projectPath = sessionMeta;

    if (!projectPath || !selectedDiffPath || diffPanelState !== "ready") {
      setSelectedDiff(null);
      return;
    }

    let cancelled = false;
    setSelectedDiff(null);
    setDiffErrorMessage(null);

    void atelierClient.workspace
      .getDiff(projectPath, selectedDiffPath)
      .then((diff) => {
        if (cancelled) {
          return;
        }

        setSelectedDiff(diff);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setSelectedDiff(null);
        setDiffErrorMessage(
          error instanceof Error ? error.message : String(error),
        );
      });

    return () => {
      cancelled = true;
    };
  }, [diffPanelState, selectedDiffPath, sessionMeta]);

  useEffect(() => {
    const projectPath = sessionMeta;

    if (
      inspectionMode !== "preview" ||
      !projectPath ||
      !selectedDiffPath ||
      diffPanelState !== "ready"
    ) {
      setSelectedPreview(null);
      setPreviewErrorMessage(null);
      return;
    }

    let cancelled = false;
    setSelectedPreview(null);
    setPreviewErrorMessage(null);

    void atelierClient.workspace
      .getFileContent(projectPath, selectedDiffPath)
      .then((preview) => {
        if (cancelled) {
          return;
        }

        setSelectedPreview(preview);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setSelectedPreview(null);
        setPreviewErrorMessage(
          error instanceof Error ? error.message : String(error),
        );
      });

    return () => {
      cancelled = true;
    };
  }, [diffPanelState, inspectionMode, selectedDiffPath, sessionMeta]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || !canSend) return;

    setInput("");
    setIsLoading(true);
    setWorkspaceState((current) =>
      reduceWorkspaceEvent(current, { type: "user-message", text }),
    );

    try {
      await atelierClient.runtime.send(sessionIdRef.current, text);
    } catch (error) {
      setWorkspaceState((current) => {
        const lastItem = current.timeline.at(-1);

        return {
          ...current,
          timeline:
            lastItem?.kind === "user" && lastItem.text === text
              ? current.timeline.slice(0, -1)
              : current.timeline,
        };
      });
      setIsLoading(false);
      addToast(buildStudioRequestError("send session message", error), "error");
    }
  };

  const handleCopyToClipboard = async () => {
    if (!session?.fullPath) return;

    const exportSessionId = sessionIdRef.current;

    try {
      setIsExporting(true);
      const text = await atelierClient.exports.session(session.fullPath, "");
      if (sessionIdRef.current !== exportSessionId) return;
      await navigator.clipboard.writeText(text);
      if (sessionIdRef.current !== exportSessionId) return;
      addToast("Session copied to clipboard", "success");
    } catch (error) {
      if (sessionIdRef.current !== exportSessionId) return;
      addToast(`Copy failed: ${String(error)}`, "error");
    } finally {
      if (sessionIdRef.current === exportSessionId) {
        setIsExporting(false);
      }
    }
  };

  const handleExportToFile = async () => {
    if (!session?.fullPath) return;

    const exportSessionId = sessionIdRef.current;

    try {
      setIsExporting(true);
      const { save } = await import("@tauri-apps/plugin-dialog");

      const rawTitle = session.firstPrompt ?? session.sessionId;
      const safeTitle = rawTitle
        .slice(0, 60)
        .replaceAll(/[/\\:*?"<>|]/g, "-")
        .trim();
      const defaultName = `${safeTitle}.txt`;

      const outputPath = await save({
        defaultPath: defaultName,
        filters: [{ name: "Text", extensions: ["txt"] }],
      });

      if (!outputPath || sessionIdRef.current !== exportSessionId) return;

      const savedPath = await atelierClient.exports.session(
        session.fullPath,
        outputPath,
      );
      if (sessionIdRef.current !== exportSessionId) return;
      addToast(`Exported to ${savedPath}`, "success");
    } catch (error) {
      if (sessionIdRef.current !== exportSessionId) return;
      addToast(`Export failed: ${String(error)}`, "error");
    } finally {
      if (sessionIdRef.current === exportSessionId) {
        setIsExporting(false);
      }
    }
  };

  const handleExportToCodex = async () => {
    if (!session?.fullPath) return;

    const exportSessionId = sessionIdRef.current;

    try {
      setIsExporting(true);
      const savedPath = await atelierClient.exports.codex(session.fullPath);
      if (sessionIdRef.current !== exportSessionId) return;
      addToast(`Exported to Codex: ${savedPath}`, "success");
    } catch (error) {
      if (sessionIdRef.current !== exportSessionId) return;
      addToast(`Codex export failed: ${String(error)}`, "error");
    } finally {
      if (sessionIdRef.current === exportSessionId) {
        setIsExporting(false);
      }
    }
  };

  const handleGenerateHandoff = async () => {
    if (!session?.fullPath) return;

    const handoffSessionId = sessionIdRef.current;

    try {
      setIsExporting(true);
      const { save } = await import("@tauri-apps/plugin-dialog");

      const rawTitle = session.firstPrompt ?? session.sessionId;
      const safeTitle = rawTitle
        .slice(0, 60)
        .replaceAll(/[/:*?"<>|\\]/g, "-")
        .trim();
      const defaultName = `handoff-${safeTitle}.md`;

      const outputPath = await save({
        defaultPath: defaultName,
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });

      if (!outputPath || sessionIdRef.current !== handoffSessionId) return;

      pendingExportRef.current = {
        path: outputPath,
        sessionId: handoffSessionId,
      };

      const compactPrompt = `/compact Create a complete context handoff document in Markdown format. Include exactly:\n1. 🎯 Original Goal\n2. 💬 Current State\n3. ⏭️ Next Steps\nDo not include any other conversational text.`;

      setInput("");
      setIsLoading(true);
      setWorkspaceState((current) =>
        reduceWorkspaceEvent(current, {
          type: "user-message",
          text: compactPrompt,
        }),
      );
      await atelierClient.runtime.send(handoffSessionId, compactPrompt);

      if (sessionIdRef.current !== handoffSessionId) return;

      addToast(
        "Compacting session... Will export automatically when done.",
        "success",
      );
    } catch (error) {
      if (sessionIdRef.current !== handoffSessionId) return;

      if (pendingExportRef.current?.sessionId === handoffSessionId) {
        pendingExportRef.current = null;
      }
      addToast(buildStudioRequestError("generate handoff", error), "error");
      setIsLoading(false);
    } finally {
      if (sessionIdRef.current === handoffSessionId) {
        setIsExporting(false);
      }
    }
  };

  const persistResolvedModelMetadata = useCallback(
    async (
      nextResolvedModel: string,
      nextContextWindow: ClaudeContextWindowValue,
    ) => {
      if (!session || !renderedSessionEscapedPath) {
        return;
      }

      await updateSessionModelMetadata({
        escapedPath: renderedSessionEscapedPath,
        sessionId: session.sessionId,
        claudeModel: nextResolvedModel,
        claudeContextWindow: nextContextWindow,
      });
    },
    [renderedSessionEscapedPath, session],
  );

  const sendLiveModelSwitch = useCallback(
    async (
      nextResolvedModel: string,
      nextContextWindow: ClaudeContextWindowValue,
    ) => {
      await atelierClient.runtime.send(
        sessionIdRef.current,
        `/model ${nextResolvedModel}`,
      );
      await persistResolvedModelMetadata(nextResolvedModel, nextContextWindow);
    },
    [persistResolvedModelMetadata],
  );

  const handleSessionContextWindowChange = (
    nextValue: ClaudeContextWindowValue,
  ) => {
    const previousValue = sessionContextWindowOverride;
    const previousResolvedModel = desiredResolvedModel;
    setSessionContextWindowOverride(nextValue);

    if (!session) {
      return;
    }

    const nextResolvedModel = formatClaudeModelString(
      sessionContextWindowState.baseModel ?? "",
      nextValue,
    );

    if (!nextResolvedModel || nextResolvedModel === previousResolvedModel) {
      return;
    }

    void sendLiveModelSwitch(nextResolvedModel, nextValue).catch((error) => {
      setSessionContextWindowOverride(previousValue);
      addToast(buildStudioRequestError("update session model metadata", error), "error");
    });
  };

  const handleStopSession = () => {
    pendingExportRef.current = null;
    void atelierClient.runtime.stop(sessionIdRef.current).catch((error) => {
      const toastMessage = getSessionStopToastMessage(error);
      if (!toastMessage) {
        return;
      }

      addToast(toastMessage, "error");
    });
  };

  useEffect(() => {
    if (
      !session ||
      !session.fullPath ||
      resumeReconnectGeneration === 0 ||
      resumeModelReconciledRef.current
    ) {
      return;
    }

    const currentResolvedModel = session.claudeModel;

    if (!desiredResolvedModel || desiredResolvedModel === currentResolvedModel) {
      resumeModelReconciledRef.current = true;
      return;
    }

    void sendLiveModelSwitch(
      desiredResolvedModel,
      sessionContextWindowState.value ??
        getDefaultClaudeContextWindow(sessionContextWindowState.baseModel ?? "") ??
        "default",
    )
      .then(() => {
        resumeModelReconciledRef.current = true;
      })
      .catch((error) => {
        resumeModelReconciledRef.current = false;
        addToast(buildStudioRequestError("update session model metadata", error), "error");
      });
  }, [
    addToast,
    desiredResolvedModel,
    resumeReconnectGeneration,
    sendLiveModelSwitch,
    session,
    sessionContextWindowState.baseModel,
    sessionContextWindowState.value,
  ]);

  return (
    <div className="bg-background flex h-full flex-col">
      <SessionHeader
        title={
          session
            ? session.firstPrompt || session.sessionId
            : "New Conversation"
        }
        meta={sessionMeta}
        statusLabel={statusLabel}
        runtimeCost={runtimeCostLabel}
        isConnected={isConnected}
        isExporting={isExporting}
        canStopSession={isConnected}
        hasSessionActions={Boolean(session?.fullPath)}
        sessionContextWindowSelector={
          <SessionContextWindowSelector
            baseModel={sessionContextWindowState.baseModel}
            value={sessionContextWindowState.value}
            options={sessionContextWindowState.options}
            onChange={handleSessionContextWindowChange}
          />
        }
        onCopyToClipboard={() => void handleCopyToClipboard()}
        onStopSession={handleStopSession}
        onExportToFile={() => void handleExportToFile()}
        onExportToCodex={() => void handleExportToCodex()}
        onGenerateHandoff={() => void handleGenerateHandoff()}
      />

      <SessionDiffPanel
        state={diffPanelState}
        status={diffStatus}
        diff={selectedDiff}
        preview={selectedPreview}
        mode={inspectionMode}
        selectedPath={selectedDiffPath}
        errorMessage={
          inspectionMode === "preview"
            ? (previewErrorMessage ?? undefined)
            : (diffErrorMessage ?? undefined)
        }
        onSelectFile={setSelectedDiffPath}
        onModeChange={setInspectionMode}
      />

      <SessionErrorBanner error={workspaceState.error} />

      <SessionTranscript
        messages={transcriptMessages}
        isLoading={isLoading}
        loadingMessage={transcriptLoadingMessage}
        emptyStateMessage={emptyStateMessage}
        bottomRef={bottomRef}
      />

      <SessionComposer
        input={input}
        canSend={canSend}
        isLoading={isLoading}
        placeholder={composerPlaceholder}
        onInputChange={setInput}
        onSend={handleSend}
      />
    </div>
  );
}
