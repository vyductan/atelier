import { describe, expect, it } from "vitest";

import type {
  InstalledSkill,
  SkillUsage,
  SkillUsageReport,
} from "../../lib/skills-client";
import {
  describeUsage,
  formatLastUsed,
  indexUsage,
  sortGroups,
  sortSkills,
} from "./skill-usage";

const NOW = Date.parse("2026-10-24T12:00:00Z");
const daysAgo = (days: number) =>
  new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString();

function skill(name: string): InstalledSkill {
  return { name, path: `/s/${name}`, scope: "global", agents: [] };
}

function usage(
  name: string,
  total: number,
  lastUsedDaysAgo: number | null,
): SkillUsage {
  return {
    name,
    claudeAuto: total,
    claudeSlash: 0,
    antigravityLoad: 0,
    antigravityRequest: 0,
    total,
    last30Days: 0,
    lastUsed: lastUsedDaysAgo === null ? null : daysAgo(lastUsedDaysAgo),
  };
}

const report: SkillUsageReport = {
  skills: [
    usage("archify", 18, 16),
    usage("grilling", 14, 22),
    usage("to-spec", 10, 16),
    usage("pr", 1, null),
  ],
  since: daysAgo(145),
  scannedFiles: 10,
};
const index = indexUsage(report);
const installed = ["understand", "pr", "to-spec", "archify", "grilling"].map(
  skill,
);
const names = (skills: InstalledSkill[]) => skills.map((s) => s.name);

describe("sortSkills", () => {
  it("sorts by name", () => {
    expect(names(sortSkills(installed, "name", index))).toEqual([
      "archify",
      "grilling",
      "pr",
      "to-spec",
      "understand",
    ]);
  });

  it("sorts by uses, breaking ties by recency then name", () => {
    expect(names(sortSkills(installed, "uses", index))).toEqual([
      "archify",
      "grilling",
      "to-spec",
      "pr",
      "understand",
    ]);
  });

  it("sorts by last use, breaking ties by uses; never-used skills go last", () => {
    // archify and to-spec were both last used 16 days ago; archify has more uses.
    expect(names(sortSkills(installed, "last-used", index))).toEqual([
      "archify",
      "to-spec",
      "grilling",
      "pr",
      "understand",
    ]);
  });

  it("does not mutate the input", () => {
    const copy = [...installed];
    sortSkills(installed, "uses", index);
    expect(installed).toEqual(copy);
  });

  it("treats a missing report as no usage", () => {
    expect(names(sortSkills(installed, "uses", indexUsage(null)))).toEqual(
      names(sortSkills(installed, "name", index)),
    );
  });
});

describe("formatLastUsed", () => {
  it.each([
    [null, "never"],
    [undefined, "never"],
    ["not a date", "never"],
    [daysAgo(0.2), "today"],
    [daysAgo(3), "3d"],
    [daysAgo(13), "13d"],
    [daysAgo(16), "2w"],
    [daysAgo(90), "3mo"],
    [daysAgo(400), "1y"],
  ] as const)("%s → %s", (iso, expected) => {
    expect(formatLastUsed(iso, NOW)).toBe(expected);
  });
});

describe("describeUsage", () => {
  it("lists only the sources that were used", () => {
    expect(
      describeUsage({
        ...usage("to-spec", 10, 16),
        claudeAuto: 0,
        claudeSlash: 1,
        antigravityLoad: 9,
        last30Days: 4,
      }),
    ).toBe(
      "/to-spec typed 1× · Antigravity loaded it 9× · 4 in the last 30 days",
    );
  });

  it("explains a skill with no usage", () => {
    expect(describeUsage(undefined)).toMatch(/^Never used/);
  });
});

describe("sortGroups", () => {
  const groups: [string, InstalledSkill[]][] = [
    ["Antigravity", [skill("bigquery-sql"), skill("dataform")]],
    ["mattpocock/skills", [skill("to-spec"), skill("pr"), skill("grilling")]],
    ["tt-a1i/archify", [skill("archify")]],
  ];
  const summary = (sorted: [string, InstalledSkill[]][]) =>
    sorted.map(([group, skills]) => `${group}: ${names(skills).join(",")}`);

  it("ranks groups by total uses and sorts skills inside them", () => {
    // mattpocock: grilling 14 + to-spec 10 + pr 1 = 25 > archify 18 > unused.
    expect(summary(sortGroups(groups, "uses", index))).toEqual([
      "mattpocock/skills: grilling,to-spec,pr",
      "tt-a1i/archify: archify",
      "Antigravity: bigquery-sql,dataform",
    ]);
  });

  it("ranks groups by their most recent use", () => {
    // archify and to-spec tie at 16 days; the larger group total breaks the tie.
    expect(summary(sortGroups(groups, "last-used", index))).toEqual([
      "mattpocock/skills: to-spec,grilling,pr",
      "tt-a1i/archify: archify",
      "Antigravity: bigquery-sql,dataform",
    ]);
  });

  it("orders groups and skills by name", () => {
    expect(summary(sortGroups(groups, "name", index))).toEqual([
      "Antigravity: bigquery-sql,dataform",
      "mattpocock/skills: grilling,pr,to-spec",
      "tt-a1i/archify: archify",
    ]);
  });
});
