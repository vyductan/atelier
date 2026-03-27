// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  ClaudeContextWindowOption,
  ClaudeContextWindowValue,
} from "../lib/claude-model-capabilities";
import { SessionContextWindowSelector } from "./session-context-window-selector";

vi.mock("@acme/ui/components/select", async () => {
  type Option = { label: string; value: string };

  const Select = ({
    id,
    value,
    options = [],
    onChange,
    disabled,
    "aria-label": ariaLabel,
  }: {
    id?: string;
    value?: string;
    options?: Option[];
    onChange?: (value: string) => void;
    disabled?: boolean;
    "aria-label"?: string;
  }) => (
    <select
      aria-label={ariaLabel}
      disabled={disabled}
      id={id}
      value={value ?? ""}
      onChange={(event) => onChange?.(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );

  return { Select };
});

const defaultAnd1mOptions: ClaudeContextWindowOption[] = [
  { value: "default", label: "200k", isDefault: true },
  { value: "1m", label: "1M" },
];

function renderSelector({
  baseModel = "claude-opus-4-6",
  value = "default",
  options = defaultAnd1mOptions,
  onChange = vi.fn(),
}: {
  baseModel?: string | null;
  value?: ClaudeContextWindowValue | null;
  options?: ClaudeContextWindowOption[];
  onChange?: (value: ClaudeContextWindowValue) => void;
} = {}) {
  return {
    onChange,
    ...render(
      <SessionContextWindowSelector
        baseModel={baseModel}
        value={value}
        options={options}
        onChange={onChange}
      />,
    ),
  };
}

afterEach(() => {
  cleanup();
});

describe("SessionContextWindowSelector", () => {
  it("renders nothing when there is no known base model", () => {
    renderSelector({ baseModel: null });

    expect(screen.queryByLabelText(/context window/i)).toBeNull();
  });

  it("renders nothing when there is only one option", () => {
    renderSelector({
      options: [{ value: "default", label: "200k", isDefault: true }],
    });

    expect(screen.queryByLabelText(/context window/i)).toBeNull();
  });

  it("shows the selector when both default and 1m options exist", () => {
    renderSelector();

    const select = screen.getByLabelText(/context window/i) as HTMLSelectElement;
    expect(select.value).toBe("default");
    expect(screen.getByRole("option", { name: "200k" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "1M" })).toBeTruthy();
  });

  it("calls onChange with the selected context window", () => {
    const onChange = vi.fn();
    renderSelector({ onChange });

    fireEvent.change(screen.getByLabelText(/context window/i), {
      target: { value: "1m" },
    });

    expect(onChange).toHaveBeenCalledWith("1m");
  });
});
