import type {
  InstalledSkill,
  SkillUsage,
  SkillUsageReport,
} from "../../lib/skills-client";

export type SkillSort = "name" | "uses" | "last-used";

/**
 * The name history records a skill under: plugin skills are invoked as
 * `plugin:name`, everything else by its bare name.
 */
export function usageKey(skill: InstalledSkill): string {
  return skill.plugin?.invokeName ?? skill.name;
}

/**
 * Whether history counts it at all: skills and slash commands are; a plugin's
 * agents, MCP servers and hooks never show up as invocations, so they get "–"
 * instead of looking unused.
 */
export function isCounted(skill: InstalledSkill): boolean {
  return (
    !skill.plugin ||
    skill.plugin.kind === "skill" ||
    skill.plugin.kind === "command"
  );
}

/** Usage keyed by invoked name (`plugin:name` for plugin skills). */
export function indexUsage(
  report: SkillUsageReport | null,
): Map<string, SkillUsage> {
  return new Map(report?.skills.map((usage) => [usage.name, usage]) ?? []);
}

export function usesOf(
  usage: Map<string, SkillUsage>,
  skill: InstalledSkill,
): number {
  return usage.get(usageKey(skill))?.total ?? 0;
}

/**
 * Orders skills for the flat (ungrouped) views. Ties fall back to the other
 * signal, then the name, so the order is stable across refreshes.
 */
export function sortSkills(
  skills: InstalledSkill[],
  sort: SkillSort,
  usage: Map<string, SkillUsage>,
): InstalledSkill[] {
  const lastUsed = (skill: InstalledSkill) => {
    const iso = usage.get(usageKey(skill))?.lastUsed;
    return iso ? Date.parse(iso) : 0;
  };
  const byName = (a: InstalledSkill, b: InstalledSkill) =>
    a.name.localeCompare(b.name);

  return skills.toSorted((a, b) => {
    if (sort === "uses") {
      return (
        usesOf(usage, b) - usesOf(usage, a) ||
        lastUsed(b) - lastUsed(a) ||
        byName(a, b)
      );
    }
    if (sort === "last-used") {
      return (
        lastUsed(b) - lastUsed(a) ||
        usesOf(usage, b) - usesOf(usage, a) ||
        byName(a, b)
      );
    }
    return byName(a, b);
  });
}

/**
 * Orders groups by the same signal as their skills: total uses, most recent
 * use, or name. Skills inside each group are sorted too. Never-used groups
 * end up last, in name order.
 */
export function sortGroups(
  groups: [string, InstalledSkill[]][],
  sort: SkillSort,
  usage: Map<string, SkillUsage>,
): [string, InstalledSkill[]][] {
  const groupUses = (skills: InstalledSkill[]) =>
    skills.reduce((sum, skill) => sum + usesOf(usage, skill), 0);
  const groupLastUsed = (skills: InstalledSkill[]) =>
    Math.max(
      0,
      ...skills.map((skill) => {
        const iso = usage.get(usageKey(skill))?.lastUsed;
        return iso ? Date.parse(iso) : 0;
      }),
    );

  return groups
    .map(
      ([group, skills]) =>
        [group, sortSkills(skills, sort, usage)] as [string, InstalledSkill[]],
    )
    .toSorted(([nameA, a], [nameB, b]) => {
      const byName = nameA.localeCompare(nameB);
      if (sort === "uses") {
        return (
          groupUses(b) - groupUses(a) ||
          groupLastUsed(b) - groupLastUsed(a) ||
          byName
        );
      }
      if (sort === "last-used") {
        return (
          groupLastUsed(b) - groupLastUsed(a) ||
          groupUses(b) - groupUses(a) ||
          byName
        );
      }
      return byName;
    });
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Compact relative date: "today", "3d", "5w", "4mo", "1y"; "never" when unused. */
export function formatLastUsed(
  iso: string | null | undefined,
  now: number,
): string {
  if (!iso) return "never";
  const days = Math.floor((now - Date.parse(iso)) / DAY_MS);
  if (Number.isNaN(days)) return "never";
  if (days <= 0) return "today";
  if (days < 14) return `${days}d`;
  if (days < 60) return `${Math.floor(days / 7)}w`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}

/** Tooltip breakdown of where the uses came from. */
export function describeUsage(usage: SkillUsage | undefined): string {
  if (!usage) return "Never used in Claude Code or Antigravity history";
  const parts = [
    usage.claudeAuto && `Claude Code loaded it ${usage.claudeAuto}×`,
    usage.claudeSlash && `/${usage.name} typed ${usage.claudeSlash}×`,
    usage.antigravityLoad && `Antigravity loaded it ${usage.antigravityLoad}×`,
  ].filter(Boolean);
  return `${parts.join(" · ")} · ${usage.last30Days} in the last 30 days`;
}
