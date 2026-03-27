import { beforeEach, describe, expect, it } from "vitest";

import { migrateAcmeStoreState, useAcmeStore } from "./acme-store";

const DEFAULT_PRIMARY_ACME_PATH = "/Users/vyductan/Developer/vyductan/@acme";

describe("useAcmeStore", () => {
  beforeEach(() => {
    useAcmeStore.setState({
      primaryPath: DEFAULT_PRIMARY_ACME_PATH,
      profiles: [],
    });
  });

  it("defaults primaryPath to the canonical @acme directory", () => {
    expect(useAcmeStore.getState().primaryPath).toBe(DEFAULT_PRIMARY_ACME_PATH);
  });

  it("adds an rsync profile for a project path", () => {
    useAcmeStore.getState().setPrimaryPath("/repo/primary");
    useAcmeStore.getState().addProjectProfile("/repo/project-a");

    expect(useAcmeStore.getState().profiles).toEqual([
      expect.objectContaining({
        projectPath: "/repo/project-a",
        primaryPath: "/repo/primary",
        mode: "rsync",
      }),
    ]);
  });

  it("switches a profile to subtree mode and stores subtree settings", () => {
    useAcmeStore.getState().setPrimaryPath("/repo/primary");
    useAcmeStore.getState().addProjectProfile("/repo/project-a");
    const profileId = useAcmeStore.getState().profiles[0]?.id;
    expect(profileId).toBeTruthy();
    if (!profileId) {
      throw new Error("Expected profile id to exist");
    }

    useAcmeStore.getState().updateProfileMode(profileId, "subtree");
    useAcmeStore.getState().updateSubtreeSettings(profileId, {
      repoRoot: "/repo/project-a",
      prefix: "@acme",
      remote: "origin",
      branch: "main",
      squash: true,
    });

    expect(useAcmeStore.getState().profiles[0]).toEqual(
      expect.objectContaining({
        mode: "subtree",
        subtree: expect.objectContaining({ remote: "origin", branch: "main" }),
      }),
    );
  });

  it("rewrites existing profile primary paths to null when primary path is cleared", () => {
    useAcmeStore.getState().setPrimaryPath("/repo/primary");
    useAcmeStore.getState().addProjectProfile("/repo/project-a");

    useAcmeStore.getState().setPrimaryPath(null);

    expect(useAcmeStore.getState().profiles).toEqual([
      expect.objectContaining({
        projectPath: "/repo/project-a",
        primaryPath: null,
      }),
    ]);
  });

  it("migrates legacy mainPath and paths into persisted rsync profiles", () => {
    const migrated = migrateAcmeStoreState({
      mainPath: "/repo/primary",
      paths: ["/repo/project-a", "/repo/project-a", "/repo/project-b"],
    });

    expect(migrated.primaryPath).toBe("/repo/primary");
    expect(migrated.profiles).toEqual([
      expect.objectContaining({
        projectPath: "/repo/project-a",
        primaryPath: "/repo/primary",
        mode: "rsync",
      }),
      expect.objectContaining({
        projectPath: "/repo/project-b",
        primaryPath: "/repo/primary",
        mode: "rsync",
      }),
    ]);
  });

  it("migrates the legacy vyductan-react primary path to the canonical @acme directory", () => {
    expect(
      migrateAcmeStoreState({
        primaryPath: "/Users/vyductan/Developer/vyductan-react",
        profiles: [],
      }).primaryPath,
    ).toBe(DEFAULT_PRIMARY_ACME_PATH);
  });

  it("migrates the legacy vyductan repo root primary path to the canonical @acme directory", () => {
    expect(
      migrateAcmeStoreState({
        primaryPath: "/Users/vyductan/Developer/vyductan",
        profiles: [],
      }).primaryPath,
    ).toBe(DEFAULT_PRIMARY_ACME_PATH);
  });

  it("preserves an already-correct @acme primary path during migration", () => {
    expect(
      migrateAcmeStoreState({
        primaryPath: "/custom/shared/@acme",
        profiles: [],
      }).primaryPath,
    ).toBe("/custom/shared/@acme");
  });

  it("preserves unrelated custom primary paths during migration", () => {
    expect(
      migrateAcmeStoreState({
        primaryPath: "/custom/shared/root",
        profiles: [],
      }).primaryPath,
    ).toBe("/custom/shared/root");
  });

  it("preserves an explicitly cleared primaryPath during migration", () => {
    const migrated = migrateAcmeStoreState({
      primaryPath: null,
      profiles: [
        {
          id: "1",
          projectPath: "/repo/project-a",
          primaryPath: null,
          mode: "rsync",
        },
      ],
    });

    expect(migrated.primaryPath).toBeNull();
    expect(migrated.profiles[0]?.primaryPath).toBeNull();
  });

  it("normalizes migrated profile primaryPath values to the canonical @acme directory", () => {
    const migrated = migrateAcmeStoreState({
      primaryPath: "/Users/vyductan/Developer/vyductan-react",
      profiles: [
        {
          id: "1",
          projectPath: "/repo/project-a",
          primaryPath: "/Users/vyductan/Developer/vyductan-react",
          mode: "rsync",
        },
      ],
    });

    expect(migrated.profiles[0]?.primaryPath).toBe(DEFAULT_PRIMARY_ACME_PATH);
  });
});
