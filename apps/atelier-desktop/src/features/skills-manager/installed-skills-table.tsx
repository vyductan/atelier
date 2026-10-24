import { useMemo, useState } from "react";
import { Search, Trash2 } from "lucide-react";

import { Input } from "@acme/ui/components/input";

import type { InstalledSkill, SkillUsageReport } from "../../lib/skills-client";
import type { SkillSort } from "./skill-usage";
import {
  describeUsage,
  formatLastUsed,
  indexUsage,
  sortSkills,
} from "./skill-usage";

const SUPPORTED_AGENTS = [
  { id: "claude-code", name: "Claude Code" },
  { id: "antigravity", name: "Antigravity" },
  { id: "cursor", name: "Cursor" },
  { id: "windsurf", name: "Windsurf" },
  { id: "cline", name: "Cline" },
];

/** Agents that always load every installed skill; their toggle is informational. */
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

function hasAgent(skill: InstalledSkill, agentId: string): boolean {
  return skill.agents.some(
    (agent) =>
      agent.toLowerCase().replaceAll(/\s+/g, "-") === agentId.toLowerCase(),
  );
}

function sourceLabel(skill: InstalledSkill): string {
  return skill.source ?? getLocalSkillToolName(skill.path);
}

function formatDates(skill: InstalledSkill): string | undefined {
  if (!skill.installedAt) return undefined;
  const installed = `Installed ${new Date(skill.installedAt).toLocaleDateString()}`;
  return skill.updatedAt
    ? `${installed} · Updated ${new Date(skill.updatedAt).toLocaleDateString()}`
    : installed;
}

interface InstalledSkillsTableProps {
  groups: [string, InstalledSkill[]][];
  detectedAgents: string[];
  togglingAgentId: string | null;
  uninstallingSkillName: string | null;
  onToggleAgent: (
    skillPath: string,
    skillName: string,
    agentId: string,
    isEnabled: boolean,
  ) => void;
  onUninstall: (skillName: string) => void;
  /** Null while the history scan runs (or if it failed). */
  usage: SkillUsageReport | null;
}

const SORT_LABELS: Record<SkillSort, string> = {
  name: "Skill",
  uses: "Uses",
  "last-used": "Last used",
};

/**
 * One row per skill, one toggle column per agent, so a few dozen skills fit
 * on screen and the enabled-for matrix reads at a glance.
 */
