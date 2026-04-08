import { describe, expect, it } from "vitest";

import { computeDeterministicJitterMinutes } from "./scheduled-task-engine";

describe("computeDeterministicJitterMinutes", () => {
  it("returns the same jitter for the same task id", () => {
    expect(computeDeterministicJitterMinutes("task-daily-review", 10)).toBe(
      computeDeterministicJitterMinutes("task-daily-review", 10),
    );
  });
});
