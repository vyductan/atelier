import { describe, expect, it } from "vitest";

import type { InstalledSkill } from "../../lib/skills-client";
import {
  countDisabledPlugins,
  groupPlugin,
  setPluginFlag,
  withDisabledPlugins,
} from "./plugin-groups";

function standalone(name: string): InstalledSkill {
  return {
    name,
    path: `/s/${name}`,
    scope: "global",
    agents: [],
    inStore: true,
    agentStates: {},
  };
}

function fromPlugin(
  name: string,
  plugin: string,
  enabled: boolean,
): InstalledSkill {
  return {
    ...standalone(name),
    inStore: false,
    plugin: {
      plugin,
      marketplace: "official",
      kind: "skill",
      invokeName: `${plugin}:${name}`,
      enabled,
    },
  };
}

describe("groupPlugin", () => {
  it("names the plugin when every skill in the group comes from it", () => {
    expect(
      groupPlugin([
        fromPlugin("a", "caveman", true),
        fromPlugin("b", "caveman", true),
      ]),
    ).toEqual({ id: "caveman@official", enabled: true });
  });

  it("gives no plugin switch to mixed or standalone groups", () => {
    expect(
      groupPlugin([fromPlugin("a", "caveman", true), standalone("b")]),
    ).toBeNull();
    expect(
      groupPlugin([
        fromPlugin("a", "caveman", true),
        fromPlugin("b", "vercel", true),
      ]),
    ).toBeNull();
    expect(groupPlugin([standalone("a")])).toBeNull();
    expect(groupPlugin([])).toBeNull();
  });
});

describe("disabled plugins", () => {
  const groups: [string, InstalledSkill[]][] = [
    ["mattpocock/skills", [standalone("grilling")]],
    ["caveman@official", [fromPlugin("caveman", "caveman", true)]],
    [
      "vercel@official",
      [
        fromPlugin("deploy", "vercel", false),
        fromPlugin("env", "vercel", false),
      ],
    ],
    ["superpowers@official", [fromPlugin("tdd", "superpowers", false)]],
  ];

  it("hides their skills and the groups they leave empty", () => {
    expect(withDisabledPlugins(groups, false).map(([group]) => group)).toEqual([
      "mattpocock/skills",
      "caveman@official",
    ]);
  });

  it("shows everything when asked", () => {
    expect(withDisabledPlugins(groups, true)).toBe(groups);
  });

  it("counts plugins, not skills", () => {
    expect(countDisabledPlugins(groups)).toBe(2);
  });
});

describe("setPluginFlag", () => {
  it("flips only that plugin's skills", () => {
    const skills = [
      fromPlugin("a", "caveman", true),
      fromPlugin("b", "vercel", true),
      standalone("c"),
    ];
    const next = setPluginFlag(skills, "caveman@official", false);
    expect(next.map((skill) => skill.plugin?.enabled)).toEqual([
      false,
      true,
      undefined,
    ]);
    expect(next[1]).toBe(skills[1]);
    expect(next[2]).toBe(skills[2]);
  });
});
