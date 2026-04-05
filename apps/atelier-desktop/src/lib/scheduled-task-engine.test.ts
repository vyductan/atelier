import { describe, expect, it } from "vitest";

import {
  buildCandidateSlots,
  computeDeterministicJitterMinutes,
  findMostRecentMissedSlot,
  hasActiveRunForTask,
} from "./scheduled-task-engine";

describe("computeDeterministicJitterMinutes", () => {
  it("returns a stable jitter for the same task id", () => {
    expect(computeDeterministicJitterMinutes("task-daily-review", 10)).toBe(
      computeDeterministicJitterMinutes("task-daily-review", 10),
    );
  });

  it("returns a jitter within the inclusive range", () => {
    const jitter = computeDeterministicJitterMinutes("task-daily-review", 10);

    expect(jitter).toBeGreaterThanOrEqual(0);
    expect(jitter).toBeLessThanOrEqual(10);
  });

  it("returns zero when maxMinutes is zero", () => {
    expect(computeDeterministicJitterMinutes("task-daily-review", 0)).toBe(0);
  });
});

describe("findMostRecentMissedSlot", () => {
  it("returns the most recent eligible missed slot at or before now", () => {
    expect(
      findMostRecentMissedSlot({
        slots: [
          "2026-04-03T09:00:00.000Z",
          "2026-04-04T09:00:00.000Z",
          "2026-04-05T09:00:00.000Z",
          "2026-04-06T09:00:00.000Z",
        ],
        now: "2026-04-05T09:00:00.000Z",
        lookbackDays: 7,
      }),
    ).toBe("2026-04-05T09:00:00.000Z");
  });

  it("ignores future slots and slots older than the lookback window", () => {
    expect(
      findMostRecentMissedSlot({
        slots: [
          "2026-03-28T08:59:59.999Z",
          "2026-03-29T09:00:00.000Z",
          "2026-04-04T09:00:00.000Z",
          "2026-04-05T09:00:00.001Z",
        ],
        now: "2026-04-05T09:00:00.000Z",
        lookbackDays: 7,
      }),
    ).toBe("2026-04-04T09:00:00.000Z");
  });

  it("returns null when there is no eligible slot", () => {
    expect(
      findMostRecentMissedSlot({
        slots: [
          "2026-03-28T08:59:59.999Z",
          "2026-04-05T09:00:00.001Z",
        ],
        now: "2026-04-05T09:00:00.000Z",
        lookbackDays: 7,
      }),
    ).toBeNull();
  });

  it("returns null when now is invalid", () => {
    expect(
      findMostRecentMissedSlot({
        slots: [
          "2026-04-03T09:00:00.000Z",
          "2026-04-04T09:00:00.000Z",
        ],
        now: "not-a-date",
        lookbackDays: 7,
      }),
    ).toBeNull();
  });
});

describe("buildCandidateSlots", () => {
  it("builds daily UTC slots within the lookback window", () => {
    expect(
      buildCandidateSlots({
        scheduleType: "daily",
        cron: "0 9 * * *",
        timezone: "UTC",
        now: "2026-04-05T10:15:00.000Z",
        lookbackDays: 2,
      }),
    ).toEqual([
      "2026-04-05T09:00:00.000Z",
      "2026-04-04T09:00:00.000Z",
      "2026-04-03T09:00:00.000Z",
    ]);
  });

  it("converts scheduled local wall-clock time to the correct UTC instant", () => {
    expect(
      buildCandidateSlots({
        scheduleType: "daily",
        cron: "0 9 * * *",
        timezone: "Asia/Ho_Chi_Minh",
        now: "2026-04-05T10:15:00.000Z",
        lookbackDays: 1,
      }),
    ).toEqual([
      "2026-04-05T02:00:00.000Z",
      "2026-04-04T02:00:00.000Z",
    ]);
  });

  it("iterates local calendar dates across DST boundaries without duplicates or gaps", () => {
    expect(
      buildCandidateSlots({
        scheduleType: "daily",
        cron: "0 9 * * *",
        timezone: "America/New_York",
        now: "2026-11-02T15:00:00.000Z",
        lookbackDays: 3,
      }),
    ).toEqual([
      "2026-11-02T14:00:00.000Z",
      "2026-11-01T14:00:00.000Z",
      "2026-10-31T13:00:00.000Z",
      "2026-10-30T13:00:00.000Z",
    ]);
  });
});

describe("hasActiveRunForTask", () => {
  it("returns true when the task has a queued or running run", () => {
    expect(
      hasActiveRunForTask(
        [
          {
            runId: "run-1",
            scheduledTaskId: "sched-1",
            scheduledFor: "2026-04-05T09:00:00.000Z",
            startedAt: null,
            finishedAt: null,
            status: "queued",
            reason: "catch_up",
            linkedSessionId: null,
            linkedTaskId: null,
            errorSummary: null,
            summary: null,
            createdAt: "2026-04-05T09:00:00.000Z",
            updatedAt: "2026-04-05T09:00:00.000Z",
          },
        ],
        "sched-1",
      ),
    ).toBe(true);
  });

  it("returns false when the task has only terminal runs", () => {
    expect(
      hasActiveRunForTask(
        [
          {
            runId: "run-1",
            scheduledTaskId: "sched-1",
            scheduledFor: "2026-04-05T09:00:00.000Z",
            startedAt: "2026-04-05T09:00:30.000Z",
            finishedAt: "2026-04-05T09:05:00.000Z",
            status: "completed",
            reason: "catch_up",
            linkedSessionId: null,
            linkedTaskId: null,
            errorSummary: null,
            summary: null,
            createdAt: "2026-04-05T09:00:00.000Z",
            updatedAt: "2026-04-05T09:05:00.000Z",
          },
        ],
        "sched-1",
      ),
    ).toBe(false);
  });
});
