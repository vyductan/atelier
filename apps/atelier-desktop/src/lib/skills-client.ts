import type { PluginSkill } from "./tauri";
import {
  disableSkillForAgent as disableSkillForAgentTauri,
  disableSkill as disableSkillTauri,
  enableSkillForAgent as enableSkillForAgentTauri,
  enableSkill as enableSkillTauri,
  getDetectedAgents as getDetectedAgentsTauri,
  getInstalledSkills as getInstalledSkillsTauri,
  getPluginSkills,
  getSkillAgentStates,
  getSkillMeta,
  getSkillUsage as getSkillUsageTauri,
  listDisabledSkills as listDisabledSkillsTauri,
  searchSkills,
  setPluginEnabled as setPluginEnabledTauri,
  setSkillForAgent as setSkillForAgentTauri,
  uninstallSkill as uninstallSkillTauri,
} from "./tauri";

export interface Skill {
  id: string;
  skillId: string;
  name: string;
  installs: number;
  source: string;
}

export interface SearchSkillsResponse {
  query: string;
  searchType: string;
  skills: Skill[];
  count: number;
  duration_ms: number;
}

/** Mirrors src-tauri/src/features/skills/usage.rs. */
export interface SkillUsage {
  name: string;
  claudeAuto: number;
  claudeSlash: number;
  antigravityLoad: number;
  antigravityRequest: number;
  total: number;
  last30Days: number;
  lastUsed: string | null;
}

export interface SkillUsageReport {
  skills: SkillUsage[];
  since: string | null;
  scannedFiles: number;
}

export interface InstalledSkill {
  name: string;
  path: string;
  scope: string;
  agents: string[];
  source?: string;
  installedAt?: string;
  updatedAt?: string;
  /** Moved to ~/.agents/skills-disabled: hidden from every agent. */
  disabled?: boolean;
  /** Lives in skills.sh's store, so the all-agents switch applies to it. */
  inStore: boolean;
  /** agent id → "on" | "off"; a missing agent has no entry for this skill. */
  agentStates: Record<string, "on" | "off">;
  /** Set when a Claude Code plugin ships it: read-only, owned by the plugin manager. */
  plugin?: Pick<
    PluginSkill,
    "plugin" | "marketplace" | "kind" | "invokeName" | "enabled" | "detail"
  >;
}

function fromPlugin(skill: PluginSkill): InstalledSkill {
  return {
    name: skill.name,
    path: skill.path,
    scope: "global",
    agents: ["claude-code"],
    source: `${skill.plugin}@${skill.marketplace}`,
    installedAt: skill.installedAt ?? undefined,
    updatedAt: skill.updatedAt ?? undefined,
    inStore: false,
    agentStates: {},
    plugin: {
      plugin: skill.plugin,
      marketplace: skill.marketplace,
      kind: skill.kind,
      invokeName: skill.invokeName,
      enabled: skill.enabled,
      detail: skill.detail,
    },
  };
}

export interface InstalledSkillsResult {
  skills: InstalledSkill[];
  /** Agents installed on this machine, one table column each. */
  agents: { id: string; name: string }[];
}

