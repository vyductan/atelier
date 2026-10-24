import { useEffect } from "react";

import { AcmeSync } from "./components/acme-sync";
import { AppShell } from "./components/app-shell";
import { ClaudeGlobalConfig } from "./components/claude-global-config";
import { ConversationView } from "./components/conversation-view";
import { NotTauriError } from "./components/not-tauri-error";
import { Toaster } from "./components/toaster";
import { useSessionStore } from "./store/session-store";

// Check if running in Tauri
const isTauri =
  globalThis.window !== undefined && "__TAURI_INTERNALS__" in globalThis.window;

function App() {
  const { setSelectedSessionId } = useSessionStore();

  useEffect(() => {
    if (!isTauri) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedSessionId(null);
    };
    globalThis.addEventListener("keydown", handleKeyDown);
    return () => globalThis.removeEventListener("keydown", handleKeyDown);
  }, [setSelectedSessionId]);

  if (!isTauri) {
    return <NotTauriError />;
  }

  return (
    <>
      <AppShell
        chatsWorkspace={<ConversationView />}
        syncView={<AcmeSync />}
        configView={({ onOptimizeRules }) => <ClaudeGlobalConfig onOptimizeRules={onOptimizeRules} />}
        hiddenViews={["chats", "sync"]}
      />
      <Toaster />
    </>
  );
}

export default App;