export function InstalledSkillsTable({
  groups,
  detectedAgents,
  togglingAgentId,
  uninstallingSkillName,
  onToggleAgent,
  onUninstall,
  usage,
}: InstalledSkillsTableProps) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SkillSort>("uses");
  const [unusedOnly, setUnusedOnly] = useState(false);
  const usageIndex = useMemo(() => indexUsage(usage), [usage]);
  const now = Date.now();

  // Columns follow what is installed on this machine, not what skills claim:
  // the skills CLI keeps reporting an agent while its skills folder lingers
  // after the app is gone (e.g. ~/.codeium/windsurf/skills).
  const agents = useMemo(
    () => SUPPORTED_AGENTS.filter((agent) => detectedAgents.includes(agent.id)),
    [detectedAgents],
  );

  const filteredGroups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle && !unusedOnly) return groups;
    return groups
      .map(
        ([group, skills]) =>
          [
            group,
            skills.filter(
              (skill) =>
                (!unusedOnly || !usageIndex.has(skill.name)) &&
                (skill.name.toLowerCase().includes(needle) ||
                  sourceLabel(skill).toLowerCase().includes(needle) ||
                  group.toLowerCase().includes(needle)),
            ),
          ] as [string, InstalledSkill[]],
      )
      .filter(([, skills]) => skills.length > 0);
  }, [groups, query, unusedOnly, usageIndex]);

  // Grouped by source when sorted by name; one flat ranked list otherwise,
  // since "most used" across groups is the point of the other sorts.
  const sections = useMemo<[string | null, InstalledSkill[]][]>(
    () =>
      sort === "name"
        ? filteredGroups
        : [
            [
              null,
              sortSkills(
                filteredGroups.flatMap(([, skills]) => skills),
                sort,
                usageIndex,
              ),
            ],
          ],
    [filteredGroups, sort, usageIndex],
  );
  const neverUsed = usage
    ? groups.reduce(
        (sum, [, skills]) =>
          sum + skills.filter((skill) => !usageIndex.has(skill.name)).length,
        0,
      )
    : null;

  const total = groups.reduce((sum, [, skills]) => sum + skills.length, 0);
  const shown = filteredGroups.reduce(
    (sum, [, skills]) => sum + skills.length,
    0,
  );
  const gridTemplateColumns = `minmax(0, 1fr) 3.5rem 5rem repeat(${agents.length}, 5.5rem) 2rem`;

  const renderRow = (skill: InstalledSkill) => {
    const isUninstalling = uninstallingSkillName === skill.name;
    const skillUsage = usageIndex.get(skill.name);
    // Dim only once usage has loaded, so a slow scan does not flash everything gray.
    const isUnused = usage !== null && !skillUsage;
    return (
      <div
        key={skill.path}
        className="group hover:bg-muted/40 grid items-center border-b px-3 py-0.5 last:border-b-0"
        style={{ gridTemplateColumns }}
      >
        <div
          className={`flex min-w-0 items-baseline gap-2 ${isUnused ? "opacity-50" : ""}`}
          title={formatDates(skill)}
        >
          <span className="truncate text-sm font-medium">{skill.name}</span>
          <span
            className={`truncate text-xs ${skill.source ? "text-muted-foreground font-mono" : "text-amber-600/90 dark:text-amber-500/90"}`}
            title={skill.source ?? skill.path}
          >
            {sourceLabel(skill)}
          </span>
        </div>

        <span
          className="text-right text-xs tabular-nums"
          title={describeUsage(skillUsage)}
        >
          {usage ? (skillUsage?.total ?? 0) : "–"}
        </span>
        <span
          className="text-muted-foreground pl-3 text-xs tabular-nums"
          title={
            skillUsage?.lastUsed
              ? new Date(skillUsage.lastUsed).toLocaleString()
              : undefined
          }
        >
          {usage ? formatLastUsed(skillUsage?.lastUsed, now) : "–"}
        </span>

        {agents.map((agent) => {
          const isUniversal = UNIVERSAL_AGENTS.has(agent.id);
          const isEnabled = isUniversal || hasAgent(skill, agent.id);
          const isToggling = togglingAgentId === `${skill.name}-${agent.id}`;
          return (
            <div key={agent.id} className="flex justify-center">
              <button
                type="button"
                role="switch"
                aria-checked={isEnabled}
                aria-label={`${skill.name} for ${agent.name}`}
                onClick={() =>
                  onToggleAgent(skill.path, skill.name, agent.id, isEnabled)
                }
                disabled={togglingAgentId !== null || isUniversal}
                title={
                  isUniversal
                    ? `${agent.name} always includes all installed skills.`
                    : `${isEnabled ? "Disable" : "Enable"} for ${agent.name}`
                }
                className="rounded-full p-0.5 disabled:cursor-default disabled:opacity-50"
              >
                {isToggling ? (
                  <span className="border-primary block size-3.5 animate-spin rounded-full border-2 border-t-transparent" />
                ) : (
                  <span
                    className={`relative inline-flex h-3.5 w-6 items-center rounded-full transition-colors ${isEnabled ? "bg-primary" : "bg-muted-foreground/30"}`}
                  >
                    <span
                      className={`bg-background inline-block size-2.5 rounded-full shadow-sm transition ${isEnabled ? "translate-x-3" : "translate-x-[2px]"}`}
                    />
                  </span>
                )}
              </button>
            </div>
          );
        })}

        <button
          type="button"
          onClick={() => onUninstall(skill.name)}
          disabled={isUninstalling}
          aria-label={`Uninstall ${skill.name}`}
          title="Uninstall"
          className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 flex size-6 items-center justify-center justify-self-end rounded-md opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100 disabled:opacity-100"
        >
          {isUninstalling ? (
            <span className="border-destructive block size-3.5 animate-spin rounded-full border-2 border-t-transparent" />
          ) : (
            <Trash2 className="size-3.5" />
          )}
        </button>
      </div>
    );
  };

  const sortHeader = (key: SkillSort, className = "") => (
    <button
      type="button"
      onClick={() => setSort(key)}
      aria-pressed={sort === key}
      className={`hover:text-foreground uppercase ${sort === key ? "text-foreground" : ""} ${className}`}
    >
      {SORT_LABELS[key]}
      {sort === key ? (key === "name" ? " ↑" : " ↓") : ""}
    </button>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-3 flex items-center gap-3">
        <div className="relative w-72">
          <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
          <Input
            placeholder="Filter skills…"
            value={query}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
              setQuery(event.target.value)
            }
            className="h-8 pl-8 text-sm"
          />
        </div>
        <span className="text-muted-foreground text-xs">
          {shown === total ? `${total} skills` : `${shown} of ${total} skills`}
          {neverUsed === null ? null : ` · ${neverUsed} never used`}
          {usage?.since
            ? ` · since ${new Date(usage.since).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`
            : null}
        </span>
        {neverUsed ? (
          <button
            type="button"
            aria-pressed={unusedOnly}
            onClick={() => setUnusedOnly((value) => !value)}
            className={`rounded-md border px-2 py-0.5 text-xs ${unusedOnly ? "border-primary/40 bg-primary/10 text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            Unused only
          </button>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border">
        <div
          className="bg-muted/60 text-muted-foreground sticky top-0 z-10 grid items-center border-b px-3 py-1.5 text-[11px] font-medium tracking-wide uppercase backdrop-blur"
          style={{ gridTemplateColumns }}
        >
          {sortHeader("name", "text-left")}
          {sortHeader("uses", "text-right")}
          {sortHeader("last-used", "pl-3 text-left")}
          {agents.map((agent) => (
            <span key={agent.id} className="text-center">
              {agent.name}
            </span>
          ))}
          <span />
        </div>

        {shown === 0 ? (
          <p className="text-muted-foreground px-3 py-6 text-center text-sm">
            {query ? `No skills match “${query}”.` : "No skills to show."}
          </p>
        ) : null}

        {sections.map(([group, skills]) => (
          <section key={group ?? "all"}>
            {group === null ? null : (
              <h3 className="bg-background text-muted-foreground flex items-center gap-2 border-b px-3 pt-2.5 pb-1 text-xs font-medium">
                {group}
                <span className="text-muted-foreground/70">
                  {skills.length}
                </span>
              </h3>
            )}
            {skills.map(renderRow)}
          </section>
        ))}
      </div>
    </div>
  );
}
