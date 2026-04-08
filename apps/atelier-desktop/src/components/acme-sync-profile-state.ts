import type { SyncDirection, SyncProfile } from "../lib/types.ts";

export interface PreviewRequestPlan {
  action: "push" | "pull";
  mode: SyncProfile["mode"];
  src?: string;
  dest?: string;
  direction?: SyncDirection;
}

export const canPreviewAction = (
  profile: SyncProfile,
  action: "push" | "pull",
) => {
  if (profile.mode === "subtree") {
    return action === "pull";
  }

  return Boolean(profile.primaryPath);
};

export const getPreviewButtonLabel = (
  profile: SyncProfile,
  action: "push" | "pull",
) => {
  if (profile.mode === "subtree") {
    if (action === "pull") {
      return "Preview History";
    }

    return "Preview Push (Unavailable)";
  }

  return action === "push" ? "Preview Push" : "Preview Pull";
};

export const buildPreviewRequestForAction = (
  profile: SyncProfile,
  action: "push" | "pull",
): PreviewRequestPlan | null => {
  if (profile.mode === "subtree") {
    if (action === "push") {
      return null;
    }

    return {
      action,
      mode: "subtree",
      direction: "from-primary",
    };
  }

  if (!profile.primaryPath) {
    return null;
  }

  return action === "push"
    ? {
        action,
        mode: profile.mode,
        src: profile.projectPath,
        dest: profile.primaryPath,
      }
    : {
        action,
        mode: profile.mode,
        src: profile.primaryPath,
        dest: profile.projectPath,
      };
};

export const getSyncDirectionForAction = (action: "push" | "pull") =>
  action === "push" ? "to-primary" : "from-primary";

export const buildPreviewRequestsForProfile = (
  profile: SyncProfile,
): PreviewRequestPlan[] => {
  if (profile.mode === "subtree") {
    return [
      {
        action: "pull",
        mode: "subtree",
        direction: "from-primary",
      },
    ];
  }

  if (!profile.primaryPath) {
    return [];
  }

  return [
    {
      action: "push",
      mode: profile.mode,
      src: profile.projectPath,
      dest: profile.primaryPath,
    },
    {
      action: "pull",
      mode: profile.mode,
      src: profile.primaryPath,
      dest: profile.projectPath,
    },
  ];
};
