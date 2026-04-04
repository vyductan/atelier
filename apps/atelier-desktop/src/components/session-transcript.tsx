import { Bot, Loader2, User, ChevronRight, Wrench } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { CodeBlock } from "@acme/ui/components/code-block";

export interface SessionTranscriptMessage {
  role: "user" | "assistant" | "system";
  text: string;
  isStreaming?: boolean;
  isCompactSummary?: boolean;
}

const markdownComponents = {
  code({ className, children }: React.ComponentPropsWithoutRef<"code">) {
    const language = className?.replace("language-", "") ?? "";
    const isBlock = !!className?.includes("language-");
    if (isBlock) {
      return (
        <CodeBlock language={language}>
          {String(children).replace(/\n$/, "")}
        </CodeBlock>
      );
    }
    return (
      <code className="rounded bg-black/10 px-1 py-0.5 font-mono text-[11px] dark:bg-white/10">
        {children}
      </code>
    );
  },
} as const;

interface SessionTranscriptProps {
  messages: SessionTranscriptMessage[];
  isLoading: boolean;
  loadingMessage?: string | null;
  emptyStateMessage?: string | null;
  bottomRef: React.RefObject<HTMLDivElement | null>;
}

interface TextPart {
  type: "text";
  content: string;
}

interface ToolUsePart {
  type: "tool_use";
  name: string;
  rawContent: string;
  displayContent: string;
  summary: string;
  language?: string;
}

interface CompactSummaryPart {
  type: "compact_summary";
  summary: string;
  content: string;
}

type ParsedMessagePart = TextPart | ToolUsePart | CompactSummaryPart;

