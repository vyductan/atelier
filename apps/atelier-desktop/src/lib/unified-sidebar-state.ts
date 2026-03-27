import type { TaskRecord } from "./tasks";
import type {
  SessionSidebarItemViewModel,
  SessionSidebarWorkspaceViewModel,
} from "../components/session-sidebar-state";

export type UnifiedSidebarItemViewModel =
  | { type: "session"; item: SessionSidebarItemViewModel; sortDate: number }
  | { type: "task"; item: TaskRecord; sortDate: number };

export interface UnifiedSidebarWorkspaceViewModel
  extends Omit<SessionSidebarWorkspaceViewModel, "sessions" | "sessionCount"> {
  items: UnifiedSidebarItemViewModel[];
  itemCount: number;
}

export function buildUnifiedSidebarState(
  sessionGroups: SessionSidebarWorkspaceViewModel[],
  tasks: TaskRecord[],
): UnifiedSidebarWorkspaceViewModel[] {
  const workspacesMap = new Map<string, UnifiedSidebarWorkspaceViewModel>();

  // 1. Initialize workspaces from session groups
  for (const group of sessionGroups) {
    const items: UnifiedSidebarItemViewModel[] = group.sessions.map(
      (session) => ({
        type: "session",
        item: session,
        sortDate: session.sortDate,
      }),
    );

    workspacesMap.set(group.workspacePath, {
      name: group.name,
      workspacePath: group.workspacePath,
      isCollapsed: group.isCollapsed,
      emptyStateLabel: group.emptyStateLabel,
      errorLabel: group.errorLabel,
      isSelected: group.isSelected,
      isMissing: group.isMissing,
      items,
      itemCount: items.length,
    });
  }

  // 2. Merge tasks into these workspaces
  for (const task of tasks) {
    let workspace = workspacesMap.get(task.workspaceId);

    // If task belongs to a workspace not in sessionGroups, we create a stub for it
    if (!workspace) {
      const name =
        task.workspaceId.split(/[/\\]/).findLast(Boolean) || task.workspaceId;
      workspace = {
        name,
        workspacePath: task.workspaceId,
        isCollapsed: false,
        isSelected: false,
        isMissing: false,
        items: [],
        itemCount: 0,
      };
      workspacesMap.set(task.workspaceId, workspace);
    }

    workspace.items.push({
      type: "task",
      item: task,
      sortDate: new Date(task.updatedAt).getTime(),
    });
    workspace.itemCount += 1;
    // Clear empty state label since it now has items
    workspace.emptyStateLabel = undefined;
  }

  // 3. Sort items within each workspace
  for (const workspace of workspacesMap.values()) {
    workspace.items = workspace.items.toSorted((a, b) => b.sortDate - a.sortDate);
  }

  // 4. Return sorted workspaces (sort by the latest activity)
  return [...workspacesMap.values()].toSorted((a, b) => {
    const aLatest = a.items[0]?.sortDate ?? 0;
    const bLatest = b.items[0]?.sortDate ?? 0;
    return bLatest - aLatest;
  });
}
