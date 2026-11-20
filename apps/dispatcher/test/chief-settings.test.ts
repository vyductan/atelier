import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/*
 * The Chiefs' tasks-MCP fence (ticket 6 security review). Under OpenMausBot a
 * settings `allow` never narrows anything (only `deny` binds), so a Chief's
 * reach into the tasks MCP is everything the server offers minus what is
 * denied here. Every tool a Chief does not need for triage is denied by
 * name: canvas, English, delete, pick, flow blockers, attachments.
 *
 * The list of server tools is a snapshot (tools/list, 2026-11-20). A tool the
 * server adds later is open to the Chiefs until it is denied here too.
 */
const SERVER_TOOLS =
  "add_task_attachment canvas_apply_ops canvas_create_board canvas_create_folder canvas_history canvas_list_boards canvas_move_board canvas_read_board canvas_rename_board canvas_render_board canvas_undo create_task debug_auth delete_task echo english_answer_quiz english_create_note english_create_word english_get_learner_profile english_get_weak_words english_search_dictionary english_start_quiz find_task_by_name flows_for_task get_flow get_task list_flows list_task_types list_tasks pick_task set_flow_step_blocker start_task_attachment update_task".split(
    " ",
  );

/** What triage needs: read, create, update tasks; read flows. */
const CHIEF_TOOLS = new Set([
  "get_task",
  "list_tasks",
  "find_task_by_name",
  "list_task_types",
  "create_task",
  "update_task",
  "list_flows",
  "get_flow",
  "flows_for_task",
  "debug_auth",
  "echo",
]);

const deny = (bot: string) =>
  (JSON.parse(readFileSync(new URL(`../team/settings/${bot}.json`, import.meta.url), "utf8")) as {
    permissions: { deny: string[] };
  }).permissions.deny;

for (const bot of ["cos", "bl3q-lead"]) {
  describe(`${bot} tasks-MCP fence`, () => {
    const rules = deny(bot);

    it("denies every server tool triage does not need", () => {
      for (const tool of SERVER_TOOLS.filter((t) => !CHIEF_TOOLS.has(t))) {
        assert.ok(rules.includes(`mcp__vyductan-tasks__${tool}`), `${bot} must deny ${tool}`);
      }
    });

    it("keeps the triage tools open (no server-wide deny either)", () => {
      assert.ok(!rules.includes("mcp__vyductan-tasks"));
      for (const tool of CHIEF_TOOLS) {
        assert.ok(!rules.includes(`mcp__vyductan-tasks__${tool}`), `${bot} must keep ${tool}`);
      }
    });
  });
}
