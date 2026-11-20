import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Bot, Compass, Folder, Search } from "lucide-react";

import { Input } from "@acme/ui/components/input";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@acme/ui/components/tabs";

import type {
  InstalledSkill,
  Skill,
  SkillUsageReport,
} from "../../lib/skills-client";
import type { SkillMeta } from "../../lib/tauri";
import { skillsClient } from "../../lib/skills-client";
import { installSkill } from "../../lib/tauri";
import { useToastStore } from "../../store/toast-store";
import { InstalledSkillsTable } from "./installed-skills-table";
import { setPluginFlag } from "./plugin-groups";
import { SkillListItem } from "./skill-list-item";
import { useSkillUpdates } from "./use-skill-updates";

export function SkillsManagerPanel() {
  const [activeTab, setActiveTab] = useState("installed");

  // Discover state
  const [searchQuery, setSearchQuery] = useState("");
  const [skills, setSkills] = useState<Skill[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installingSkillId, setInstallingSkillId] = useState<string | null>(
    null,
  );

  // Installed state
  const [installedSkills, setInstalledSkills] = useState<InstalledSkill[]>([]);
  const [skillAgents, setSkillAgents] = useState<
    { id: string; name: string }[]
  >([]);
  const [skillUsage, setSkillUsage] = useState<SkillUsageReport | null>(null);
  const [skillMeta, setSkillMeta] = useState<Record<string, SkillMeta>>({});
  const [isLoadingInstalled, setIsLoadingInstalled] = useState(false);
  const [installedError, setInstalledError] = useState<string | null>(null);
  const [uninstallingSkillName, setUninstallingSkillName] = useState<
    string | null
  >(null);
  const [togglingSkillName, setTogglingSkillName] = useState<string | null>(
    null,
  );
  const [togglingGroupKey, setTogglingGroupKey] = useState<string | null>(null);

  const { addToast } = useToastStore();
  const skillUpdates = useSkillUpdates(activeTab === "installed");

  const handleUpdate = async (skillNames: string[]) => {
    if (skillUpdates.updating || skillNames.length === 0) return;
    const failed = await skillUpdates.update(skillNames);
    const done = skillNames.length - failed.length;
    if (failed.length === 0)
      addToast(
        skillNames.length === 1
          ? `Updated ${skillNames[0]}`
          : `Updated ${done} skills`,
        "success",
      );
    else
      addToast(
        `Updated ${done} of ${skillNames.length}; failed: ${failed.join(", ")}`,
        "error",
      );
    void fetchInstalledSkills({ quiet: true });
  };
  useEffect(() => {
    let cancelled = false;
    const loadSkills = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await skillsClient.searchSkills(searchQuery, 20);
        if (!cancelled) {
          setSkills(response.skills);
        }
      } catch (error_) {
        if (!cancelled) {
          setError("Failed to fetch skills. Please try again.");
          console.error(error_);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    const handler = setTimeout(loadSkills, 300);
    return () => {
      cancelled = true;
      clearTimeout(handler);
    };
  }, [searchQuery]);

  /**
   * `quiet` refreshes after a change without the skeleton: the table stays
   * mounted (folds, search, scroll survive) and history is not rescanned,
   * since a toggle does not change usage.
   */
  const fetchInstalledSkills = async ({ quiet = false } = {}) => {
    if (!quiet) {
      setIsLoadingInstalled(true);
      setInstalledError(null);
      // Usage is extra information: it loads alongside, and a failed history
      // scan leaves the columns at "–" instead of blocking the list.
      skillsClient
        .getSkillUsage()
        .then(setSkillUsage)
        .catch((error: unknown) => {
          console.error("Failed to count skill usage:", error);
        });
    }
    try {
      const fetched = await skillsClient.getInstalledSkills();
      setInstalledSkills(fetched.skills);
      // Descriptions are extra too: rows show without them until they arrive.
      skillsClient
        .getSkillMeta(fetched.skills.map((skill) => skill.path))
        .then(setSkillMeta)
        .catch((error: unknown) => {
          console.error("Failed to read skill descriptions:", error);
        });
      setSkillAgents(fetched.agents);
    } catch (error_) {
      // A failed quiet refresh keeps the list it has rather than blanking it.
      if (!quiet) setInstalledError("Failed to load installed skills.");
      console.error(error_);
    } finally {
      if (!quiet) setIsLoadingInstalled(false);
    }
  };

  useEffect(() => {
    if (activeTab === "installed") {
      fetchInstalledSkills();
    }
  }, [activeTab]);

  // Skills also change outside Atelier (`skills add`, a plugin installed in
  // Claude Code, relink-skills.sh), so the list reloads on request and when
  // the window comes back to the front. Quietly: folds, filter and scroll
  // stay. Usage is rescanned too, since new sessions may have run meanwhile.
  const [isRefreshing, setIsRefreshing] = useState(false);
  const lastRefresh = useRef(0);
  const refreshInstalled = async () => {
    if (isRefreshing) return;
    lastRefresh.current = Date.now();
    setIsRefreshing(true);
    try {
      await Promise.all([
        fetchInstalledSkills({ quiet: true }),
        skillsClient
          .getSkillUsage()
          .then(setSkillUsage)
          .catch((error: unknown) => {
            console.error("Failed to count skill usage:", error);
          }),
      ]);
    } finally {
      setIsRefreshing(false);
    }
  };
  // The focus listener reads these through refs so it is bound once per tab.
  const refreshRef = useRef(refreshInstalled);
  const busyRef = useRef(false);
  useEffect(() => {
    refreshRef.current = refreshInstalled;
    busyRef.current = Boolean(
      togglingSkillName || uninstallingSkillName || skillUpdates.updating,
    );
  });

  useEffect(() => {
    if (activeTab !== "installed") return;
    const onFocus = () => {
      // Focus can fire twice (window + document); one reload is enough, and
      // leave a toggle or update that is running to refresh on its own.
      if (Date.now() - lastRefresh.current < 3000) return;
      if (busyRef.current) return;
      void refreshRef.current();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [activeTab]);

  const handleInstall = async (skill: Skill) => {
    if (installingSkillId) return;
    setInstallingSkillId(skill.skillId);
    try {
      await installSkill(skill.source);
      addToast(`Successfully installed ${skill.name}.`, "success");
    } catch (error_: unknown) {
      addToast(
        error_ instanceof Error
          ? error_.message
          : "Failed to install the skill.",
        "error",
      );
    } finally {
      setInstallingSkillId(null);
    }
  };

  const handleUninstall = async (skillName: string) => {
    if (uninstallingSkillName) return;
    setUninstallingSkillName(skillName);
    try {
      await skillsClient.uninstallSkill(skillName);
      addToast(`Successfully uninstalled ${skillName}`, "success");
      void fetchInstalledSkills({ quiet: true });
    } catch (error_: unknown) {
      addToast(
        error_ instanceof Error
          ? error_.message
          : `Failed to uninstall ${skillName}`,
        "error",
      );
    } finally {
      setUninstallingSkillName(null);
    }
  };

  // column "all" moves the skill out of ~/.agents/skills (off for every
  // agent); an agent id parks only that agent's entry. Runs one skill at a
  // time: an all-agents move rewrites the shared lock file, and parallel
  // writes would drop entries. Cells spin in turn, keyed `${name}:${column}`.
  const handleSetEnabled = async (
    skillNames: string[],
    column: string,
    enabled: boolean,
    groupKey: string | null,
  ) => {
    if (togglingSkillName || skillNames.length === 0) return;
    setTogglingGroupKey(groupKey);
    const failed: string[] = [];
    for (const name of skillNames) {
      setTogglingSkillName(`${name}:${column}`);
      try {
        await (column === "all"
          ? skillsClient.setSkillEnabled(name, enabled)
          : skillsClient.setSkillForAgent(name, column, enabled));
      } catch (error_: unknown) {
        console.error(error_);
        failed.push(
          error_ instanceof Error && skillNames.length === 1
            ? error_.message
            : name,
        );
      }
    }
    setTogglingSkillName(null);
    setTogglingGroupKey(null);
    const agentName = skillAgents.find((agent) => agent.id === column)?.name;
    const verb = `${enabled ? "Enabled" : "Disabled"}${agentName ? ` for ${agentName}:` : ""}`;
    const done = skillNames.length - failed.length;
    if (failed.length === 0) {
      addToast(
        skillNames.length === 1
          ? `${verb} ${skillNames[0]}`
          : `${verb} ${done} skills`,
        "success",
      );
    } else {
      addToast(
        skillNames.length === 1
          ? (failed[0] ?? "Failed")
          : `${verb} ${done} of ${skillNames.length}; failed: ${failed.join(", ")}`,
        "error",
      );
    }
    void fetchInstalledSkills({ quiet: true });
  };

  const handleSetPluginEnabled = async (
    pluginId: string,
    enabled: boolean,
    groupKey: string,
  ) => {
    if (togglingSkillName || togglingGroupKey) return;
    setTogglingGroupKey(groupKey);
    // Blocks every other switch while the CLI rewrites settings.json.
    setTogglingSkillName(`plugin:${pluginId}`);
    try {
      await skillsClient.setPluginEnabled(pluginId, enabled);
      // Only the plugin's flag changed: flip it in place, no rescan.
      setInstalledSkills((skills) => setPluginFlag(skills, pluginId, enabled));
      addToast(
        `${enabled ? "Enabled" : "Disabled"} ${pluginId} for new Claude Code sessions`,
        "success",
      );
    } catch (error_: unknown) {
      console.error(error_);
      addToast(
        error_ instanceof Error
          ? error_.message
          : `Failed to toggle ${pluginId}`,
        "error",
      );
    } finally {
      setTogglingSkillName(null);
      setTogglingGroupKey(null);
    }
  };

  const groupedInstalledSkills = useMemo(() => {
    const groups: Record<string, InstalledSkill[]> = {};
    for (const skill of installedSkills) {
      let groupName = "Workspace Skills";
      const path = skill.path.toLowerCase();

      if (skill.source === "obra/superpowers") {
        groupName = "Obra Superpowers";
      } else if (skill.source) {
        groupName = skill.source;
      } else if (path.includes("/superpowers") || path.includes("/obra/")) {
        groupName = "Obra Superpowers";
      } else if (path.includes(".gemini") || path.includes("antigravity")) {
        groupName = "Google Gemini / Antigravity";
      } else if (path.includes(".claude")) {
        groupName = "Anthropic Claude";
      } else if (path.includes(".agents")) {
        groupName = "Global Agents";
      } else {
        const parts = skill.path.replace(/\/$/, "").split("/");
        if (parts.length >= 3 && parts.at(-2) === "skills") {
          const parentDir = parts.at(-3) || "";
          if (parentDir) {
            groupName =
              parentDir.charAt(0).toUpperCase() +
              parentDir.slice(1) +
              " Skills";
          }
        }
      }

      const targetGroup = groups[groupName] || [];
      if (!groups[groupName]) {
        groups[groupName] = targetGroup;
      }
      targetGroup.push(skill);
    }

    return Object.entries(groups).toSorted(([a], [b]) => {
      if (a === "Obra Superpowers") return -1;
      if (b === "Obra Superpowers") return 1;
      return a.localeCompare(b);
    });
  }, [installedSkills]);

  const groupedDiscoverSkills = useMemo(() => {
    const groups: Record<string, Skill[]> = {};
    for (const skill of skills) {
      let groupName = "Other Skills";

      if (skill.skillId && skill.skillId.includes("@")) {
        const parts = skill.skillId.split("@");
        groupName = parts[0] || "Unknown";
      } else if (skill.source) {
        groupName = skill.source;
      }

      const targetGroup = groups[groupName] || [];
      if (!groups[groupName]) {
        groups[groupName] = targetGroup;
      }
      targetGroup.push(skill);
    }

    return Object.entries(groups).toSorted(([a], [b]) => {
      if (a === "obra/superpowers") return -1;
      if (b === "obra/superpowers") return 1;
      return a.localeCompare(b);
    });
  }, [skills]);

  return (
    <div className="flex h-full flex-col px-6 py-5">
      <header className="mb-3 flex items-baseline gap-2">
        <h2 className="text-sm font-semibold">Skills</h2>
        <span className="text-xs text-muted-foreground">
          Manage skills for AI agents
        </span>
      </header>

      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="flex flex-1 flex-col overflow-hidden"
      >
        <TabsList className="mb-3 grid w-64 grid-cols-2 self-start">
          <TabsTrigger value="installed">My Skills</TabsTrigger>
          <TabsTrigger value="discover">Discover</TabsTrigger>
        </TabsList>

        <TabsContent
          value="discover"
          className="m-0 flex flex-1 flex-col overflow-hidden border-none p-0 outline-none data-[state=inactive]:hidden"
        >
          <div className="mb-8">
            <div className="group relative max-w-2xl">
              <div className="absolute -inset-0.5 rounded-xl bg-linear-to-r from-primary/30 to-violet-500/30 opacity-0 blur transition duration-500 group-focus-within:opacity-100"></div>
              <div className="relative flex items-center">
                <Search className="absolute left-4 h-5 w-5 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search skills (e.g. react, postgres, review)..."
                  className="h-14 w-full rounded-xl border-muted bg-background pr-4 pl-12 text-base shadow-sm ring-offset-background transition-all focus-visible:ring-2 focus-visible:ring-primary/20"
                />
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto pr-2">
            {isLoading && skills.length === 0 ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-[156px] animate-pulse rounded-xl border bg-muted/40"
                  />
                ))}
              </div>
            ) : error ? (
              <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-xl border border-dashed bg-destructive/5 text-center text-destructive">
                <AlertCircle className="h-10 w-10 opacity-70" />
                <p className="text-sm font-medium">{error}</p>
              </div>
            ) : skills.length === 0 ? (
              <div className="flex h-64 flex-col items-center justify-center gap-4 rounded-xl border border-dashed bg-muted/20 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted/50">
                  <Compass className="h-8 w-8 text-muted-foreground/60" />
                </div>
                <div className="max-w-[250px]">
                  <p className="text-sm font-medium text-muted-foreground">
                    {searchQuery.trim().length < 2
                      ? "Type at least 2 characters to discover new agent skills..."
                      : `No skills found matching "${searchQuery}"`}
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-10 pb-8">
                {groupedDiscoverSkills.map(([groupName, groupSkills]) => (
                  <div key={groupName} className="flex flex-col gap-4">
                    <div className="flex items-center gap-2 px-1">
                      <Folder className="h-5 w-5 text-primary/70" />
                      <h3 className="text-xl font-semibold tracking-tight">
                        {groupName}
                      </h3>
                      <span className="ml-2 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-muted px-1.5 text-[10px] font-medium text-muted-foreground">
                        {groupSkills.length}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {groupSkills.map((skill) => (
                        <div key={skill.id} className="relative">
                          <SkillListItem
                            skill={skill}
                            onInstall={handleInstall}
                          />
                          {installingSkillId === skill.skillId && (
                            <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-background/50 backdrop-blur-[2px]">
                              <div className="flex items-center gap-2 rounded-full border bg-background px-4 py-2 shadow-lg">
                                <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                                <span className="text-sm font-medium">
                                  Installing...
                                </span>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent
          value="installed"
          className="m-0 flex flex-1 flex-col overflow-hidden border-none p-0 outline-none data-[state=inactive]:hidden"
        >
          <div className="flex min-h-0 flex-1 flex-col">
            {isLoadingInstalled ? (
              <div className="flex flex-col gap-1.5">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-8 animate-pulse rounded-md bg-muted/40"
                  />
                ))}
              </div>
            ) : installedError ? (
              <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-xl border border-dashed bg-destructive/5 text-center text-destructive">
                <AlertCircle className="h-10 w-10 opacity-70" />
                <p className="text-sm font-medium">{installedError}</p>
              </div>
            ) : installedSkills.length === 0 ? (
              <div className="flex h-64 flex-col items-center justify-center gap-4 rounded-xl border border-dashed bg-muted/20 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted/50">
                  <Bot className="h-8 w-8 text-muted-foreground/60" />
                </div>
                <div className="max-w-[250px]">
                  <p className="text-sm font-medium text-muted-foreground">
                    You haven't installed any skills yet.
                  </p>
                </div>
              </div>
            ) : (
              <InstalledSkillsTable
                groups={groupedInstalledSkills}
                agents={skillAgents}
                togglingSkillName={togglingSkillName}
                togglingGroupKey={togglingGroupKey}
                onSetEnabled={(skillNames, column, enabled, groupKey) =>
                  void handleSetEnabled(skillNames, column, enabled, groupKey)
                }
                uninstallingSkillName={uninstallingSkillName}
                onUninstall={(skillName) => void handleUninstall(skillName)}
                onSetPluginEnabled={(pluginId, enabled, groupKey) =>
                  void handleSetPluginEnabled(pluginId, enabled, groupKey)
                }
                usage={skillUsage}
                meta={skillMeta}
                updates={skillUpdates}
                onUpdate={(skillNames) => void handleUpdate(skillNames)}
                refreshing={isRefreshing}
                onRefresh={() => void refreshInstalled()}
              />
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
