import { describe, expect, it } from "vitest";

import {
  buildSubtreeConfirmDetails,
  clearSubtreeStatusForProject,
  formatSubtreeProjectLine,
  formatSubtreeSourceSyncLine,
  formatSubtreeStatusLabel,
  getSubtreeStatusBadgeTone,
} from "./acme-sync-subtree-state";

describe("formatSubtreeStatusLabel", () => {
  it("formats diverged status with source-based ahead and behind counts", () => {
    expect(
      formatSubtreeStatusLabel({
        state: "diverged",
        aheadCount: 2,
        behindCount: 3,
      }),
    ).toBe("Diverged from source (ahead 2, behind 3)");
  });

  it("formats ahead status with source-based wording", () => {
    expect(
      formatSubtreeStatusLabel({
        state: "ahead",
        aheadCount: 4,
      }),
    ).toBe("Ahead of source (4)");
  });

  it("formats behind status with source-based wording", () => {
    expect(
      formatSubtreeStatusLabel({
        state: "behind",
        behindCount: 5,
      }),
    ).toBe("Behind source (5)");
  });

  it("formats clean status as in sync", () => {
    expect(
      formatSubtreeStatusLabel({
        state: "clean",
      }),
    ).toBe("In sync");
  });

  it("formats missing_subtree status", () => {
    expect(
      formatSubtreeStatusLabel({
        state: "missing_subtree",
      }),
    ).toBe("Missing subtree");
  });
});

describe("formatSubtreeProjectLine", () => {
  it("marks ahead subtree state as modified", () => {
    expect(
      formatSubtreeProjectLine({
        mode: "subtree",
        state: "ahead",
        aheadCount: 2,
        behindCount: 0,
        dirty: false,
        message: undefined,
      }),
    ).toBe("Project @acme: Modified");
  });

  it("marks missing_subtree subtree state as missing subtree", () => {
    expect(
      formatSubtreeProjectLine({
        mode: "subtree",
        state: "missing_subtree",
        aheadCount: 0,
        behindCount: 0,
        dirty: false,
        message: undefined,
      }),
    ).toBe("Project @acme: Missing subtree");
  });

  it("marks diverged subtree state as modified", () => {
    expect(
      formatSubtreeProjectLine({
        mode: "subtree",
        state: "diverged",
        aheadCount: 2,
        behindCount: 3,
        dirty: false,
        message: undefined,
      }),
    ).toBe("Project @acme: Modified");
  });

  it("marks dirty subtree state as modified", () => {
    expect(
      formatSubtreeProjectLine({
        mode: "subtree",
        state: "clean",
        aheadCount: 0,
        behindCount: 0,
        dirty: true,
        message: undefined,
      }),
    ).toBe("Project @acme: Modified");
  });

  it("marks clean subtree state as no local changes", () => {
    expect(
      formatSubtreeProjectLine({
        mode: "subtree",
        state: "clean",
        aheadCount: 0,
        behindCount: 0,
        dirty: false,
        message: undefined,
      }),
    ).toBe("Project @acme: No local changes");
  });

  it("marks behind subtree state as no local changes", () => {
    expect(
      formatSubtreeProjectLine({
        mode: "subtree",
        state: "behind",
        aheadCount: 0,
        behindCount: 3,
        dirty: false,
        message: undefined,
      }),
    ).toBe("Project @acme: No local changes");
  });

  it("marks misconfigured subtree state as unknown", () => {
    expect(
      formatSubtreeProjectLine({
        mode: "subtree",
        state: "misconfigured",
        aheadCount: 0,
        behindCount: 0,
        dirty: false,
        message: undefined,
      }),
    ).toBe("Project @acme: Unknown");
  });

  it("falls back to unknown for non-subtree statuses", () => {
    expect(
      formatSubtreeProjectLine({
        mode: "rsync",
        state: "diverged",
        summary: { added: 0, modified: 1, deleted: 0 },
        oppositeSummary: { added: 1, modified: 0, deleted: 0 },
      }),
    ).toBe("Project @acme: Unknown");
  });
});

