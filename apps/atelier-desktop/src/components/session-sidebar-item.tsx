import { useRef } from "react";
import { Pencil, Trash2 } from "lucide-react";

import { Button } from "@acme/ui/components/button";
import { Input } from "@acme/ui/components/input";

import type { SessionEntry } from "../lib/types";
import type { SessionSidebarItemViewModel } from "./session-sidebar-state";
import {
  buildRenameFailureMessage,
  shouldCloseRenameEditor,
} from "./chat-sidebar-state";

interface SessionSidebarItemProps {
  item: SessionSidebarItemViewModel;
  session: SessionEntry;
  isRenaming: boolean;
  onSelect: () => void;
  onRename: () => void;
  onRenameCancel: () => void;
  onRenameSubmit: (session: SessionEntry, nextTitle: string) => Promise<void>;
  onRenameError: (message: string) => void;
  onDelete: () => void;
}

export function SessionSidebarItem({
  item,
  session,
  isRenaming,
  onSelect,
  onRename,
  onRenameCancel,
  onRenameSubmit,
  onRenameError,
  onDelete,
}: SessionSidebarItemProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleRenameSubmit = async () => {
    const value = inputRef.current?.value.trim();
    if (!value || !session.fullPath) {
      onRenameCancel();
      return;
    }

    try {
      await onRenameSubmit(session, value);
    } catch (error) {
      onRenameError(buildRenameFailureMessage(error));
      if (!shouldCloseRenameEditor({ ok: false, error })) {
        return;
      }
    }

    if (shouldCloseRenameEditor({ ok: true })) {
      onRenameCancel();
    }
  };

  if (isRenaming) {
    return (
      <div className="rounded-md px-2 py-2">
        <Input
          ref={inputRef}
          autoFocus
          defaultValue={item.title}
          className="text-xs"
          onKeyDown={(event) => {
            if (event.key === "Enter") void handleRenameSubmit();
            if (event.key === "Escape") onRenameCancel();
          }}
          onBlur={() => void handleRenameSubmit()}
          onClick={(event) => event.stopPropagation()}
        />
      </div>
    );
  }

  return (
    <div
      data-selected={item.isSelected}
      className={`group relative flex cursor-pointer items-start gap-2 rounded-md px-2 py-2 transition-colors ${
        item.isSelected
          ? "bg-accent text-accent-foreground"
          : "hover:bg-muted/50"
      }`}
      onClick={onSelect}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="truncate text-xs leading-snug font-medium">
            {item.title}
          </p>
          <span className="text-muted-foreground shrink-0 text-[11px] font-normal">
            {item.providerLabel}
          </span>
        </div>
        <p className="text-muted-foreground mt-1 text-xs">{item.subtitle}</p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          {item.timestampLabel}
        </p>
      </div>
      <div className="mt-0.5 flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={(event) => {
            event.stopPropagation();
            onRename();
          }}
          title="Rename"
        >
          <Pencil className="h-3 w-3" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
          title="Delete"
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}
