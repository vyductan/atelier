import {
  searchSkills,
  getInstalledSkills as getInstalledSkillsTauri,
  uninstallSkill as uninstallSkillTauri,
  enableSkillForAgent as enableSkillForAgentTauri,
  disableSkillForAgent as disableSkillForAgentTauri,
  getDetectedAgents as getDetectedAgentsTauri,
  getSkillUsage as getSkillUsageTauri,
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
      const resultString = await getInstalledSkillsTauri();
      if (!resultString) return [];
      return JSON.parse(resultString) as InstalledSkill[];
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

  async getDetectedAgents(): Promise<string[]> {
    try {
      return await getDetectedAgentsTauri();
    } catch (error) {
      console.error("Failed to detect agents", error);
      return [];
    }
  }
};