describe("formatSubtreeSourceSyncLine", () => {
  it("formats exact match as in sync", () => {
    expect(
      formatSubtreeSourceSyncLine({
        mode: "subtree",
        state: "clean",
        aheadCount: 0,
        behindCount: 0,
        dirty: false,
        message: undefined,
      }),
    ).toBe("Source sync: In sync");
  });

  it("formats diverged subtree state with source wording", () => {
    expect(
      formatSubtreeSourceSyncLine({
        mode: "subtree",
        state: "diverged",
        aheadCount: 2,
        behindCount: 3,
        dirty: false,
        message: undefined,
      }),
    ).toBe("Source sync: Diverged from source (ahead 2, behind 3)");
  });

  it("formats behind subtree state with source wording", () => {
    expect(
      formatSubtreeSourceSyncLine({
        mode: "subtree",
        state: "behind",
        aheadCount: 0,
        behindCount: 3,
        dirty: false,
        message: undefined,
      }),
    ).toBe("Source sync: Behind source (3)");
  });

  it("formats ahead subtree state with source wording", () => {
    expect(
      formatSubtreeSourceSyncLine({
        mode: "subtree",
        state: "ahead",
        aheadCount: 2,
        behindCount: 0,
        dirty: false,
        message: undefined,
      }),
    ).toBe("Source sync: Ahead of source (2)");
  });

  it("formats missing_subtree subtree state as cannot compare", () => {
    expect(
      formatSubtreeSourceSyncLine({
        mode: "subtree",
        state: "missing_subtree",
        aheadCount: 0,
        behindCount: 0,
        dirty: false,
        message: undefined,
      }),
    ).toBe("Source sync: Cannot compare");
  });

  it("formats misconfigured subtree state", () => {
    expect(
      formatSubtreeSourceSyncLine({
        mode: "subtree",
        state: "misconfigured",
        aheadCount: 0,
        behindCount: 0,
        dirty: false,
        message: undefined,
      }),
    ).toBe("Source sync: Misconfigured");
  });

  it("falls back to unknown for non-subtree statuses", () => {
    expect(
      formatSubtreeSourceSyncLine({
        mode: "rsync",
        state: "diverged",
        summary: { added: 0, modified: 1, deleted: 0 },
        oppositeSummary: { added: 1, modified: 0, deleted: 0 },
      }),
    ).toBe("Source sync: Unknown");
  });
});

describe("getSubtreeStatusBadgeTone", () => {
  it("marks behind, diverged, and missing_subtree states as warning tones for profile cards", () => {
    expect(getSubtreeStatusBadgeTone("behind")).toBe("warning");
    expect(getSubtreeStatusBadgeTone("diverged")).toBe("warning");
    expect(getSubtreeStatusBadgeTone("missing_subtree")).toBe("warning");
    expect(getSubtreeStatusBadgeTone("clean")).toBe("success");
    expect(getSubtreeStatusBadgeTone("misconfigured")).toBe("danger");
  });
});

describe("buildSubtreeConfirmDetails", () => {
  it("returns mode-specific confirm details for subtree previews", () => {
    expect(
      buildSubtreeConfirmDetails({
        mode: "subtree",
        state: "diverged",
        aheadCount: 2,
        behindCount: 3,
        dirty: true,
        message: "Subtree has diverged.",
      }),
    ).toEqual({
      statusLabel: "Diverged from source (ahead 2, behind 3)",
      aheadCount: 2,
      behindCount: 3,
      dirty: true,
    });
  });

  it("ignores rsync status objects so hybrid confirm UI stays mode-aware", () => {
    expect(
      buildSubtreeConfirmDetails({
        mode: "rsync",
        state: "diverged",
        summary: { added: 0, modified: 1, deleted: 0 },
        oppositeSummary: { added: 1, modified: 0, deleted: 0 },
      }),
    ).toBeNull();
  });
});

describe("clearSubtreeStatusForProject", () => {
  it("removes cached subtree status for the edited project", () => {
    expect(
      clearSubtreeStatusForProject(
        {
          "/repo/project-a": {
            mode: "subtree",
            state: "behind",
            aheadCount: 0,
            behindCount: 2,
            dirty: false,
            message: "2 subtree commits available from primary.",
          },
          "/repo/project-b": {
            mode: "subtree",
            state: "clean",
            aheadCount: 0,
            behindCount: 0,
            dirty: false,
            message: "Already in sync.",
          },
        },
        "/repo/project-a",
      ),
    ).toEqual({
      "/repo/project-b": {
        mode: "subtree",
        state: "clean",
        aheadCount: 0,
        behindCount: 0,
        dirty: false,
        message: "Already in sync.",
      },
    });
  });
});
