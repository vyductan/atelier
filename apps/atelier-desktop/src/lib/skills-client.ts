import {
  searchSkills,
  getInstalledSkills as getInstalledSkillsTauri,
  uninstallSkill as uninstallSkillTauri,
  enableSkillForAgent as enableSkillForAgentTauri,
  disableSkillForAgent as disableSkillForAgentTauri,
  getDetectedAgents as getDetectedAgentsTauri,
  getSkillUsage as getSkillUsageTauri,
  disableSkill as disableSkillTauri,
  enableSkill as enableSkillTauri,
  listDisabledSkills as listDisabledSkillsTauri,
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
}

export const skillsClient = {
  async searchSkills(query = "", limit = 20): Promise<SearchSkillsResponse> {
    if (query.trim().length < 2) {
      return { query, searchType: "empty", skills: [], count: 0, duration_ms: 0 };
    }
    
    try {
      const resultString = await searchSkills(query, limit);
      const data = JSON.parse(resultString) as SearchSkillsResponse | { error: string };
      if ("error" in data) {
        throw new Error(data.error, { cause: "API returned an error" });
      }
      return data;
    } catch (error) {
      throw new Error(`Failed to fetch skills: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  },

  async getSkillUsage(): Promise<SkillUsageReport> {
    return await getSkillUsageTauri();
  },

  async getInstalledSkills(): Promise<InstalledSkill[]> {
    try {
      const [resultString, disabled] = await Promise.all([
        getInstalledSkillsTauri(),
        listDisabledSkillsTauri(),
      ]);
      const installed = resultString ? (JSON.parse(resultString) as InstalledSkill[]) : [];
      // `skills ls` no longer sees disabled skills, so they come from disk.
      return [
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
      ];
    } catch (error) {
      throw new Error(`Failed to get installed skills: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  },

  async uninstallSkill(skillName: string): Promise<void> {
    try {
      await uninstallSkillTauri(skillName);
    } catch (error) {
      throw new Error(`Failed to uninstall skill: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  },

  async enableSkillForAgent(skillSource: string, skillName: string, agentName: string): Promise<void> {
    try {
      await enableSkillForAgentTauri(skillSource, skillName, agentName);
    } catch (error) {
      throw new Error(`Failed to enable skill for agent: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  },

  async disableSkillForAgent(skillName: string, agentName: string): Promise<void> {
    try {
      await disableSkillForAgentTauri(skillName, agentName);
    } catch (error) {
      throw new Error(`Failed to disable skill for agent: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  },

  async setSkillEnabled(skillName: string, enabled: boolean): Promise<void> {
    try {
      await (enabled ? enableSkillTauri(skillName) : disableSkillTauri(skillName));
    } catch (error) {
      throw new Error(`Failed to ${enabled ? "enable" : "disable"} ${skillName}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  },

  async getDetectedAgents(): Promise<string[]> {
    try {
      return await getDetectedAgentsTauri();
    } catch (error) {
      console.error("Failed to detect agents", error);
      return [];
    }
  }
};
