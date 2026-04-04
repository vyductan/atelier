import { useState, useMemo, useEffect, useRef } from "react";
import { Loader2, Send } from "lucide-react";

interface SessionComposerProps {
  input: string;
  canSend: boolean;
  isLoading: boolean;
  placeholder?: string;
  onInputChange: (value: string) => void;
  onSend: () => void | Promise<void>;
}

import { skillsClient } from "../lib/skills-client";

const BASE_COMMANDS = [
  { name: "compact", description: "Compact the current session to save tokens" },
  { name: "clear", description: "Clear the session history" },
  { name: "export", description: "Export the session to markdown" },
  { name: "bug", description: "Report a bug" },
  { name: "feature", description: "Request a feature" },
  { name: "cost", description: "Show session cost" },
  { name: "help", description: "Show help" },
  { name: "init", description: "Initialize a new project" },
  { name: "login", description: "Log in to Claude" },
  { name: "logout", description: "Log out of Claude" },
  { name: "pr", description: "Extract pull request summary" },
  { name: "review", description: "Review a pull request" },
  { name: "terminal", description: "Open terminal" },
];

export function SessionComposer({
  input,
  canSend,
  isLoading,
  placeholder = "Message Claude... (Enter to send, Shift+Enter for newline)",
  onInputChange,
  onSend,
}: SessionComposerProps) {
  const [isMenuDismissed, setIsMenuDismissed] = useState(false);
  const [dynamicCommands, setDynamicCommands] = useState<{name: string, description: string}[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let mounted = true;
    void skillsClient.getInstalledSkills().then((skills) => {
      if (mounted) {
        setDynamicCommands(
          skills.map((s) => ({
            name: s.name,
            description: `Tool: ${s.path.split('/').pop() || s.source || 'Local Skill'}`
          }))
        );
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  const availableCommands = useMemo(() => {
    return [...BASE_COMMANDS, ...dynamicCommands];
  }, [dynamicCommands]);

  // Command Menu Logic
  const trimmed = input.trimStart();
  const isCommandMode = trimmed.startsWith("/") && !trimmed.includes(" ");
  const commandPrefix = isCommandMode ? trimmed.substring(1).toLowerCase() : "";

  const filteredCommands = useMemo(() => {
    return availableCommands.filter((c) => c.name.startsWith(commandPrefix));
  }, [commandPrefix, availableCommands]);

  const showMenu = isCommandMode && filteredCommands.length > 0 && !isMenuDismissed;
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    setSelectedIndex(0);
    setIsMenuDismissed(false);
  }, [input]);

  return (
    <div data-testid="session-composer" className="shrink-0 border-t px-3 py-3">
      <div className="relative flex items-end gap-2">
        {showMenu && (
          <div className="bg-popover text-popover-foreground absolute bottom-full left-0 mb-2 w-full max-w-sm overflow-hidden rounded-md border shadow-md z-50">
            <div className="p-1 max-h-48 overflow-y-auto">
              {filteredCommands.map((command, idx) => (
                <button
                  key={command.name}
                  type="button"
                  className={`flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-xs ${
                    idx === selectedIndex
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-accent/50 hover:text-accent-foreground"
                  }`}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  onClick={() => {
                    onInputChange(`/${command.name} `);
                    setIsMenuDismissed(true);
                    textareaRef.current?.focus();
                  }}
                >
                  <span className="font-medium flex-shrink-0">/{command.name}</span>
                  <span className="text-muted-foreground ml-2 truncate text-[10px]">
                    {command.description}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={(e) => {
            if (showMenu) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSelectedIndex((prev) => (prev + 1) % filteredCommands.length);
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setSelectedIndex(
                  (prev) => (prev - 1 + filteredCommands.length) % filteredCommands.length
                );
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                const selected = filteredCommands[selectedIndex];
                if (selected) {
                  onInputChange(`/${selected.name} `);
                  setIsMenuDismissed(true);
                }
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setIsMenuDismissed(true);
                return;
              }
            }

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
