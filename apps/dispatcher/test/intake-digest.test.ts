import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { intakeDigest } from "../src/intake.ts";
import type { Task } from "../src/tasks.ts";

/*
 * The Chief's daily triage input (spec e14d2c6b, ticket 6): the project's
 * `triage` tasks an intake bot recorded (`Source: intake`), oldest first.
 * Empty output means a quiet day: the routine then skips the model run.
 */

const now = new Date("2026-11-21T01:00:00Z");

const task = (fields: Partial<Task> & { id: string }): Task => ({
  title: "t",
  description: "> nút lưu lỗi\n\nSource: intake",
  status_code: "triage",
  project_slug: "vyductan",
  created_at: "2026-11-20T08:00:00Z",
  ...fields,
});

describe("intakeDigest", () => {
  it("lists triage tasks from intake, oldest first, with age and link", () => {
    const out = intakeDigest(
      [
        task({ id: "b", title: "newer", created_at: "2026-11-20T20:00:00Z" }),
        task({ id: "a", title: "older", created_at: "2026-11-18T01:00:00Z", type_code: "bug" } as Task),
      ],
      "vyductan",
      now,
    );
    const data = JSON.parse(out) as { project: string; reports: { id: string; age_days: number; link: string; type: string | null }[] };
    assert.equal(data.project, "vyductan");
    assert.deepEqual(data.reports.map((r) => r.id), ["a", "b"]);
    assert.equal(data.reports[0]!.age_days, 3);
    assert.equal(data.reports[0]!.type, "bug");
    assert.equal(data.reports[0]!.link, "https://www.vyductan.dev/projects/vyductan?task=a");
  });

  it("leaves out tasks not from intake and tasks no longer in triage", () => {
    const out = intakeDigest(
      [
        task({ id: "owner", description: "viết tay" }),
        task({ id: "chief", description: "x\nSource: chief" }),
        task({ id: "done", status_code: "todo" }),
        task({ id: "quoted", description: "> Source: intake" }),
      ],
      "vyductan",
      now,
    );
    assert.equal(out, "");
  });

  it("prints nothing on a quiet day", () => {
    assert.equal(intakeDigest([], "bl3q", now), "");
  });

  it("cuts a long description so one report cannot flood the brief", () => {
    const long = `${"x".repeat(5000)}\nSource: intake`;
    const data = JSON.parse(intakeDigest([task({ id: "a", description: long })], "vyductan", now)) as {
      reports: { description: string }[];
    };
    assert.ok(data.reports[0]!.description.length <= 2001);
  });
});
