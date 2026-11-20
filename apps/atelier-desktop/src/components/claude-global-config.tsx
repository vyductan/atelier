import type { JSX } from "react";
import { useEffect, useState } from "react";
import { Plus, Trash2, Save, ExternalLink, ChevronDown } from "lucide-react";

import { Button } from "@acme/ui/components/button";
import { Input } from "@acme/ui/components/input";
import { Select } from "@acme/ui/components/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@acme/ui/components/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@acme/ui/components/dropdown-menu";

import {
  getClaudeModelCapability,
  supportsMultipleContextWindows,
} from "../lib/claude-model-capabilities";
import type { ClaudeContextWindowValue } from "../lib/claude-model-capabilities";
import {
  formatClaudeModelString,
  parseClaudeModelString,
} from "../lib/claude-model-config";
import {
  openGlobalClaudeConfig,
  openGlobalCodexConfig,
  readGlobalClaudeConfig,
  syncClaudePermissionsToCodex,
  writeGlobalClaudeConfig,
} from "../lib/tauri";

interface ClaudeConfig {
  permissions?: {
    allow?: string[];
    deny?: string[];
  };
  [key: string]: unknown;
}

export function ClaudeGlobalConfig({ onOptimizeRules }: { onOptimizeRules?: () => void }): JSX.Element {
  const [config, setConfig] = useState<ClaudeConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isSyncingToCodex, setIsSyncingToCodex] = useState(false);

  const [newAllow, setNewAllow] = useState("");
  const [newDeny, setNewDeny] = useState("");

  const [activeEditor, setActiveEditor] = useState<"code" | "cursor" | "antigravity">(() => {
    const saved = localStorage.getItem("atelier_preferred_editor");
    if (saved === "code" || saved === "cursor" || saved === "antigravity") return saved;
    return "code";
  });

  useEffect(() => {
    localStorage.setItem("atelier_preferred_editor", activeEditor);
  }, [activeEditor]);

  const editorNames = {
    code: "VS Code",
    cursor: "Cursor",
    antigravity: "Antigravity",
  };

  useEffect(() => {
    let canceled = false;
    async function load() {
      try {
        const raw = await readGlobalClaudeConfig();
        if (canceled) return;
        const parsed = JSON.parse(raw);
        // Ensure structure exists
        if (!parsed.permissions) parsed.permissions = {};
        if (!parsed.permissions.allow) parsed.permissions.allow = [];
        if (!parsed.permissions.deny) parsed.permissions.deny = [];
        setConfig(parsed);
      } catch (error_) {
        if (!canceled) setError(String(error_));
      }
    }
    void load();

    window.addEventListener("focus", load);
    return () => {
      canceled = true;
      window.removeEventListener("focus", load);
    };
  }, []);

  async function handleSave() {
    if (!config) return;
    setIsSaving(true);

    const sortedConfig: ClaudeConfig = {
      ...config,
      permissions: {
        ...config.permissions,
        allow: [...(config.permissions?.allow ?? [])].toSorted((a, b) => a.localeCompare(b)),
        deny: [...(config.permissions?.deny ?? [])].toSorted((a, b) => a.localeCompare(b)),
      },
    };

    setConfig(sortedConfig);

    try {
      await writeGlobalClaudeConfig(JSON.stringify(sortedConfig, null, 2));
      setError(null);
    } catch (error_) {
      setError(String(error_));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSyncToCodex() {
    if (!config) return;
    setIsSyncingToCodex(true);

    try {
      await syncClaudePermissionsToCodex(
        [...(config.permissions?.allow ?? [])],
        [...(config.permissions?.deny ?? [])],
      );
      setError(null);
    } catch (error_) {
      setError(String(error_));
    } finally {
      setIsSyncingToCodex(false);
    }
  }

  async function handleOpenCodexConfig() {
    try {
      await openGlobalCodexConfig(activeEditor);
      setError(null);
    } catch (error_) {
      setError(String(error_));
    }
  }

  function addAllow() {
    if (!newAllow.trim() || !config) return;
    setConfig({
      ...config,
      permissions: {
        ...config.permissions,
        allow: [...(config.permissions?.allow ?? []), newAllow.trim()],
      },
    });
    setNewAllow("");
  }

  function removeAllow(index: number) {
    if (!config) return;
    const next = [...(config.permissions?.allow ?? [])];
    next.splice(index, 1);
    setConfig({
      ...config,
      permissions: { ...config.permissions, allow: next },
    });
  }

  function addDeny() {
    if (!newDeny.trim() || !config) return;
    setConfig({
      ...config,
      permissions: {
        ...config.permissions,
        deny: [...(config.permissions?.deny ?? []), newDeny.trim()],
      },
    });
    setNewDeny("");
  }

  function removeDeny(index: number) {
    if (!config) return;
    const next = [...(config.permissions?.deny ?? [])];
    next.splice(index, 1);
    setConfig({
      ...config,
      permissions: { ...config.permissions, deny: next },
    });
  }

  if (error) {
    return (
      <div className="flex h-full flex-col p-6">
        <div className="text-destructive font-medium">Error loading config</div>
        <div className="text-muted-foreground text-sm">{error}</div>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center p-6 text-sm">
        Loading configuration...
      </div>
    );
  }

  const allowList = config.permissions?.allow ?? [];
  const denyList = config.permissions?.deny ?? [];
  const parsedModel =
    typeof config.model === "string" ? parseClaudeModelString(config.model) : null;
  const modelCapability = parsedModel
    ? getClaudeModelCapability(parsedModel.baseModel)
    : null;
  const contextWindowOptions = modelCapability?.options ?? [];
  const canSelectContextWindow =
    parsedModel !== null && supportsMultipleContextWindows(parsedModel.baseModel);

  function handleContextWindowChange(value: string) {
    if (!parsedModel) return;

    const nextModel = formatClaudeModelString(
      parsedModel.baseModel,
      value as ClaudeContextWindowValue,
    );
    if (!nextModel) return;

    setConfig({
      ...config,
      model: nextModel,
    });
  }

  return (
    <TooltipProvider>
      <div className="flex relative h-full flex-col overflow-hidden bg-background">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold">Global Configuration</h2>
            <p className="text-muted-foreground text-sm">
              Manage global settings from ~/.claude/settings.json
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex -space-x-px">
              <Button
                variant="outline"
                className="rounded-r-none focus:z-10"
                onClick={() => void openGlobalClaudeConfig(activeEditor)}
                title={`Open in ${editorNames[activeEditor]}`}
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                Editor
                <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[0.65rem] text-muted-foreground">
                  {editorNames[activeEditor]}
                </span>
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" className="w-8 rounded-l-none focus:z-10 border-l-0">
                    <ChevronDown className="h-4 w-4" />
                    <span className="sr-only">Toggle editor options</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setActiveEditor("code")}>
                    VS Code
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setActiveEditor("cursor")}>
                    Cursor
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setActiveEditor("antigravity")}>
                    Antigravity
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {onOptimizeRules ? (
              <Button variant="secondary" onClick={onOptimizeRules}>
                ✨ Optimize Rules
              </Button>
            ) : null}
            <Button
              variant="outline"
              onClick={() => void handleOpenCodexConfig()}
            >
              Open Codex
            </Button>
            <Button
              variant="secondary"
              onClick={() => void handleSyncToCodex()}
              disabled={isSyncingToCodex}
            >
              {isSyncingToCodex ? "Syncing..." : "Sync to Codex"}
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button onClick={() => void handleSave()} disabled={isSaving}>
                  <Save className="mr-2 h-4 w-4" />
                  {isSaving ? "Saving..." : "Save Changes"}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Lists are automatically sorted alphabetically</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl space-y-8">
          <section className="space-y-4">
            <div>
              <h3 className="text-md font-semibold">Context Window</h3>
              <p className="text-muted-foreground text-sm">
                Choose the Claude context window suffix written into ~/.claude/settings.json.
              </p>
            </div>
            {canSelectContextWindow ? (
              <div className="max-w-xs space-y-2">
                <label htmlFor="claude-context-window" className="text-sm font-medium">
                  Context Window
                </label>
                <Select
                  id="claude-context-window"
                  aria-label="Context Window"
                  value={parsedModel.contextWindow}
                  options={contextWindowOptions.map((option) => ({
                    label: option.label,
                    value: option.value,
                  }))}
                  onChange={handleContextWindowChange}
                />
              </div>
            ) : (
              <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                Set a supported Claude model in settings.json to choose a context window.
              </div>
            )}
          </section>

          {/* Allowed Permissions */}
          <section className="space-y-4">
            <div>
              <h3 className="text-md font-semibold">Allowed Permissions</h3>
              <p className="text-muted-foreground text-sm">
                Commands and actions Claude is automatically allowed to perform.
              </p>
            </div>
            <div className="flex space-x-2">
              <Input
                placeholder="e.g. Bash(git:*)"
                value={newAllow}
                onChange={(e) => setNewAllow(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addAllow();
                }}
              />
              <Button variant="secondary" onClick={addAllow}>
                <Plus className="mr-2 h-4 w-4" />
                Add
              </Button>
            </div>
            {allowList.length > 0 ? (
              <ul className="divide-border rounded-md border divide-y">
                {allowList.map((item, index) => (
                  <li
                    key={`${index}-${item}`}
                    className="flex items-center justify-between px-4 py-3 text-sm font-mono"
                  >
                    <span>{item}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => removeAllow(index)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                No allowed permissions defined.
              </div>
            )}
          </section>

          {/* Denied Permissions */}
          <section className="space-y-4">
            <div>
              <h3 className="text-md font-semibold">Denied Permissions</h3>
              <p className="text-muted-foreground text-sm">
                Commands and actions Claude is permanently blocked from performing.
              </p>
            </div>
            <div className="flex space-x-2">
              <Input
                placeholder="e.g. Bash(git push *)"
                value={newDeny}
                onChange={(e) => setNewDeny(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addDeny();
                }}
              />
              <Button variant="secondary" onClick={addDeny}>
                <Plus className="mr-2 h-4 w-4" />
                Add
              </Button>
            </div>
            {denyList.length > 0 ? (
              <ul className="divide-border rounded-md border divide-y">
                {denyList.map((item, index) => (
                  <li
                    key={`${index}-${item}`}
                    className="flex items-center justify-between px-4 py-3 text-sm font-mono"
                  >
                    <span>{item}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => removeDeny(index)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                No denied permissions defined.
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
    </TooltipProvider>
  );
}
