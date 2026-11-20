import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/*
 * The intake bots' hard limits (spec e14d2c6b "Intake bots", ticket 4).
 *
 * An intake bot reads code and records the owner's reports as tasks. It runs
 * `full` (no approval cards, so a report from the phone has no friction), so
 * these deny rules are the whole local fence: no shell, no file writes, no
 * handing work to other bots, no web. The tasks server enforces what the
 * remaining tools may write (write-policy.ts in vyductan.dev).
 */

const settings = (bot: string) =>
  JSON.parse(readFileSync(new URL(`../team/settings/${bot}.json`, import.meta.url), "utf8")) as {
    permissions: { allow: string[]; deny: string[] };
  };

const TASK_TOOLS = [
  "get_task",
  "list_tasks",
  "find_task_by_name",
  "list_task_types",
  "create_task",
  "update_task",
  "start_task_attachment",
  "add_task_attachment",
].map((tool) => `mcp__vyductan-tasks__${tool}`);

const IMAGE_TOOLS = ["mcp__vyductan-images__find_image", "mcp__vyductan-images__upload_image"];

const MUST_DENY = [
  "Bash",
  "Edit",
  "Write",
  "NotebookEdit",
  "WebFetch",
  "WebSearch",
  "mcp__agents__coordinate_bots",
  "mcp__agents__create_bot",
  "mcp__agents__vm_exec",
  "mcp__vyductan-tasks__delete_task",
  "mcp__vyductan-tasks__pick_task",
  "mcp__vyductan-tasks__set_flow_step_blocker",
  "Read(~/.atelier/**)",
  "Read(~/.ssh/**)",
  "Read(**/.env)",
  "Read(**/.mcp.json)",
];

for (const bot of ["intake", "bl3q-intake"]) {
  describe(`${bot} settings`, () => {
    const { allow, deny } = settings(bot).permissions;

    it("allows exactly the report tools: tasks read/create/update/attach and the image finder", () => {
      assert.deepEqual([...allow].sort(), [...TASK_TOOLS, ...IMAGE_TOOLS].sort());
    });

    it("denies the shell, file writes, the web, other bots and secret paths", () => {
      for (const rule of MUST_DENY) assert.ok(deny.includes(rule), `${bot} must deny ${rule}`);
    });

    it("never both allows and denies a rule", () => {
      assert.deepEqual(allow.filter((rule) => deny.includes(rule)), []);
    });
  });
}
