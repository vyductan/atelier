import type { InstalledSkill } from "../../lib/skills-client";

/** The agent column a plugin's switch lives in: plugins are Claude Code only. */
export const PLUGIN_AGENT = "claude-code";

export function pluginId(skill: InstalledSkill): string | null {
  return skill.plugin
    ? `${skill.plugin.plugin}@${skill.plugin.marketplace}`
    : null;
}

/**
 * The plugin a group stands for, when every skill in it comes from that one
 * plugin; its header then carries the plugin's on/off switch.
 */
export function groupPlugin(
  skills: InstalledSkill[],
): { id: string; enabled: boolean } | null {
  const first = skills[0];
  const id = first ? pluginId(first) : null;
  if (!first?.plugin || !id) return null;
  if (!skills.every((skill) => pluginId(skill) === id)) return null;
  return { id, enabled: first.plugin.enabled };
}

export function isFromDisabledPlugin(skill: InstalledSkill): boolean {
  return skill.plugin?.enabled === false;
}

/** Drops disabled plugins' skills (and groups left empty) unless asked to show them. */
export function withDisabledPlugins(
  groups: [string, InstalledSkill[]][],
  show: boolean,
): [string, InstalledSkill[]][] {
  if (show) return groups;
  return groups
    .map(
      ([group, skills]) =>
        [group, skills.filter((skill) => !isFromDisabledPlugin(skill))] as [
          string,
          InstalledSkill[],
        ],
    )
    .filter(([, skills]) => skills.length > 0);
}

/** How many distinct plugins are switched off. */
export function countDisabledPlugins(
  groups: [string, InstalledSkill[]][],
): number {
  const ids = new Set<string>();
  for (const [, skills] of groups)
    for (const skill of skills)
      if (isFromDisabledPlugin(skill)) ids.add(pluginId(skill) ?? "");
  return ids.size;
}

/** The list with one plugin switched on or off; other skills keep their identity. */
export function setPluginFlag(
  skills: InstalledSkill[],
  id: string,
  enabled: boolean,
): InstalledSkill[] {
  return skills.map((skill) =>
    skill.plugin && pluginId(skill) === id
      ? { ...skill, plugin: { ...skill.plugin, enabled } }
      : skill,
  );
}
