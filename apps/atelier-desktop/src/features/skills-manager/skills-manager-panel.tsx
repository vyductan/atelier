import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Bot, Compass, Folder, Search } from "lucide-react";

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
import { InstalledSkillsTable } from "./installed-skills-table";
import { SkillListItem } from "./skill-list-item";

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
  const [isLoadingInstalled, setIsLoadingInstalled] = useState(false);
  const [installedError, setInstalledError] = useState<string | null>(null);
  const [uninstallingSkillName, setUninstallingSkillName] = useState<
    string | null
  >(null);
  const [togglingAgentId, setTogglingAgentId] = useState<string | null>(null);
  const [detectedAgents, setDetectedAgents] = useState<string[]>([]);

  const { addToast } = useToastStore();
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
    <div className="flex h-full flex-col px-6 py-5">
      <header className="mb-3 flex items-baseline gap-2">
        <h2 className="text-sm font-semibold">Skills</h2>
        <span className="text-muted-foreground text-xs">
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
          <div className="flex min-h-0 flex-1 flex-col">
            {isLoadingInstalled ? (
              <div className="flex flex-col gap-1.5">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div
                    key={i}
                    className="bg-muted/40 h-8 animate-pulse rounded-md"
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
              <InstalledSkillsTable
                groups={groupedInstalledSkills}
                detectedAgents={detectedAgents}
                togglingAgentId={togglingAgentId}
                uninstallingSkillName={uninstallingSkillName}
                onToggleAgent={(skillPath, skillName, agentId, isEnabled) =>
                  void handleToggleAgent(
                    skillPath,
                    skillName,
                    agentId,
                    isEnabled,
                  )
                }
                onUninstall={(skillName) => void handleUninstall(skillName)}
              />
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