export const skillsClient = {
  async searchSkills(query = "", limit = 20): Promise<SearchSkillsResponse> {
    if (query.trim().length < 2) {
      return {
        query,
        searchType: "empty",
        skills: [],
        count: 0,
        duration_ms: 0,
      };
    }

    try {
      const resultString = await searchSkills(query, limit);
      const data = JSON.parse(resultString) as
        SearchSkillsResponse | { error: string };
      if ("error" in data) {
        throw new Error(data.error, { cause: "API returned an error" });
      }
      return data;
    } catch (error) {
      throw new Error(
        `Failed to fetch skills: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  },

  /** Description and other front matter, keyed by skill path. */
  async getSkillMeta(paths: string[]) {
    return await getSkillMeta(paths);
  },

  async getSkillUsage(): Promise<SkillUsageReport> {
    return await getSkillUsageTauri();
  },

  async getInstalledSkills(): Promise<InstalledSkillsResult> {
    try {
      const [resultString, disabled, states, pluginSkills] = await Promise.all([
        getInstalledSkillsTauri(),
        listDisabledSkillsTauri(),
        getSkillAgentStates(),
        // Extra rows: an unreadable plugin manifest must not hide the rest.
        getPluginSkills().catch((error: unknown) => {
          console.error("Failed to list plugin skills:", error);
          return [];
        }),
      ]);
      const installed = resultString
        ? (JSON.parse(resultString) as Omit<
            InstalledSkill,
            "inStore" | "agentStates"
          >[])
        : [];
      const withStates = (
        skill: Omit<InstalledSkill, "inStore" | "agentStates">,
      ): InstalledSkill => ({
        ...skill,
        inStore:
          skill.path.includes("/.agents/skills/") || skill.disabled === true,
        agentStates: states.skills[skill.name] ?? {},
      });
      // `skills ls` no longer sees disabled or parked skills, so they come from disk.
      const listed = new Set([
        ...installed.map((s) => s.name),
        ...disabled.map((s) => s.name),
      ]);
      const skills = [
        ...installed,
        ...disabled.map((skill) => ({
          name: skill.name,
          path: skill.path,
          scope: "global",
          agents: [],
          source: skill.source ?? undefined,
          installedAt: skill.installedAt ?? undefined,
          updatedAt: skill.updatedAt ?? undefined,
          disabled: true,
        })),
        ...states.parked
          .filter((skill) => !listed.has(skill.name))
          .map((skill) => ({
            name: skill.name,
            path: skill.path,
            scope: "global",
            agents: [],
          })),
      ].map(withStates);
      return {
        skills: [
          ...skills,
          // Disabled plugins come too; the table hides them behind a filter.
          ...pluginSkills.map(fromPlugin),
        ],
        agents: states.agents,
      };
    } catch (error) {
      throw new Error(
        `Failed to get installed skills: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  },

  async setPluginEnabled(pluginId: string, enabled: boolean): Promise<void> {
    try {
      await setPluginEnabledTauri(pluginId, enabled);
    } catch (error) {
      throw new Error(
        `Failed to ${enabled ? "enable" : "disable"} ${pluginId}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  },

  async uninstallSkill(skillName: string): Promise<void> {
    try {
      await uninstallSkillTauri(skillName);
    } catch (error) {
      throw new Error(
        `Failed to uninstall skill: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  },

  async enableSkillForAgent(
    skillSource: string,
    skillName: string,
    agentName: string,
  ): Promise<void> {
    try {
      await enableSkillForAgentTauri(skillSource, skillName, agentName);
    } catch (error) {
      throw new Error(
        `Failed to enable skill for agent: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  },

  async disableSkillForAgent(
    skillName: string,
    agentName: string,
  ): Promise<void> {
    try {
      await disableSkillForAgentTauri(skillName, agentName);
    } catch (error) {
      throw new Error(
        `Failed to disable skill for agent: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  },

  async setSkillEnabled(skillName: string, enabled: boolean): Promise<void> {
    try {
      await (enabled
        ? enableSkillTauri(skillName)
        : disableSkillTauri(skillName));
    } catch (error) {
      throw new Error(
        `Failed to ${enabled ? "enable" : "disable"} ${skillName}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  },

  async setSkillForAgent(
    skillName: string,
    agentId: string,
    enabled: boolean,
  ): Promise<void> {
    try {
      await setSkillForAgentTauri(skillName, agentId, enabled);
    } catch (error) {
      throw new Error(
        `Failed to ${enabled ? "enable" : "disable"} ${skillName} for ${agentId}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  },

  async getDetectedAgents(): Promise<string[]> {
    try {
      return await getDetectedAgentsTauri();
    } catch (error) {
      console.error("Failed to detect agents", error);
      return [];
    }
  },
};
