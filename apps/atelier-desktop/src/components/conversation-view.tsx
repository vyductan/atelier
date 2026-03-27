import type { ReactElement } from "react";
import { MessageSquare } from "lucide-react";

import { useWorkspaceSessions } from "../hooks/use-workspace-sessions";
import { useSessionStore } from "../store/session-store";
import { ActiveSessionPanel } from "./active-session-panel";
import { WorkspaceOverviewPanel } from "./workspace-overview-panel";

type SelectedSessionViewProps = {
  selectedSessionId: string;
};

function EmptyConversationState(): ReactElement {
  return (
    <div className="text-muted-foreground flex h-full items-center justify-center">
      <div className="text-center">
        <MessageSquare className="mx-auto mb-3 h-10 w-10 opacity-30" />
        <p className="text-sm">Select a chat to view</p>
      </div>
    </div>
  );
}

function SelectedSessionView({
  selectedSessionId,
}: SelectedSessionViewProps): ReactElement {
  const { sessions } = useWorkspaceSessions();
  const session = sessions.find(
    (workspaceSession) => workspaceSession.id === selectedSessionId,
  )?.source;

  if (!session) {
    return <EmptyConversationState />;
  }

  return <ActiveSessionPanel key={session.sessionId} session={session} />;
}

export function ConversationView(): ReactElement | null {
  const { selectedSessionId, selectedWorkspaceId, newSessionProject } =
    useSessionStore();

  if (newSessionProject) {
    return (
      <ActiveSessionPanel
        key={`new-${newSessionProject}`}
        newSessionProject={newSessionProject}
      />
    );
  }

  if (selectedSessionId) {
    return <SelectedSessionView selectedSessionId={selectedSessionId} />;
  }

  if (selectedWorkspaceId) {
    return <WorkspaceOverviewPanel workspaceId={selectedWorkspaceId} />;
  }

  return <EmptyConversationState />;
}
