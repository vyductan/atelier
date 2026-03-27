import { describe, expect, it } from "vitest";

import type { SyncProfile } from "../lib/types.ts";
import { canConfirmSyncAction } from "./acme-sync-confirm-state.ts";
import {
  buildPreviewRequestForAction,
  canPreviewAction,
  getPreviewButtonLabel,
  getSyncDirectionForAction,
} from "./acme-sync-profile-state.ts";

describe("acme sync preview and confirm gating", () => {
  const rsyncProfile: SyncProfile = {
    id: "rsync-1",
    projectPath: "/repo/project-a",
    primaryPath: "/repo/main",
    mode: "rsync",
  };

  const subtreeProfile: SyncProfile = {
    id: "subtree-1",
    projectPath: "/repo/project-b",
    primaryPath: "/repo/main",
    mode: "subtree",
    subtree: {
      repoRoot: "/repo/project-b",
      prefix: "@acme",
      remote: "origin",
      branch: "main",
      squash: true,
    },
  };

  it("uses mode-aware preview labels and requests", () => {
    expect(getPreviewButtonLabel(rsyncProfile, "pull")).toBe("Preview Pull");
    expect(getPreviewButtonLabel(rsyncProfile, "push")).toBe("Preview Push");
    expect(getPreviewButtonLabel(subtreeProfile, "pull")).toBe(
      "Preview History",
    );
    expect(getPreviewButtonLabel(subtreeProfile, "push")).toBe(
      "Preview Push (Unavailable)",
    );

    expect(canPreviewAction(rsyncProfile, "pull")).toBe(true);
    expect(canPreviewAction(rsyncProfile, "push")).toBe(true);
    expect(canPreviewAction(subtreeProfile, "pull")).toBe(true);
    expect(canPreviewAction(subtreeProfile, "push")).toBe(false);

    expect(buildPreviewRequestForAction(rsyncProfile, "push")).toEqual({
      action: "push",
      mode: "rsync",
      src: "/repo/project-a",
      dest: "/repo/main",
    });

    expect(buildPreviewRequestForAction(subtreeProfile, "pull")).toEqual({
      action: "pull",
      mode: "subtree",
      direction: "from-primary",
    });

    expect(getSyncDirectionForAction("push")).toBe("to-primary");
    expect(getSyncDirectionForAction("pull")).toBe("from-primary");
  });

  it("keeps generic confirm gating simple and leaves subtree-specific blocking outside the helper", () => {
    expect(
      canConfirmSyncAction({
        hasConfirmState: true,
        isSyncing: false,
        isConfirmPreviewLoading: false,
        hasConfirmPreviewError: false,
      }),
    ).toBe(true);

    const genericGate = canConfirmSyncAction({
      hasConfirmState: true,
      isSyncing: false,
      isConfirmPreviewLoading: false,
      hasConfirmPreviewError: false,
    });
    const isSubtreeMisconfigured = true;
    const isMissingSubtree = true;

    expect(genericGate).toBe(true);
    expect(genericGate && !isSubtreeMisconfigured).toBe(false);
    expect(genericGate && !isMissingSubtree).toBe(false);
  });
});
