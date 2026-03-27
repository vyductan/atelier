import type { ReactNode } from "react";

import {
  Copy,
  Download,
  FileText,
  Loader2,
  MoreHorizontal,
  Upload,
} from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@acme/ui/components/dropdown-menu";

interface SessionHeaderProps {
  title: string;
  meta?: string | null;
  statusLabel: string;
  runtimeCost?: string | null;
  isConnected: boolean;
  isExporting: boolean;
  canStopSession: boolean;
  hasSessionActions: boolean;
  sessionContextWindowSelector?: ReactNode;
  onCopyToClipboard: () => void;
  onStopSession: () => void;
  onExportToFile: () => void;
  onExportToCodex: () => void;
  onGenerateHandoff: () => void;
}

export function SessionHeader({
  title,
  meta,
  statusLabel,
  runtimeCost,
  isConnected,
  isExporting,
  canStopSession,
  hasSessionActions,
  sessionContextWindowSelector,
  onCopyToClipboard,
  onStopSession,
  onExportToFile,
  onExportToCodex,
  onGenerateHandoff,
}: SessionHeaderProps) {
  return (
    <div
      data-testid="session-header"
      className="flex h-10 shrink-0 items-center gap-2 border-b px-4"
    >
      <div
        className={`h-2 w-2 rounded-full ${isConnected ? "bg-green-500" : "bg-muted-foreground"}`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <div className="truncate text-xs font-medium">{title}</div>
          <span className="bg-muted text-muted-foreground shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium">
            {statusLabel}
          </span>
          {runtimeCost ? (
            <span className="bg-muted text-muted-foreground shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium">
              {runtimeCost}
            </span>
          ) : null}
        </div>
        {meta ? (
          <div className="text-muted-foreground truncate text-[11px]">
            {meta}
          </div>
        ) : null}
      </div>
      <div className="ml-auto flex items-center gap-2">
        {sessionContextWindowSelector}
        {canStopSession ? (
          <button
            type="button"
            onClick={onStopSession}
            disabled={isExporting}
            className="hover:bg-accent text-muted-foreground hover:text-foreground rounded px-2 py-1 text-xs transition-colors disabled:opacity-50"
            title="Stop session"
          >
            Stop
          </button>
        ) : null}
        <button
          onClick={onCopyToClipboard}
          disabled={isExporting}
          className="hover:bg-accent text-muted-foreground hover:text-foreground rounded p-1.5 transition-colors disabled:opacity-50"
          title="Copy to clipboard"
        >
          {isExporting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </button>

        {hasSessionActions && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                disabled={isExporting}
                className="hover:bg-accent text-muted-foreground hover:text-foreground rounded p-1.5 transition-colors disabled:opacity-50"
                title="More actions"
              >
                {isExporting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <MoreHorizontal className="h-3.5 w-3.5" />
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onExportToFile} disabled={isExporting}>
                <Download className="mr-2 h-4 w-4" />
                <span>Export to .txt file</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={onExportToCodex}
                disabled={isExporting}
              >
                <Upload className="mr-2 h-4 w-4" />
                <span>Export to Codex</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={onGenerateHandoff}
                disabled={isExporting}
              >
                <FileText className="mr-2 h-4 w-4" />
                <span>Generate Handoff (.md)</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}
