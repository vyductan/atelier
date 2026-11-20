import { useMemo, useState } from "react";
import {
  ArrowUpCircle,
  Bot,
  ChevronRight,
  RefreshCw,
  Search,
  Server,
  Trash2,
  Webhook,
} from "lucide-react";

import { Input } from "@acme/ui/components/input";

import type { InstalledSkill, SkillUsageReport } from "../../lib/skills-client";
import type { SkillMeta } from "../../lib/tauri";
import type { SkillSort } from "./skill-usage";
import type { SkillUpdates } from "./use-skill-updates";
import {
  countDisabledPlugins,
  groupPlugin,
  PLUGIN_AGENT,
  withDisabledPlugins,
} from "./plugin-groups";
import { SkillContentDrawer } from "./skill-content-drawer";
import {
  describeUsage,
  formatLastUsed,
  indexUsage,
  isCounted,
  sortGroups,
  sortSkills,
  usageKey,
  usesOf,
} from "./skill-usage";

const getLocalSkillToolName = (path: string) => {
  const p = path.toLowerCase();
  if (p.includes(".gemini") || p.includes("antigravity"))
    return "Antigravity Skill";
  if (p.includes(".claude")) return "Claude Skill";
  if (p.includes(".cursor")) return "Cursor Skill";
  if (p.includes(".agents")) return "Global CLI Skill";
  return "Workspace Local Skill";
};

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

function Spinner() {
  return (
    <span className="block size-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
  );
}

/** Track + knob; `mixed` parks the knob mid-track for a partly enabled group. */
function SwitchTrack({ on, mixed = false }: { on: boolean; mixed?: boolean }) {
  return (
    <span
      className={`relative inline-flex h-3.5 w-6 items-center rounded-full transition-colors ${on ? "bg-primary" : mixed ? "bg-primary/45" : "bg-muted-foreground/30"}`}
    >
      <span
        className={`inline-block size-2.5 rounded-full bg-background shadow-sm transition ${on ? "translate-x-3" : mixed ? "translate-x-[7px]" : "translate-x-[2px]"}`}
      />
    </span>
  );
}

/** The switch column that turns a skill off for every agent at once. */
const ALL = "all";

/**
 * A skill's switch in one column, or null when that column does not apply:
 * "all" only moves skills that live in skills.sh's store, and an agent
 * column only parks an entry the agent actually has (and not while the
 * skill is off for everyone).
 */
function cellState(skill: InstalledSkill, column: string): boolean | null {
  if (skill.plugin) return null;
  if (column === ALL) return skill.inStore ? !skill.disabled : null;
  if (skill.disabled) return null;
  const state = skill.agentStates[column];
  return state === undefined ? null : state === "on";
}

function cellUnavailableReason(skill: InstalledSkill, column: string): string {
  if (skill.plugin)
    return `Plugins are Claude Code only: ${skill.plugin.plugin} is switched on its group header.`;
  if (column === ALL)
    return "Not managed by skills.sh: turn it off in its agent's column.";
  if (skill.disabled) return "Off for every agent.";
  return "This agent has no entry for this skill.";
}

const KIND_ICONS = { agent: Bot, mcp: Server, hook: Webhook } as const;
const KIND_LABELS = {
  skill: "Skill",
  command: "Slash command",
  agent: "Subagent",
  mcp: "MCP server",
  hook: "Hook event",
} as const;

function PluginKindIcon({
  kind,
}: {
  kind: "skill" | "command" | "agent" | "mcp" | "hook";
}) {
  const Icon =
    kind in KIND_ICONS ? KIND_ICONS[kind as keyof typeof KIND_ICONS] : null;
  return Icon ? (
    <Icon
      className="mr-1.5 inline size-3.5 -translate-y-px text-muted-foreground"
      aria-label={KIND_LABELS[kind]}
    />
  ) : null;
}

