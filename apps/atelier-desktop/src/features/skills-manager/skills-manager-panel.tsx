import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  Compass,
  Download,
  Folder,
  HardDrive,
  Search,
  Settings2,
  Trash2,
} from "lucide-react";

import { Input } from "@acme/ui/components/input";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@acme/ui/components/tabs";

import type { InstalledSkill, Skill } from "../../lib/skills-client";
import { skillsClient } from "../../lib/skills-client";
import { installSkill } from "../../lib/tauri";
import { useToastStore } from "../../store/toast-store";
import { SkillListItem } from "./skill-list-item";

const SUPPORTED_AGENTS = [
  { id: "claude-code", name: "Claude Code" },
  { id: "antigravity", name: "Antigravity" },
  { id: "cursor", name: "Cursor" },
  { id: "windsurf", name: "Windsurf" },
  { id: "cline", name: "Cline" },
];

const UNIVERSAL_AGENTS = new Set([
  "antigravity",
  "cursor",
  "windsurf",
  "cline",
]);

const getLocalSkillToolName = (path: string) => {
  const p = path.toLowerCase();
  if (p.includes(".gemini") || p.includes("antigravity"))
    return "Antigravity Skill";
  if (p.includes(".claude")) return "Claude Skill";
  if (p.includes(".cursor")) return "Cursor Skill";
  if (p.includes(".agents")) return "Global CLI Skill";
  return "Workspace Local Skill";
};

