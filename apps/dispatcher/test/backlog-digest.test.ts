import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { backlogDigest, sweepState, type BacklogTask } from "../src/backlog.ts";

/*
 * The Chief's evening backlog sweep: every leaf task still waiting for a
 * decision (triage, never-triaged todo, a brief nobody addressed, needs-info),
 * oldest first. Tasks already addressed to a bot or the person are only counted.
 */

const now = new Date("2026-11-20T13:00:00Z");

const task = (fields: Partial<BacklogTask> & { id: string }): BacklogTask => ({
  title: "t",
  description: "nút lưu lỗi",
  status_code: "todo",
  project_slug: "vyductan",
  created_at: "2026-11-18T13:00:00Z",
  type_code: "bug",
  ...fields,
});

describe("sweepState", () => {
  it("sorts each kind of task", () => {
    assert.equal(sweepState(task({ id: "a", status_code: "triage" })), "needs-triage");
    assert.equal(sweepState(task({ id: "b" })), "untriaged");
    assert.equal(sweepState(task({ id: "c", description: "x\n\n## Agent Brief\n\n…" })), "brief-without-bot");
    assert.equal(sweepState(task({ id: "d", status_code: "blocked", description: "Triage: needs-info\n\nx" })), "needs-info");
  });

  it("leaves out what is not the Chief's to decide", () => {
    assert.equal(sweepState(task({ id: "a", description: "Bot: Dev\n\nx" })), null);
    assert.equal(sweepState(task({ id: "b", description: "Triage: ready-for-human\n\nx" })), null);
    assert.equal(sweepState(task({ id: "c", status_code: "blocked", description: "Blocked by: 123" })), null);
    assert.equal(sweepState(task({ id: "d", status_code: "idea" })), null);
    assert.equal(sweepState(task({ id: "e", status_code: "in-progress" })), null);
    assert.equal(sweepState(task({ id: "f", type_code: "module", description: null })), null);
    assert.equal(sweepState(task({ id: "g", type_code: "feature", status_code: "triage" })), null);
  });
});

describe("backlogDigest", () => {
  it("lists sweep tasks oldest first with counts of the rest", () => {
    const out = backlogDigest(
      [
        task({ id: "new", created_at: "2026-11-20T01:00:00Z" }),
        task({ id: "old", created_at: "2026-11-15T13:00:00Z", priority_code: "low", parent_task_id: "p" }),
        task({ id: "queued", description: "Bot: Dev\n\nx" }),
        task({ id: "human", description: "Triage: ready-for-human\n\nx" }),
        task({ id: "busy", status_code: "in-progress" }),
        task({ id: "habits", type_code: "module", description: null }),
      ],
      "vyductan",
      now,
    );
    const data = JSON.parse(out) as {
      project: string;
      context: Record<string, number>;
      tasks: { id: string; state: string; age_days: number; priority: string | null; parent_id: string | null; link: string }[];
    };
    assert.equal(data.project, "vyductan");
    assert.deepEqual(data.tasks.map((t) => t.id), ["old", "new"]);
    assert.equal(data.tasks[0]!.age_days, 5);
    assert.equal(data.tasks[0]!.priority, "low");
    assert.equal(data.tasks[0]!.parent_id, "p");
    assert.equal(data.tasks[0]!.link, "https://www.vyductan.dev/projects/vyductan?task=old");
    assert.deepEqual(data.context, { in_progress: 1, queued_for_a_bot: 1, waiting_on_the_person: 1 });
  });

  it("cuts long descriptions", () => {
    const out = backlogDigest([task({ id: "a", description: "x".repeat(5000) })], "vyductan", now);
    const data = JSON.parse(out) as { tasks: { description: string }[] };
    assert.equal(data.tasks[0]!.description.length, 1501);
  });

  it("prints nothing when nothing needs sorting", () => {
    assert.equal(backlogDigest([task({ id: "a", description: "Bot: Dev\n\nx" })], "vyductan", now), "");
  });
});