function formatCompactSummary(text: string): string {
  const autoMatch = text.match(/preTokens":(\d+)/);
  if (autoMatch) {
    const tokens = Number(autoMatch[1]);
    const compactTokens = new Intl.NumberFormat("en-US", {
      notation: "compact",
      maximumFractionDigits: 0,
    }).format(tokens);

    return `Compacted chat auto ${compactTokens} tokens freed`;
  }

  return "Conversation was compacted to free up context";
}

function formatToolSummary(name: string): string {
  const normalizedName = name
    .replaceAll(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll(/[_-]+/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim();

  if (!normalizedName) {
    return "Tool call";
  }

  const capitalizedName =
    normalizedName.charAt(0).toUpperCase() + normalizedName.slice(1);

  return `${capitalizedName} tool call`;
}

function formatToolContent(content: string): {
  displayContent: string;
  language?: string;
} {
  if (!content) {
    return { displayContent: "", language: undefined };
  }

  try {
    return {
      displayContent: JSON.stringify(JSON.parse(content), null, 2),
      language: "json",
    };
  } catch {
    return {
      displayContent: content,
      language: undefined,
    };
  }
}

function parseMessageText(
  text: string,
  isCompactSummary = false,
): ParsedMessagePart[] {
  if (!text) return [];

  if (isCompactSummary) {
    return [
      {
        type: "compact_summary",
        summary: formatCompactSummary(text),
        content: text,
      },
    ];
  }

  const parts = text.split(/(<tool_use\b[^>]*>[\s\S]*?(?:<\/tool_use>|$))/i);
  return parts.filter(Boolean).map<ParsedMessagePart>((part) => {
    if (part.toLowerCase().startsWith("<tool_use")) {
      const nameMatch = part.match(/name="([^"]+)"/i);
      const name = nameMatch?.[1] ?? "unknown tool";

      const contentMatch = part.match(
        /<tool_use\b[^>]*>([\s\S]*?)(?:<\/tool_use>|$)/i,
      );
      const rawContent = contentMatch?.[1] ?? "";
      const { displayContent, language } = formatToolContent(rawContent);

      return {
        type: "tool_use",
        name,
        rawContent,
        displayContent,
        language,
        summary: formatToolSummary(name),
      };
    }
    return { type: "text", content: part };
  });
}

export function SessionTranscript({
  messages,
  isLoading,
  loadingMessage,
  emptyStateMessage,
  bottomRef,
}: SessionTranscriptProps) {
  return (
    <div
      data-testid="session-transcript"
      className="flex-1 space-y-4 overflow-y-auto px-4 py-4"
    >
      {isLoading && messages.length === 0 && (
        <div className="text-muted-foreground flex items-center justify-center py-8">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          <span className="text-xs">Connecting to session...</span>
        </div>
      )}
      {isLoading && messages.length > 0 && loadingMessage ? (
        <div className="text-muted-foreground flex items-center justify-center gap-2 py-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-xs">{loadingMessage}</span>
        </div>
      ) : null}
      {!isLoading && messages.length === 0 && emptyStateMessage ? (
        <div className="text-muted-foreground flex items-center justify-center py-8 text-center">
          <span className="max-w-sm text-xs leading-relaxed">
            {emptyStateMessage}
          </span>
        </div>
      ) : null}
      {messages.map((msg, i) => (
        <div
          key={i}
          className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
        >
          {msg.role === "assistant" && (
            <div className="bg-muted mt-0.5 shrink-0 rounded-full p-1">
              <Bot className="h-3 w-3" />
            </div>
          )}
          <div
            className={`max-w-[80%] rounded-xl px-3 py-2 text-xs leading-relaxed ${
              msg.role === "user"
                ? "bg-primary text-primary-foreground prose prose-xs prose-invert max-w-none"
                : msg.role === "system"
                  ? "border border-zinc-200 bg-zinc-100 text-zinc-500 dark:border-zinc-800 dark:bg-zinc-800/50 dark:text-zinc-400"
                  : "bg-muted prose prose-xs prose-stone dark:prose-invert max-w-none"
            }`}
          >
            {parseMessageText(msg.text, msg.isCompactSummary).map((part, partIdx) => {
              if (part.type === "tool_use") {
                return (
                  <details
                    key={partIdx}
                    className="group my-2 overflow-hidden rounded-md border border-black/10 dark:border-white/10"
                  >
                    <summary className="flex cursor-pointer list-none items-center gap-2 bg-black/5 px-2.5 py-1.5 text-xs font-semibold hover:bg-black/10 dark:bg-white/5 dark:hover:bg-white/10 [&::-webkit-details-marker]:hidden">
                      <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
                      <Wrench className="h-3 w-3" />
                      <span>{part.summary}</span>
                    </summary>
                    <div className="bg-black/5 p-2 dark:bg-black/20">
                      <CodeBlock language={part.language}>{part.displayContent}</CodeBlock>
                    </div>
                  </details>
                );
              }

              if (part.type === "compact_summary") {
                return (
                  <details
                    key={partIdx}
                    className="group my-2 overflow-hidden rounded-md border border-black/10 dark:border-white/10"
                  >
                    <summary className="flex cursor-pointer list-none items-center gap-2 bg-black/5 px-2.5 py-1.5 text-xs font-semibold hover:bg-black/10 dark:bg-white/5 dark:hover:bg-white/10 [&::-webkit-details-marker]:hidden">
                      <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
                      <span>{part.summary}</span>
                    </summary>
                    <div className="bg-black/5 p-2 dark:bg-black/20">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={markdownComponents}
                      >
                        {part.content}
                      </ReactMarkdown>
                    </div>
                  </details>
                );
              }

              return (
                <ReactMarkdown
                  key={partIdx}
                  remarkPlugins={[remarkGfm]}
                  components={markdownComponents}
                >
                  {part.content}
                </ReactMarkdown>
              );
            })}
            {msg.isStreaming && (
              <span className="ml-1 inline-block h-2 w-0.5 animate-pulse bg-current" />
            )}
          </div>
          {msg.role === "user" && (
            <div className="bg-primary/10 mt-0.5 shrink-0 rounded-full p-1">
              <User className="h-3 w-3" />
            </div>
          )}
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