export function SkillsManagerPanel() {
  const [activeTab, setActiveTab] = useState("discover");

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
  const [isLoadingInstalled, setIsLoadingInstalled] = useState(false);
  const [installedError, setInstalledError] = useState<string | null>(null);
  const [uninstallingSkillName, setUninstallingSkillName] = useState<
    string | null
  >(null);
  const [togglingAgentId, setTogglingAgentId] = useState<string | null>(null);
  const [detectedAgents, setDetectedAgents] = useState<string[]>([]);

  const { addToast } = useToastStore();
  const [installCounts, setInstallCounts] = useState<Record<string, number>>(
    {},
  );

  useEffect(() => {
    if (installedSkills.length === 0) return;

    const queriesToFetch = new Set<string>();
    for (const s of installedSkills) {
      if (!s.source) continue;
      queriesToFetch.add(s.name);
      if (s.source.includes("/")) {
        queriesToFetch.add(s.source);
      }
    }

    for (const query of queriesToFetch) {
      skillsClient
        .searchSkills(query, 30)
        .then((res) => {
          setInstallCounts((prev) => {
            const next = { ...prev };
            for (const apiSkill of res.skills) {
              // Store by source@name for exact local matching
              if (apiSkill.source && apiSkill.name) {
                const exactKey = `${apiSkill.source}@${apiSkill.name}`;
                next[exactKey] = Math.max(
                  next[exactKey] || 0,
                  apiSkill.installs || 0,
                );
              }
              // Store by name as fallback for unexpected formats
              if (apiSkill.name) {
                next[apiSkill.name] = Math.max(
                  next[apiSkill.name] || 0,
                  apiSkill.installs || 0,
                );
              }
            }
            return next;
          });
        })
        .catch(() => {
          // Silently ignore background fetch errors
        });
    }
  }, [installedSkills]);

  useEffect(() => {
    skillsClient
      .getDetectedAgents()
      .then(setDetectedAgents)
      .catch(console.error);
  }, []);

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

  const fetchInstalledSkills = async () => {
    setIsLoadingInstalled(true);
    setInstalledError(null);
    try {
      const fetchedSkills = await skillsClient.getInstalledSkills();
      setInstalledSkills(fetchedSkills);
    } catch (error_) {
      setInstalledError("Failed to load installed skills.");
      console.error(error_);
    } finally {
      setIsLoadingInstalled(false);
    }
  };

  useEffect(() => {
    if (activeTab === "installed") {
      fetchInstalledSkills();
    }
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
      fetchInstalledSkills();
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

  const handleToggleAgent = async (
    skillSource: string,
    skillName: string,
    agentId: string,
    currentlyEnabled: boolean,
  ) => {
    const toggleKey = `${skillName}-${agentId}`;
    if (togglingAgentId) return;
    setTogglingAgentId(toggleKey);
    try {
      if (currentlyEnabled) {
        await skillsClient.disableSkillForAgent(skillName, agentId);
        addToast(`Disabled ${skillName} for ${agentId}`, "success");
      } else {
        await skillsClient.enableSkillForAgent(skillSource, skillName, agentId);
        addToast(`Enabled ${skillName} for ${agentId}`, "success");
      }
      fetchInstalledSkills();
    } catch (error_: unknown) {
      addToast(
        error_ instanceof Error ? error_.message : "Failed to toggle agent",
        "error",
      );
    } finally {
      setTogglingAgentId(null);
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
    <div className="flex h-full flex-col p-6">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="bg-primary/10 text-primary flex h-12 w-12 items-center justify-center rounded-2xl shadow-sm">
            <Bot className="h-6 w-6" />
          </div>
          <div>
            <h2 className="from-foreground to-muted-foreground bg-linear-to-br bg-clip-text text-2xl font-bold tracking-tight text-transparent">
              Skills Manager
            </h2>
            <p className="text-muted-foreground text-sm">
              Discover and manage skills for AI agents
            </p>
          </div>
        </div>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="flex flex-1 flex-col overflow-hidden"
      >
        <TabsList className="mb-6 grid w-64 grid-cols-2 self-start">
          <TabsTrigger value="discover">Discover</TabsTrigger>
          <TabsTrigger value="installed">My Skills</TabsTrigger>
        </TabsList>

        <TabsContent
          value="discover"
          className="m-0 flex flex-1 flex-col overflow-hidden border-none p-0 outline-none data-[state=inactive]:hidden"
        >
          <div className="mb-8">
            <div className="group relative max-w-2xl">
              <div className="from-primary/30 absolute -inset-0.5 rounded-xl bg-linear-to-r to-violet-500/30 opacity-0 blur transition duration-500 group-focus-within:opacity-100"></div>
              <div className="relative flex items-center">
                <Search className="text-muted-foreground absolute left-4 h-5 w-5" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search skills (e.g. react, postgres, review)..."
                  className="border-muted bg-background ring-offset-background focus-visible:ring-primary/20 h-14 w-full rounded-xl pr-4 pl-12 text-base shadow-sm transition-all focus-visible:ring-2"
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
                    className="bg-muted/40 h-[156px] animate-pulse rounded-xl border"
                  />
                ))}
              </div>
            ) : error ? (
              <div className="bg-destructive/5 text-destructive flex h-64 flex-col items-center justify-center gap-3 rounded-xl border border-dashed text-center">
                <AlertCircle className="h-10 w-10 opacity-70" />
                <p className="text-sm font-medium">{error}</p>
              </div>
            ) : skills.length === 0 ? (
              <div className="bg-muted/20 flex h-64 flex-col items-center justify-center gap-4 rounded-xl border border-dashed text-center">
                <div className="bg-muted/50 flex h-16 w-16 items-center justify-center rounded-full">
                  <Compass className="text-muted-foreground/60 h-8 w-8" />
                </div>
                <div className="max-w-[250px]">
                  <p className="text-muted-foreground text-sm font-medium">
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
                      <Folder className="text-primary/70 h-5 w-5" />
                      <h3 className="text-xl font-semibold tracking-tight">
                        {groupName}
                      </h3>
                      <span className="bg-muted text-muted-foreground ml-2 flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-medium">
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
                            <div className="bg-background/50 absolute inset-0 flex items-center justify-center rounded-xl backdrop-blur-[2px]">
                              <div className="bg-background flex items-center gap-2 rounded-full border px-4 py-2 shadow-lg">
                                <div className="border-primary h-4 w-4 animate-spin rounded-full border-2 border-t-transparent" />
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
          <div className="flex-1 overflow-y-auto pr-2">
            {isLoadingInstalled ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div
                    key={i}
                    className="bg-muted/40 h-[120px] animate-pulse rounded-xl border"
                  />
                ))}
              </div>
            ) : installedError ? (
              <div className="bg-destructive/5 text-destructive flex h-64 flex-col items-center justify-center gap-3 rounded-xl border border-dashed text-center">
                <AlertCircle className="h-10 w-10 opacity-70" />
                <p className="text-sm font-medium">{installedError}</p>
              </div>
            ) : installedSkills.length === 0 ? (
              <div className="bg-muted/20 flex h-64 flex-col items-center justify-center gap-4 rounded-xl border border-dashed text-center">
                <div className="bg-muted/50 flex h-16 w-16 items-center justify-center rounded-full">
                  <Bot className="text-muted-foreground/60 h-8 w-8" />
                </div>
                <div className="max-w-[250px]">
                  <p className="text-muted-foreground text-sm font-medium">
                    You haven't installed any skills yet.
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-10 pb-8">
                {groupedInstalledSkills.map(([groupName, groupSkills]) => (
                  <div key={groupName} className="flex flex-col gap-4">
                    <div className="flex items-center gap-2 px-1">
                      <Folder className="text-primary/70 h-5 w-5" />
                      <h3 className="text-xl font-semibold tracking-tight">
                        {groupName}
                      </h3>
                      <span className="bg-muted text-muted-foreground ml-2 flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-medium">
                        {groupSkills.length}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {groupSkills.map((skill) => {
                        const initial = skill.name.charAt(0).toUpperCase();
                        const isUninstalling =
                          uninstallingSkillName === skill.name;

                        return (
                          <div
                            key={skill.path}
                            className="group bg-card hover:border-border/80 relative flex flex-col gap-4 rounded-xl border p-5 shadow-sm transition-all duration-300 hover:shadow-md"
                          >
                            <div className="flex items-start gap-4">
                              <div className="bg-primary/5 text-primary flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border font-bold">
                                {initial}
                              </div>
                              <div className="flex-1 overflow-hidden">
                                <h3 className="truncate text-lg font-semibold tracking-tight">
                                  {skill.name}
                                </h3>
                                <div className="text-muted-foreground mt-1 flex items-center text-xs">
                                  <div className="border-border/60 mr-3 flex items-center gap-1.5 overflow-hidden border-r pr-3">
                                    <Folder className="text-muted-foreground/70 h-3 w-3 shrink-0" />
                                    <span
                                      className="truncate font-mono"
                                      title={skill.source || skill.path}
                                    >
                                      {skill.source ||
                                        skill.path
                                          .replace(/\/$/, "")
                                          .split("/")
                                          .pop()}
                                    </span>
                                  </div>

                                  {skill.source ? (
                                    (() => {
                                      const count =
                                        installCounts[
                                          `${skill.source}@${skill.name}`
                                        ] ?? installCounts[skill.name];
                                      return count === undefined ? (
                                        <div className="text-muted-foreground/80 flex shrink-0 items-center gap-1">
                                          <CheckCircle2 className="text-primary/70 h-3 w-3" />
                                          <span>Registry</span>
                                        </div>
                                      ) : (
                                        <div className="text-muted-foreground/90 flex shrink-0 items-center gap-1">
                                          <Download className="text-muted-foreground/70 h-3 w-3 shrink-0" />
                                          <span>
                                            {new Intl.NumberFormat("en-US", {
                                              notation: "compact",
                                              maximumFractionDigits: 1,
                                            }).format(count)}{" "}
                                            installs
                                          </span>
                                        </div>
                                      );
                                    })()
                                  ) : (
                                    <div className="flex shrink-0 items-center gap-1 font-medium text-amber-500/90">
                                      <HardDrive className="h-3 w-3 shrink-0" />
                                      <span>
                                        {getLocalSkillToolName(skill.path)}
                                      </span>
                                    </div>
                                  )}
                                </div>
                                {skill.installedAt && (
                                  <div className="text-muted-foreground/60 mt-1 flex items-center gap-3 text-[10px]">
                                    <span>
                                      Installed:{" "}
                                      {new Date(
                                        skill.installedAt,
                                      ).toLocaleDateString()}
                                    </span>
                                    {skill.updatedAt && (
                                      <span>
                                        Updated:{" "}
                                        {new Date(
                                          skill.updatedAt,
                                        ).toLocaleDateString()}
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>

                            <div className="border-muted/50 bg-muted/10 mt-1 flex flex-col gap-2.5 rounded-lg border p-3.5 shadow-sm">
                              <div className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold tracking-wider uppercase">
                                <Settings2 className="h-3.5 w-3.5" />
                                Enabled Tools
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                {SUPPORTED_AGENTS.filter(
                                  (agent) =>
                                    detectedAgents.includes(agent.id) ||
                                    skill.agents.some(
                                      (a) =>
                                        a
                                          .toLowerCase()
                                          .replaceAll(/\s+/g, "-") ===
                                        agent.id.toLowerCase(),
                                    ),
                                ).map((agent) => {
                                  const isUniversal = UNIVERSAL_AGENTS.has(
                                    agent.id,
                                  );
                                  const isEnabled =
                                    isUniversal ||
                                    skill.agents.some(
                                      (a) =>
                                        a
                                          .toLowerCase()
                                          .replaceAll(/\s+/g, "-") ===
                                        agent.id.toLowerCase(),
                                    );
                                  const isToggling =
                                    togglingAgentId ===
                                    `${skill.name}-${agent.id}`;
                                  return (
                                    <button
                                      key={agent.id}
                                      onClick={() =>
                                        handleToggleAgent(
                                          skill.path,
                                          skill.name,
                                          agent.id,
                                          isEnabled,
                                        )
                                      }
                                      disabled={
                                        togglingAgentId !== null || isUniversal
                                      }
                                      className={`group flex items-center justify-between rounded-md border px-2.5 py-2 text-xs font-medium transition-all ${
                                        isEnabled
                                          ? "border-primary/20 bg-primary/5 text-foreground hover:border-primary/40 shadow-sm"
                                          : "border-border/40 bg-background/50 text-muted-foreground hover:bg-muted"
                                      } disabled:pointer-events-none disabled:opacity-50`}
                                      title={
                                        isUniversal
                                          ? `${agent.name} is a Universal Agent and always includes all installed skills.`
                                          : `Click to ${isEnabled ? "disable" : "enable"} ${skill.name} for ${agent.name}`
                                      }
                                    >
                                      <span className="truncate pr-2">
                                        {agent.name}
                                      </span>

                                      {isToggling ? (
                                        <div className="border-primary h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-t-transparent" />
                                      ) : (
                                        <div
                                          className={`relative inline-flex h-3.5 w-6 shrink-0 items-center rounded-full transition-colors duration-200 ease-in-out ${isEnabled ? "bg-primary" : "bg-muted-foreground/30"}`}
                                        >
                                          <span
                                            className={`bg-background inline-block h-2.5 w-2.5 transform rounded-full shadow-sm ring-0 transition duration-200 ease-in-out ${isEnabled ? "translate-x-3" : "translate-x-[2px]"}`}
                                          />
                                        </div>
                                      )}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>

                            <div className="mt-2 flex items-center justify-end border-t pt-4">
                              <button
                                onClick={() => handleUninstall(skill.name)}
                                disabled={isUninstalling}
                                className="border-destructive/20 bg-destructive/5 text-destructive hover:bg-destructive/10 inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors disabled:opacity-50"
                              >
                                {isUninstalling ? (
                                  <div className="border-destructive h-3.5 w-3.5 animate-spin rounded-full border-2 border-t-transparent" />
                                ) : (
                                  <Trash2 className="h-3.5 w-3.5" />
                                )}
                                Uninstall
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
