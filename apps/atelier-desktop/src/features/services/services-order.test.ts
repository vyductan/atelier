import { describe, expect, it } from "vitest";

import type { OrderedGroup } from "./services-order";
import {
  applyOrder,
  moveGroup,
  moveService,
  toOrder,
  UNGROUPED,
} from "./services-order";

interface Item {
  def: { id: string; group: string | null };
}

const item = (id: string, group: string | null): Item => ({
  def: { id, group },
});

// services.yaml order
const services = [
  item("web", "vyductan.dev"),
  item("prod", "vyductan.dev"),
  item("storybook", "tools"),
  item("voice", "tools"),
  item("supabase", "nlabs"),
  item("wordpress", "nlabs"),
  item("loose", null),
];

const layout = (groups: OrderedGroup<Item>[]) =>
  groups.map((g) => `${g.name}: ${g.services.map((s) => s.def.id).join(",")}`);

describe("applyOrder", () => {
  it("keeps services.yaml order without a saved order", () => {
    expect(layout(applyOrder(services, null))).toEqual([
      "vyductan.dev: web,prod",
      "tools: storybook,voice",
      "nlabs: supabase,wordpress",
      `${UNGROUPED}: loose`,
    ]);
  });

  it("applies a saved order to groups and to services within them", () => {
    const groups = applyOrder(services, {
      groups: ["nlabs", "vyductan.dev", "tools", UNGROUPED],
      services: ["wordpress", "supabase", "prod", "web", "voice", "storybook"],
    });
    expect(layout(groups)).toEqual([
      "nlabs: wordpress,supabase",
      "vyductan.dev: prod,web",
      "tools: voice,storybook",
      `${UNGROUPED}: loose`,
    ]);
  });

  it("puts new services after saved ones, in services.yaml order", () => {
    const groups = applyOrder([...services, item("dashboard", "nlabs")], {
      groups: [],
      services: ["wordpress"],
    });
    expect(layout(groups)[2]).toBe("nlabs: wordpress,supabase,dashboard");
  });

  it("puts new groups after saved ones, in services.yaml order", () => {
    const groups = applyOrder(
      [...services, item("x", "new-a"), item("y", "new-b")],
      {
        groups: ["tools", "nlabs"],
        services: [],
      },
    );
    expect(groups.map((g) => g.name)).toEqual([
      "tools",
      "nlabs",
      "vyductan.dev",
      UNGROUPED,
      "new-a",
      "new-b",
    ]);
  });

  it("ignores saved ids and groups that no longer exist", () => {
    const groups = applyOrder(services, {
      groups: ["gone", "nlabs"],
      services: ["deleted", "wordpress"],
    });
    expect(layout(groups)[0]).toBe("nlabs: wordpress,supabase");
    expect(groups.flatMap((g) => g.services)).toHaveLength(services.length);
  });
});

describe("moving", () => {
  const base = applyOrder(services, null);

  it("moves a group to where another one was", () => {
    expect(moveGroup(base, "nlabs", "vyductan.dev").map((g) => g.name)).toEqual(
      ["nlabs", "vyductan.dev", "tools", UNGROUPED],
    );
    expect(
      moveGroup(base, "vyductan.dev", UNGROUPED).map((g) => g.name),
    ).toEqual(["tools", "nlabs", UNGROUPED, "vyductan.dev"]);
  });

  it("moves a service within its group", () => {
    expect(layout(moveService(base, "voice", "storybook"))[1]).toBe(
      "tools: voice,storybook",
    );
  });

  it("ignores drops across groups and unknown ids", () => {
    expect(layout(moveService(base, "voice", "web"))).toEqual(layout(base));
    expect(layout(moveService(base, "nope", "web"))).toEqual(layout(base));
    expect(moveGroup(base, "nope", "tools")).toBe(base);
  });

  it("records every position, so the saved order round-trips", () => {
    const moved = moveService(
      moveGroup(base, "nlabs", "vyductan.dev"),
      "wordpress",
      "supabase",
    );
    const order = toOrder(moved);
    expect(order).toEqual({
      groups: ["nlabs", "vyductan.dev", "tools", UNGROUPED],
      services: [
        "wordpress",
        "supabase",
        "web",
        "prod",
        "storybook",
        "voice",
        "loose",
      ],
    });
    expect(layout(applyOrder(services, order))).toEqual(layout(moved));
  });
});
