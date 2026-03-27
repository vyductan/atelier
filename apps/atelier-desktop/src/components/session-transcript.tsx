import { Bot, Loader2, User } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { CodeBlock } from "@acme/ui/components/code-block";

export interface SessionTranscriptMessage {
  role: "user" | "assistant" | "system";
  text: string;
  isStreaming?: boolean;
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
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={markdownComponents}
            >
              {msg.text}
            </ReactMarkdown>
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
