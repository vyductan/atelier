import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { parseSyncStrategyMarkdown } from "./scheduled-task-sync-strategy";

describe("scheduled-task-sync-strategy", () => {
  it("keeps sync-strategy parsing independent from UI form types", () => {
    const source = readFileSync(
      new URL("./scheduled-task-sync-strategy.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toContain("../components/scheduled-task-form");
    expect(source).not.toContain("ScheduledTaskFormInput");
  });

  it("returns the daily sync draft for the V1 preset", () => {
    expect(
      parseSyncStrategyMarkdown({
        workspacePath: "/tmp/workspace",
        strategyMarkdown: "- run daily",
      }),
    ).toMatchObject({
      name: "@acme sync daily",
      frequency: "daily",
      cron: "0 9 * * *",
    });
  });
});
