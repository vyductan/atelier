import { Loader2, Send } from "lucide-react";

interface SessionComposerProps {
  input: string;
  canSend: boolean;
  isLoading: boolean;
  placeholder?: string;
  onInputChange: (value: string) => void;
  onSend: () => void | Promise<void>;
}

export function SessionComposer({
  input,
  canSend,
  isLoading,
  placeholder = "Message Claude... (Enter to send, Shift+Enter for newline)",
  onInputChange,
  onSend,
}: SessionComposerProps) {
  return (
    <div data-testid="session-composer" className="shrink-0 border-t px-3 py-3">
      <div className="flex items-end gap-2">
        <textarea
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void onSend();
            }
          }}
          placeholder={placeholder}
          rows={2}
          disabled={!canSend}
          className="bg-background focus:ring-ring placeholder:text-muted-foreground flex-1 resize-none rounded-md border px-3 py-2 text-xs outline-none focus:ring-1 disabled:opacity-50"
        />
        <button
          onClick={() => void onSend()}
          disabled={!input.trim() || !canSend}
          className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md p-2 transition-colors disabled:opacity-50"
        >
          {isLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Send className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
    </div>
  );
}
