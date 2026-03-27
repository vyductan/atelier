import { AlertCircle } from "lucide-react";

import type { SessionEntry } from "../lib/types";

interface DeleteDialogProps {
  session: SessionEntry | null;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (permanent: boolean) => void;
  isDeleting?: boolean;
}

export function DeleteDialog({
  session,
  isOpen,
  onClose,
  onConfirm,
  isDeleting = false,
}: DeleteDialogProps) {
  if (!isOpen || !session) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Dialog */}
      <div className="bg-background relative z-10 w-full max-w-lg rounded-lg border p-6 shadow-lg">
        <div className="mb-4 flex items-start gap-3">
          <AlertCircle className="text-destructive mt-0.5 h-5 w-5 shrink-0" />
          <div className="flex-1">
            <h2 className="text-lg font-semibold">Delete Session</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Are you sure you want to delete this session?
            </p>
          </div>
        </div>

        {/* Session Info */}
        <div className="bg-muted/50 mb-6 rounded-md border p-3">
          <p className="text-sm font-medium">First Prompt:</p>
          <p className="text-muted-foreground mt-1 line-clamp-2 text-sm">
            {session.firstPrompt}
          </p>
          {session.summary && (
            <>
              <p className="mt-2 text-sm font-medium">Summary:</p>
              <p className="text-muted-foreground mt-1 line-clamp-2 text-sm">
                {session.summary}
              </p>
            </>
          )}
          <p className="text-muted-foreground mt-2 text-xs">
            {session.messageCount} messages • Created{" "}
            {new Date(session.created).toLocaleDateString()}
          </p>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2">
          <button
            onClick={() => onConfirm(false)}
            disabled={isDeleting}
            className="bg-secondary text-secondary-foreground hover:bg-secondary/80 w-full rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
          >
            {isDeleting ? "Moving to Trash..." : "Move to Trash"}
          </button>
          <button
            onClick={() => {
              if (
                confirm("This action cannot be undone. Delete permanently?")
              ) {
                onConfirm(true);
              }
            }}
            disabled={isDeleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90 w-full rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
          >
            {isDeleting ? "Deleting..." : "Delete Permanently"}
          </button>
          <button
            onClick={onClose}
            disabled={isDeleting}
            className="hover:bg-accent w-full rounded-md border px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