function describePluginItem(
  plugin: NonNullable<InstalledSkill["plugin"]>,
): string {
  if (plugin.kind === "command") return `Slash command · /${plugin.invokeName}`;
  if (plugin.kind === "skill") return `Skill · ${plugin.invokeName}`;
  if (plugin.kind === "agent")
    return `Subagent · subagent_type ${plugin.invokeName}`;
  if (plugin.kind === "mcp")
    return `MCP server · tools mcp__plugin_${plugin.plugin}_${plugin.invokeName.split(":")[1]}__*`;
  return `Hook on ${plugin.invokeName.split(":")[1]} · runs while the plugin is on`;
}

/** Hover text: the whole description, then the other front-matter fields. */
function describeMeta(meta: SkillMeta): string {
  const fields = meta.fields.map(([key, value]) => `${key}: ${value}`);
  return [meta.description, fields.join("\n")].filter(Boolean).join("\n\n");
}

interface InstalledSkillsTableProps {
  groups: [string, InstalledSkill[]][];
  agents: { id: string; name: string }[];
  /** `${skill}:${column}` while that cell's toggle runs. */
  togglingSkillName: string | null;
  /** `${group}:${column}` while a whole-group toggle runs. */
  togglingGroupKey: string | null;
  onSetEnabled: (
    skillNames: string[],
    column: string,
    enabled: boolean,
    groupKey: string | null,
  ) => void;
  uninstallingSkillName: string | null;
  onUninstall: (skillName: string) => void;
  /** Turns a whole Claude Code plugin on or off; `groupKey` spins that header. */
  onSetPluginEnabled: (
    pluginId: string,
    enabled: boolean,
    groupKey: string,
  ) => void;
  /** Null while the history scan runs (or if it failed). */
  usage: SkillUsageReport | null;
  /** Front matter by skill path; empty until read. */
  meta: Record<string, SkillMeta>;
  updates: SkillUpdates;
  onUpdate: (skillNames: string[]) => void;
  /** Reloads the list from disk, for changes made outside Atelier. */
  onRefresh: () => void;
  refreshing: boolean;
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
  agents,
  togglingSkillName,
  togglingGroupKey,
  onSetEnabled,
  uninstallingSkillName,
  onUninstall,
  onSetPluginEnabled,
  usage,
  meta,
  updates,
  onUpdate,
  onRefresh,
  refreshing,
}: InstalledSkillsTableProps) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SkillSort>("uses");
  const [unusedOnly, setUnusedOnly] = useState(false);
  const [grouped, setGrouped] = useState(true);
  const [showDisabledPlugins, setShowDisabledPlugins] = useState(false);
  /** The skill whose files the drawer shows. */
  const [viewing, setViewing] = useState<InstalledSkill | null>(null);
  // Group → expanded? Unset means the default: plugin groups start folded,
  // since one plugin can bring 40 skills; a search unfolds everything.
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(
    {},
  );
  const disabledPlugins = useMemo(() => countDisabledPlugins(groups), [groups]);
  // Disabled plugins reach no agent; ~100 of their skills would bury the rest.
  const visibleGroups = useMemo(
    () => withDisabledPlugins(groups, showDisabledPlugins),
    [groups, showDisabledPlugins],
  );
  const usageIndex = useMemo(() => indexUsage(usage), [usage]);
  const now = Date.now();

  const filteredGroups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle && !unusedOnly) return visibleGroups;
    return visibleGroups
      .map(
        ([group, skills]) =>
          [
            group,
            skills.filter(
              (skill) =>
                (!unusedOnly ||
                  (isCounted(skill) && !usageIndex.has(usageKey(skill)))) &&
                (skill.name.toLowerCase().includes(needle) ||
                  sourceLabel(skill).toLowerCase().includes(needle) ||
                  (meta[skill.path]?.description ?? "")
                    .toLowerCase()
                    .includes(needle) ||
                  group.toLowerCase().includes(needle)),
            ),
          ] as [string, InstalledSkill[]],
      )
      .filter(([, skills]) => skills.length > 0);
  }, [visibleGroups, query, unusedOnly, usageIndex, meta]);

  // Grouped by source by default, with groups ranked by the same sort as
  // their skills (most-used group first); ungrouped is one ranked list.
  const sections = useMemo<[string | null, InstalledSkill[]][]>(
    () =>
      grouped
        ? sortGroups(filteredGroups, sort, usageIndex)
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
    [filteredGroups, grouped, sort, usageIndex],
  );
  const neverUsed = usage
    ? visibleGroups.reduce(
        (sum, [, skills]) =>
          sum +
          skills.filter(
            (skill) => isCounted(skill) && !usageIndex.has(usageKey(skill)),
          ).length,
        0,
      )
    : null;

  const total = visibleGroups.reduce(
    (sum, [, skills]) => sum + skills.length,
    0,
  );
  const shown = filteredGroups.reduce(
    (sum, [, skills]) => sum + skills.length,
    0,
  );
  const columns = [
    ...agents.map((agent) => ({ id: agent.id, name: agent.name })),
    { id: ALL, name: "All agents" },
  ];
  const gridTemplateColumns = `minmax(0, 1fr) 3.5rem 5rem repeat(${columns.length}, 6rem) 2rem`;

  const renderSwitch = ({
    on,
    mixed = false,
    spinning,
    label,
    title,
    onToggle,
  }: {
    on: boolean;
    mixed?: boolean;
    spinning: boolean;
    label: string;
    title: string;
    onToggle: () => void;
  }) => (
    <div className="flex justify-center">
      <button
        type="button"
        role="switch"
        aria-checked={on ? true : mixed ? "mixed" : false}
        aria-label={label}
        onClick={onToggle}
        disabled={togglingSkillName !== null}
        title={title}
        className="rounded-full p-0.5 disabled:cursor-default disabled:opacity-50"
      >
        {spinning ? <Spinner /> : <SwitchTrack on={on} mixed={mixed} />}
      </button>
    </div>
  );

  const renderUnavailable = (key: string, title: string) => (
    <span
      key={key}
      className="text-center text-xs text-muted-foreground/50"
      title={title}
    >
      –
    </span>
  );

  const renderRow = (skill: InstalledSkill, group: string | null) => {
    const isUninstalling = uninstallingSkillName === skill.name;
    const skillUsage = usageIndex.get(usageKey(skill));
    const skillMeta = meta[skill.path];
    // Dim only once usage has loaded, so a slow scan does not flash everything gray.
    const counted = isCounted(skill);
    const isUnused = usage !== null && counted && !skillUsage;
    const isEnabled = !skill.disabled;
    const reachesNoAgent =
      !isEnabled ||
      skill.plugin?.enabled === false ||
      (Object.keys(skill.agentStates).length > 0 &&
        Object.values(skill.agentStates).every((state) => state === "off"));
    return (
      <div
        key={skill.path}
        className="group grid items-center border-b px-3 py-0.5 last:border-b-0 hover:bg-muted/40"
        style={{ gridTemplateColumns }}
      >
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setViewing(skill)}
            // Under a header, line the name up with the group name (chevron 14px + gap 6px).
            className={`block min-w-0 flex-1 cursor-pointer py-0.5 text-left ${group === null ? "" : "pl-5"} ${isUnused || reachesNoAgent ? "opacity-50" : ""}`}
          >
            <span
              className={`flex min-w-0 items-baseline gap-2 ${isEnabled ? "" : "line-through decoration-muted-foreground/50"}`}
              title={formatDates(skill)}
            >
              <span
                className="truncate text-sm font-medium group-hover:underline group-hover:decoration-muted-foreground/40 group-hover:underline-offset-2"
                title={
                  skill.plugin ? describePluginItem(skill.plugin) : undefined
                }
              >
                {skill.plugin && KIND_ICONS[skill.plugin.kind] ? (
                  <PluginKindIcon kind={skill.plugin.kind} />
                ) : null}
                {/* A slash marks a command; the group header already says "plugin". */}
                {skill.plugin?.kind === "command" ? (
                  <span className="text-muted-foreground">/</span>
                ) : null}
                {skill.name}
              </span>
              {/* Under a group header that already names the source, repeating it is noise. */}
              {group === sourceLabel(skill) ? null : (
                <span
                  className={`truncate text-xs ${skill.source ? "font-mono text-muted-foreground" : "text-amber-600/90 dark:text-amber-500/90"}`}
                  title={skill.source ?? skill.path}
                >
                  {sourceLabel(skill)}
                </span>
              )}
            </span>
            {skillMeta?.description ? (
              <span
                className="block truncate text-xs text-muted-foreground"
                title={describeMeta(skillMeta)}
              >
                {skillMeta.description}
              </span>
            ) : skill.plugin?.detail ? (
              <span
                className="block truncate font-mono text-[11px] text-muted-foreground"
                title={skill.plugin.detail.split(" · ").join("\n")}
              >
                {skill.plugin.detail}
              </span>
            ) : null}
          </button>
          {updates.outdated?.has(skill.name) ? (
            <button
              type="button"
              onClick={() => onUpdate([skill.name])}
              disabled={updates.updating !== null}
              title="A newer version is on GitHub: update this skill"
              className="flex shrink-0 items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-1.5 py-px text-[11px] font-medium text-primary hover:bg-primary/20 disabled:cursor-default disabled:opacity-60"
            >
              {updates.updating === skill.name ? (
                <span className="block size-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              ) : (
                <ArrowUpCircle className="size-3" />
              )}
              Update
            </button>
          ) : null}
        </div>

        <span
          className="text-right text-xs tabular-nums"
          title={describeUsage(skillUsage)}
        >
          {usage && counted ? (skillUsage?.total ?? 0) : "–"}
        </span>
        <span
          className="pl-3 text-xs text-muted-foreground tabular-nums"
          title={
            skillUsage?.lastUsed
              ? new Date(skillUsage.lastUsed).toLocaleString()
              : undefined
          }
        >
          {usage && counted ? formatLastUsed(skillUsage?.lastUsed, now) : "–"}
        </span>

        {columns.map((column) => {
          if (skill.plugin && column.id === PLUGIN_AGENT)
            return (
              <span
                key={column.id}
                className="flex justify-center opacity-50"
                title={`Follows the ${skill.plugin.plugin} plugin (${skill.plugin.enabled ? "on" : "off"}); switch it on the group header`}
              >
                <SwitchTrack on={skill.plugin.enabled} />
              </span>
            );
          const on = cellState(skill, column.id);
          if (on === null)
            return renderUnavailable(
              column.id,
              cellUnavailableReason(skill, column.id),
            );
          return (
            <div key={column.id}>
              {renderSwitch({
                on,
                spinning: togglingSkillName === `${skill.name}:${column.id}`,
                label: `${skill.name} for ${column.name}`,
                title:
                  column.id === ALL
                    ? on
                      ? "Turn off for every agent (moves it to ~/.agents/skills-disabled)"
                      : "Turn on for every agent"
                    : `${on ? "Turn off" : "Turn on"} for ${column.name} only`,
                onToggle: () =>
                  onSetEnabled([skill.name], column.id, !on, null),
              })}
            </div>
          );
        })}

        {/* `skills rm` cannot see a skill no agent can reach; turn it on first.
            Plugin skills go with their plugin, so there is nothing to remove here. */}
        {reachesNoAgent || skill.plugin ? (
          <span />
        ) : (
          <button
            type="button"
            onClick={() => onUninstall(skill.name)}
            disabled={isUninstalling}
            aria-label={`Uninstall ${skill.name}`}
            title="Uninstall"
            className="flex size-6 items-center justify-center justify-self-end rounded-md text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 disabled:opacity-100"
          >
            {isUninstalling ? (
              <span className="block size-3.5 animate-spin rounded-full border-2 border-destructive border-t-transparent" />
            ) : (
              <Trash2 className="size-3.5" />
            )}
          </button>
        )}
      </div>
    );
  };

  // Acts on the skills the section shows, so a filter narrows what it flips.
  // Fully on → turn all off; off or mixed → turn the rest on.
  const isCollapsed = (group: string, skills: InstalledSkill[]) =>
    query.trim() === "" &&
    !(expandedGroups[group] ?? groupPlugin(skills) === null);

  const renderGroupHeader = (group: string, skills: InstalledSkill[]) => {
    const plugin = groupPlugin(skills);
    const collapsed = isCollapsed(group, skills);
    const groupUses = skills.reduce(
      (sum, skill) => sum + usesOf(usageIndex, skill),
      0,
    );
    const [pluginName, marketplace] = plugin
      ? plugin.id.split("@")
      : [group, undefined];
    return (
      <h3
        className={`grid items-center border-b bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground ${plugin && !plugin.enabled ? "opacity-60" : ""}`}
        style={{ gridTemplateColumns }}
      >
        <button
          type="button"
          aria-expanded={!collapsed}
          onClick={() =>
            setExpandedGroups((state) => ({ ...state, [group]: collapsed }))
          }
          className="flex min-w-0 items-center gap-1.5 text-left hover:text-foreground"
        >
          <ChevronRight
            className={`size-3.5 shrink-0 transition-transform ${collapsed ? "" : "rotate-90"}`}
          />
          <span className="truncate text-[13px] font-semibold text-foreground">
            {pluginName}
          </span>
          {marketplace ? (
            <span className="truncate text-muted-foreground/70">
              {marketplace}
            </span>
          ) : null}
          {plugin ? (
            <span className="shrink-0 rounded-full bg-muted px-1.5 text-[10px] font-medium tracking-wide uppercase">
              plugin{plugin.enabled ? "" : " · off"}
            </span>
          ) : null}
          <span className="shrink-0 text-muted-foreground/70 tabular-nums">
            {skills.length}
          </span>
        </button>
        <span
          className="text-right tabular-nums"
          title="Uses of every skill in this group"
        >
          {usage ? groupUses : "–"}
        </span>
        {(() => {
          const outdated = skills
            .filter((skill) => updates.outdated?.has(skill.name))
            .map((skill) => skill.name);
          if (outdated.length === 0) return <span />;
          const updatingHere =
            updates.updating !== null && outdated.includes(updates.updating);
          return (
            <button
              type="button"
              onClick={() => onUpdate(outdated)}
              disabled={updates.updating !== null}
              title={`Update ${outdated.join(", ")}`}
              className="ml-3 flex w-fit items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-1.5 py-px text-[11px] font-medium text-primary hover:bg-primary/20 disabled:cursor-default disabled:opacity-60"
            >
              {updatingHere ? (
                <span className="block size-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              ) : (
                <ArrowUpCircle className="size-3" />
              )}
              {outdated.length === 1 ? "Update" : `Update ${outdated.length}`}
            </button>
          );
        })()}
        {columns.map((column) => {
          const plugin =
            column.id === PLUGIN_AGENT ? groupPlugin(skills) : null;
          if (plugin) {
            const groupKey = `${group}:${column.id}`;
            return (
              <div key={column.id}>
                {renderSwitch({
                  on: plugin.enabled,
                  spinning: togglingGroupKey === groupKey,
                  label: `${plugin.id} plugin for ${column.name}`,
                  title: `${plugin.enabled ? "Disable" : "Enable"} the ${plugin.id} plugin (skills, commands, hooks and MCP servers); sessions already open keep it until they reload`,
                  onToggle: () =>
                    onSetPluginEnabled(plugin.id, !plugin.enabled, groupKey),
                })}
              </div>
            );
          }
          const applicable = skills.filter(
            (skill) => cellState(skill, column.id) !== null,
          );
          if (applicable.length === 0) return <span key={column.id} />;
          const onCount = applicable.filter((skill) =>
            cellState(skill, column.id),
          ).length;
          const allOn = onCount === applicable.length;
          const targets = applicable
            .filter((skill) => allOn || !cellState(skill, column.id))
            .map((skill) => skill.name);
          const groupKey = `${group}:${column.id}`;
          return (
            <div key={column.id}>
              {renderSwitch({
                on: allOn,
                mixed: onCount > 0 && !allOn,
                spinning: togglingGroupKey === groupKey,
                label: `All ${group} skills for ${column.name}`,
                title: `${allOn ? "Turn off" : "Turn on"} ${targets.length} for ${column.name} (${onCount}/${applicable.length} on)`,
                onToggle: () =>
                  onSetEnabled(targets, column.id, !allOn, groupKey),
              })}
            </div>
          );
        })}
        <span />
      </h3>
    );
  };

  const sortHeader = (key: SkillSort, className = "") => (
    <button
      type="button"
      onClick={() => setSort(key)}
      aria-pressed={sort === key}
      className={`uppercase hover:text-foreground ${sort === key ? "text-foreground" : ""} ${className}`}
    >
      {SORT_LABELS[key]}
      {sort === key ? (key === "name" ? " ↑" : " ↓") : ""}
    </button>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-3 flex items-center gap-3">
        <div className="relative w-72">
          <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Filter skills…"
            value={query}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
              setQuery(event.target.value)
            }
            className="h-8 pl-8 text-sm"
          />
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          aria-label="Reload skills"
          title="Reload the list (it also reloads when you come back to this window)"
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-default"
        >
          <RefreshCw
            className={`size-3.5 ${refreshing ? "animate-spin" : ""}`}
          />
        </button>
        <span className="text-xs text-muted-foreground">
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
        <button
          type="button"
          aria-pressed={grouped}
          onClick={() => setGrouped((value) => !value)}
          className={`rounded-md border px-2 py-0.5 text-xs ${grouped ? "border-primary/40 bg-primary/10 text-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          Group by source
        </button>
        <button
          type="button"
          onClick={updates.check}
          disabled={updates.checking || updates.updating !== null}
          title={
            updates.error ??
            "Ask skills.sh which skills have a newer version on GitHub"
          }
          className={`flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs disabled:cursor-default ${updates.error ? "border-destructive/40 text-destructive" : "text-muted-foreground hover:text-foreground"}`}
        >
          <RefreshCw
            className={`size-3 ${updates.checking ? "animate-spin" : ""}`}
          />
          {updates.checking
            ? "Checking updates…"
            : updates.error
              ? "Update check failed"
              : updates.outdated === null
                ? "Check updates"
                : updates.outdated.size === 0
                  ? "Up to date"
                  : `${updates.outdated.size} update${updates.outdated.size === 1 ? "" : "s"}`}
        </button>
        {disabledPlugins ? (
          <button
            type="button"
            aria-pressed={showDisabledPlugins}
            onClick={() => setShowDisabledPlugins((value) => !value)}
            title="Show the skills of Claude Code plugins that are switched off, to turn them back on"
            className={`rounded-md border px-2 py-0.5 text-xs ${showDisabledPlugins ? "border-primary/40 bg-primary/10 text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            Disabled plugins ({disabledPlugins})
          </button>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border">
        <div
          className="sticky top-0 z-10 grid items-center border-b bg-muted/60 px-3 py-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase backdrop-blur"
          style={{ gridTemplateColumns }}
        >
          {sortHeader("name", "text-left")}
          {sortHeader("uses", "text-right")}
          {sortHeader("last-used", "pl-3 text-left")}
          {columns.map((column) => (
            <span key={column.id} className="text-center">
              {column.name}
            </span>
          ))}
          <span />
        </div>

        {shown === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            {query ? `No skills match “${query}”.` : "No skills to show."}
          </p>
        ) : null}

        {sections.map(([group, skills]) => (
          <section key={group ?? "all"}>
            {group === null ? null : renderGroupHeader(group, skills)}
            {group !== null && isCollapsed(group, skills)
              ? null
              : skills.map((skill) => renderRow(skill, group))}
          </section>
        ))}
      </div>

      <SkillContentDrawer skill={viewing} onClose={() => setViewing(null)} />
    </div>
  );
}
