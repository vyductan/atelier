import { describe, expect, it } from "vitest";

import type { Transition } from "./service-transition";
import { TRANSITION_TIMEOUT_MS, transitionStatus } from "./service-transition";

const T0 = 1_000_000;
const at = (ms: number) => T0 + ms;
const tr = (
  action: Transition["action"],
  pid: number | null = 100,
): Transition => ({
  action,
  since: T0,
  pid,
});

describe("transitionStatus", () => {
  it("finishes a stop once the service is down or crashed", () => {
    expect(transitionStatus(tr("stop"), "up", 100, at(500))).toBe("pending");
    expect(transitionStatus(tr("stop"), "degraded", 100, at(900))).toBe(
      "pending",
    );
    expect(transitionStatus(tr("stop"), "down", null, at(1200))).toBe("done");
    expect(transitionStatus(tr("stop"), "crashed", null, at(1200))).toBe(
      "done",
    );
  });

  it("finishes a start once the service answers, not while it is starting", () => {
    expect(transitionStatus(tr("start", null), "down", null, at(300))).toBe(
      "pending",
    );
    expect(transitionStatus(tr("start", null), "starting", 200, at(800))).toBe(
      "pending",
    );
    expect(transitionStatus(tr("start", null), "up", 210, at(2000))).toBe(
      "done",
    );
    expect(transitionStatus(tr("start", null), "degraded", 210, at(2000))).toBe(
      "done",
    );
  });

  it("does not take the old process for a finished restart", () => {
    // Right after clicking, the old pid still answers.
    expect(transitionStatus(tr("restart"), "up", 100, at(400))).toBe("pending");
    expect(transitionStatus(tr("restart"), "down", null, at(900))).toBe(
      "pending",
    );
    expect(transitionStatus(tr("restart"), "up", 230, at(2500))).toBe("done");
  });

  it("finishes a restart of a pid-less service after it has been up a moment", () => {
    expect(transitionStatus(tr("restart", null), "up", null, at(1000))).toBe(
      "pending",
    );
    expect(transitionStatus(tr("restart", null), "up", null, at(3000))).toBe(
      "done",
    );
  });

  it("gives up after the timeout", () => {
    expect(
      transitionStatus(tr("stop"), "up", 100, at(TRANSITION_TIMEOUT_MS - 1)),
    ).toBe("pending");
    expect(
      transitionStatus(tr("stop"), "up", 100, at(TRANSITION_TIMEOUT_MS)),
    ).toBe("timeout");
  });
});
