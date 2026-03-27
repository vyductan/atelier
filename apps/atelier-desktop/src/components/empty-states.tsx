import { Database, FolderOpen, Search } from "lucide-react";

export function EmptyProject() {
  return (
    <div className="flex h-full flex-col items-center justify-center p-8 text-center">
      <FolderOpen className="text-muted-foreground/50 mb-4 h-16 w-16" />
      <h3 className="mb-2 text-lg font-semibold">No Projects Found</h3>
      <p className="text-muted-foreground mb-6 max-w-sm text-sm">
        No Claude Code projects were found in your{" "}
        <code className="bg-muted rounded px-1 py-0.5 font-mono text-xs">
          ~/.claude/projects/
        </code>{" "}
        directory.
      </p>
      <p className="text-muted-foreground text-xs">
        Start a Claude Code session to create a project.
      </p>
    </div>
  );
}

export function EmptySession() {
  return (
    <div className="flex h-full flex-col items-center justify-center p-8 text-center">
      <Database className="text-muted-foreground/50 mb-4 h-16 w-16" />
      <h3 className="mb-2 text-lg font-semibold">No Sessions</h3>
      <p className="text-muted-foreground max-w-sm text-sm">
        This project doesn't have any sessions yet.
      </p>
    </div>
  );
}

export function EmptySearchResult() {
  return (
    <div className="flex h-full flex-col items-center justify-center p-8 text-center">
      <Search className="text-muted-foreground/50 mb-4 h-16 w-16" />
      <h3 className="mb-2 text-lg font-semibold">No Results</h3>
      <p className="text-muted-foreground max-w-sm text-sm">
        No sessions match your search query or filters. Try adjusting your
        search.
      </p>
    </div>
  );
}

export function SelectProject() {
  return (
    <div className="flex h-full flex-col items-center justify-center p-8 text-center">
      <FolderOpen className="text-muted-foreground/50 mb-4 h-16 w-16" />
      <h3 className="mb-2 text-lg font-semibold">Select a Project</h3>
      <p className="text-muted-foreground max-w-sm text-sm">
        Choose a project from the sidebar to view its sessions.
      </p>
    </div>
  );
}
