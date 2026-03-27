import { describe, expect, it } from "vitest";

import {
  getAiSyncActionTitle,
  getConflictResolutionLabel,
  getPrimaryPathEmptyState,
  getPrimaryRepoScopeLabel,
  getPrimaryRepoSyncExplanation,
  getPrimaryRepoTypeLabel,
  getPrimarySectionComment,
  getPrimarySectionDescription,
  getPrimarySectionTitle,
  getProjectSectionDescription,
  getProjectSectionTitle,
  getSubtreeHistoryFallbackMessage,
  getSyncActionLabel,
  getSyncScreenDescription,
} from "./acme-sync-wording.ts";

describe("acme sync wording helpers", () => {
  it("returns the expected primary and project copy", () => {
    expect(getPrimarySectionComment()).toBe("Primary Path Section");
    expect(getPrimarySectionTitle()).toBe("Primary @acme Path");
    expect(getPrimarySectionDescription()).toBe(
      "The primary directory where shared @acme code is managed.",
    );
    expect(getPrimaryRepoTypeLabel()).toBe("Type: Standalone git repo");
    expect(getPrimaryRepoScopeLabel()).toBe("Scope: @acme/");
    expect(getPrimaryRepoSyncExplanation()).toBe(
      "Projects sync shared @acme code from this repo.",
    );
    expect(getProjectSectionTitle()).toBe("Project Profiles");
    expect(getProjectSectionDescription()).toBe(
      "Projects configured to sync shared @acme code.",
    );
    expect(getSyncScreenDescription()).toBe(
      "Synchronize your primary @acme workspace with local projects.",
    );
    expect(getPrimaryPathEmptyState()).toBe(
      "No primary path set. Please select one.",
    );
    expect(getSubtreeHistoryFallbackMessage()).toBe(
      "Previewed subtree history.",
    );
  });

  it("returns the expected action labels", () => {
    expect(getSyncActionLabel("push")).toBe("Push to Primary");
    expect(getSyncActionLabel("pull")).toBe("Pull from Primary");
    expect(getAiSyncActionTitle()).toBe(
      "Generate AI review prompt for Claude Code / Codex",
    );
    expect(getConflictResolutionLabel("pull")).toEqual({
      title: "Keep Primary version",
      label: "Keep Primary",
    });
    expect(getConflictResolutionLabel("push")).toEqual({
      title: "Keep Project version",
      label: "Keep Project",
    });
  });
});
