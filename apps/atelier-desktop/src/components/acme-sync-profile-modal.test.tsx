// @vitest-environment jsdom

import assert from "node:assert/strict";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AcmeSyncProfileModal } from "./acme-sync-profile-modal";

const getLastInputById = (id: string): HTMLInputElement => {
  const elements = document.querySelectorAll(`#${id}`);
  const element = elements.item(elements.length - 1);

  assert.ok(
    element instanceof HTMLInputElement,
    `Expected input #${id} to exist`,
  );
  return element;
};

const getLastSelectById = (id: string): HTMLSelectElement => {
  const elements = document.querySelectorAll(`#${id}`);
  const element = elements.item(elements.length - 1);

  assert.ok(
    element instanceof HTMLSelectElement,
    `Expected select #${id} to exist`,
  );
  return element;
};

describe("AcmeSyncProfileModal", () => {
  it("shows subtree fields when subtree mode is selected", () => {
    render(
      <AcmeSyncProfileModal
        open
        profile={{
          id: "1",
          projectPath: "/repo/project-a",
          primaryPath: "/repo/primary",
          mode: "subtree",
          subtree: {
            repoRoot: "/repo/project-a",
            prefix: "@acme",
            remote: "origin",
            branch: "main",
            squash: true,
          },
        }}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Source remote")).toBeTruthy();
    expect(screen.getByLabelText("Source branch")).toBeTruthy();
  });

  it("shows clarified subtree labels and helper copy", () => {
    render(
      <AcmeSyncProfileModal
        open
        profile={{
          id: "1",
          projectPath: "/repo/project-a",
          primaryPath: "/repo/primary",
          mode: "subtree",
          subtree: {
            repoRoot: "/repo/project-a",
            prefix: "@acme",
            remote: "origin",
            branch: "main",
            squash: true,
          },
        }}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Project subtree path")).toBeTruthy();
    expect(screen.getByLabelText("Project repo root")).toBeTruthy();
    expect(screen.getByLabelText("Source remote")).toBeTruthy();
    expect(screen.getByLabelText("Source branch")).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Squash" })).toBeTruthy();
    expect(
      screen.getAllByText(
        "Combine pulled subtree changes into a smaller history.",
      ).length,
    ).toBeGreaterThanOrEqual(1);

    expect(
      screen.getAllByText(
        /fixed path inside the project repo where the subtree lives/i,
      ).length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      screen.getAllByText(
        /git subtree commands run in the project repo where this subtree lives/i,
      ).length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      screen.getAllByText(/source ref used for subtree pulls/i).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("saves subtree settings with fixed @acme prefix in hybrid mode", () => {
    const onSave = vi.fn();

    render(
      <AcmeSyncProfileModal
        open
        profile={{
          id: "1",
          projectPath: "/repo/project-a",
          primaryPath: "/repo/primary",
          mode: "subtree",
          subtree: {
            repoRoot: "/repo/project-a",
            prefix: "@acme",
            remote: "origin",
            branch: "main",
            squash: false,
          },
        }}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );

    const dialog = screen.getAllByRole("dialog").at(-1);
    assert.ok(dialog, "Expected dialog to exist");
    const view = within(dialog);
    const remoteInput = getLastInputById("acme-sync-remote");
    const branchInput = getLastInputById("acme-sync-branch");
    const squashCheckbox = view.getByRole("checkbox", { name: "Squash" });

    fireEvent.change(remoteInput, {
      target: { value: "upstream" },
    });
    fireEvent.change(branchInput, {
      target: { value: "release" },
    });
    fireEvent.click(squashCheckbox);
    fireEvent.click(view.getByText("Save"));

    expect(onSave).toHaveBeenCalledWith({
      mode: "subtree",
      rsync: {
        useGitSafetyChecks: false,
      },
      subtree: {
        repoRoot: "/repo/project-a",
        prefix: "@acme",
        remote: "upstream",
        branch: "release",
        squash: true,
      },
    });
  });

  it("supports selecting patch mode and saving it", () => {
    const onSave = vi.fn();

    render(
      <AcmeSyncProfileModal
        open
        profile={{
          id: "1",
          projectPath: "/repo/project-a",
          primaryPath: "/repo/primary",
          mode: "rsync",
          rsync: {
            useGitSafetyChecks: true,
          },
        }}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );

    fireEvent.change(getLastSelectById("acme-sync-profile-mode"), {
      target: { value: "patch" },
    });
    const dialog = screen.getAllByRole("dialog").at(-1);
    assert.ok(dialog, "Expected dialog to exist");
    fireEvent.click(within(dialog).getByText("Save"));

    expect(onSave).toHaveBeenCalledWith({
      mode: "patch",
      rsync: {
        useGitSafetyChecks: true,
      },
      subtree: {
        repoRoot: "/repo/project-a",
        prefix: "@acme",
        remote: "origin",
        branch: "main",
        squash: true,
      },
    });
  });

  it("resets form state when a different profile is opened across modes", () => {
    const { rerender } = render(
      <AcmeSyncProfileModal
        open
        profile={{
          id: "1",
          projectPath: "/repo/project-a",
          primaryPath: "/repo/primary",
          mode: "subtree",
          subtree: {
            repoRoot: "/repo/project-a",
            prefix: "@acme",
            remote: "origin",
            branch: "main",
            squash: true,
          },
        }}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    fireEvent.change(getLastInputById("acme-sync-remote"), {
      target: { value: "upstream" },
    });

    rerender(
      <AcmeSyncProfileModal
        open
        profile={{
          id: "2",
          projectPath: "/repo/project-b",
          primaryPath: "/repo/primary",
          mode: "rsync",
          rsync: {
            useGitSafetyChecks: true,
          },
        }}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    const secondDialog = screen.getAllByRole("dialog").at(-1);
    assert.ok(secondDialog, "Expected dialog to exist");
    const view = within(secondDialog);

    expect(getLastSelectById("acme-sync-profile-mode").value).toBe("rsync");
    expect(
      (view.getByLabelText("Use git safety checks") as HTMLInputElement)
        .checked,
    ).toBe(true);
    expect(secondDialog.querySelector("#acme-sync-remote")).toBeNull();
  });
});
