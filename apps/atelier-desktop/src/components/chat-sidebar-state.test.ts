import { describe, expect, it } from "vitest";

import {
  buildRenameFailureMessage,
  shouldCloseRenameEditor,
} from "./chat-sidebar-state";

describe("shouldCloseRenameEditor", () => {
  it("keeps the rename editor open when rename persistence fails", () => {
    expect(
      shouldCloseRenameEditor({ ok: false, error: new Error("disk full") }),
    ).toBe(false);
  });

  it("closes the rename editor after a successful rename", () => {
    expect(shouldCloseRenameEditor({ ok: true })).toBe(true);
  });
});

describe("buildRenameFailureMessage", () => {
  it("surfaces the rename error instead of swallowing it", () => {
    expect(buildRenameFailureMessage(new Error("permission denied"))).toBe(
      "Rename failed: permission denied",
    );
  });
});
