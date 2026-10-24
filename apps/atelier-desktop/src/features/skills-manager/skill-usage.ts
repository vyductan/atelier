import type {
  InstalledSkill,
  SkillUsage,
  SkillUsageReport,
} from "../../lib/skills-client";

export type SkillSort = "name" | "uses" | "last-used";

/** Usage keyed by skill name; the backend already strips `plugin:` prefixes. */
export function indexUsage(
  report: SkillUsageReport | null,
): Map<string, SkillUsage> {
  return new Map(report?.skills.map((usage) => [usage.name, usage]) ?? []);
}

export function usesOf(
  usage: Map<string, SkillUsage>,
  skill: InstalledSkill,
): number {
  return usage.get(skill.name)?.total ?? 0;
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
    const iso = usage.get(skill.name)?.lastUsed;
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

const DAY_MS = 24 * 60 * 60 * 1000;

/** Compact relative date: "today", "3d", "5w", "4mo", "1y"; "never" when unused. */
export function formatLastUsed(iso: string | null | undefined, now: number): string {
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
