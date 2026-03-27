// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ClaudeGlobalConfig } from "./claude-global-config";

const readGlobalClaudeConfigMock = vi.hoisted(() => vi.fn<() => Promise<string>>());
const writeGlobalClaudeConfigMock = vi.hoisted(
  () => vi.fn<(contents: string) => Promise<void>>(),
);
const openGlobalClaudeConfigMock = vi.hoisted(
  () => vi.fn<(editor: string) => Promise<void>>(),
);

vi.mock("../lib/tauri", () => ({
  readGlobalClaudeConfig: readGlobalClaudeConfigMock,
  writeGlobalClaudeConfig: writeGlobalClaudeConfigMock,
  openGlobalClaudeConfig: openGlobalClaudeConfigMock,
}));

vi.mock("@acme/ui/components/button", () => {
  const Button = ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  );

  return { Button };
});

vi.mock("@acme/ui/components/input", () => {
  const Input = (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />;

  return { Input };
});

vi.mock("@acme/ui/components/tooltip", () => ({
  TooltipProvider: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  Tooltip: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@acme/ui/components/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  DropdownMenuItem: ({
    children,
    onClick,
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
  }) => <button type="button" onClick={onClick}>{children}</button>,
}));

vi.mock("@acme/ui/components/select", async () => {
  type Option = { label: string; value: string };

  const Select = ({
    id,
    value,
    options = [],
    onChange,
    placeholder,
    disabled,
    "aria-label": ariaLabel,
  }: {
    id?: string;
    value?: string;
    options?: Option[];
    onChange?: (value: string) => void;
    placeholder?: string;
    disabled?: boolean;
    "aria-label"?: string;
  }) => (
    <select
      aria-label={ariaLabel}
      disabled={disabled}
      id={id}
      value={value}
      onChange={(event) => onChange?.(event.target.value)}
    >
      {placeholder ? <option value="">{placeholder}</option> : null}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );

  return { Select };
});

describe("ClaudeGlobalConfig", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    const storage = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      writable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => {
          storage.set(key, value);
        },
        removeItem: (key: string) => {
          storage.delete(key);
        },
        clear: () => {
          storage.clear();
        },
      },
    });
    readGlobalClaudeConfigMock.mockReset();
    writeGlobalClaudeConfigMock.mockReset();
    openGlobalClaudeConfigMock.mockReset();
    writeGlobalClaudeConfigMock.mockResolvedValue();
    openGlobalClaudeConfigMock.mockResolvedValue();
  });

  it("hides the context-window control when there is no explicit Claude model", async () => {
    readGlobalClaudeConfigMock.mockResolvedValue(
      JSON.stringify({
        permissions: { allow: [], deny: [] },
      }),
    );

    render(<ClaudeGlobalConfig />);

    await screen.findByText("Allowed Permissions");

    expect(screen.queryByLabelText(/context window/i)).toBeNull();
    expect(screen.getByText(/supported claude model/i)).toBeTruthy();
  });

  it("renders supported options and defaults for claude-opus-4-6", async () => {
    readGlobalClaudeConfigMock.mockResolvedValue(
      JSON.stringify({
        model: "claude-opus-4-6",
        permissions: { allow: [], deny: [] },
      }),
    );

    render(<ClaudeGlobalConfig />);

    const select = (await screen.findByLabelText(/context window/i)) as HTMLSelectElement;

    expect(select.value).toBe("default");
    expect(screen.getByRole("option", { name: /200k/i })).toBeTruthy();
    expect(screen.getByRole("option", { name: /1m/i })).toBeTruthy();
  });

  it("rewrites model to 1m when the selection changes", async () => {
    readGlobalClaudeConfigMock.mockResolvedValue(
      JSON.stringify({
        model: "claude-opus-4-6",
        permissions: { allow: [], deny: [] },
        theme: "dark",
      }),
    );

    render(<ClaudeGlobalConfig />);

    const select = (await screen.findByLabelText(/context window/i)) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "1m" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(writeGlobalClaudeConfigMock).toHaveBeenCalledTimes(1);
    });

    const firstWriteCall = writeGlobalClaudeConfigMock.mock.calls[0];
    if (!firstWriteCall) {
      throw new Error("Expected config write call");
    }

    const [savedConfig] = firstWriteCall;
    if (savedConfig === undefined) {
      throw new Error("Expected saved config contents");
    }

    expect(JSON.parse(savedConfig)).toEqual({
      model: "claude-opus-4-6[1m]",
      permissions: { allow: [], deny: [] },
      theme: "dark",
    });
  });

  it("removes the 1m suffix when switching back to default", async () => {
    readGlobalClaudeConfigMock.mockResolvedValue(
      JSON.stringify({
        model: "claude-opus-4-6[1m]",
        permissions: { allow: [], deny: [] },
      }),
    );

    render(<ClaudeGlobalConfig />);

    const select = (await screen.findByLabelText(/context window/i)) as HTMLSelectElement;
    expect(select.value).toBe("1m");

    fireEvent.change(select, { target: { value: "default" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(writeGlobalClaudeConfigMock).toHaveBeenCalledTimes(1);
    });

    const firstWriteCall = writeGlobalClaudeConfigMock.mock.calls[0];
    if (!firstWriteCall) {
      throw new Error("Expected config write call");
    }

    const [savedConfig] = firstWriteCall;
    if (savedConfig === undefined) {
      throw new Error("Expected saved config contents");
    }

    expect(JSON.parse(savedConfig)).toEqual({
      model: "claude-opus-4-6",
      permissions: { allow: [], deny: [] },
    });
  });

  it("preserves permissions editing, sorting, saving, and unknown keys", async () => {
    readGlobalClaudeConfigMock.mockResolvedValue(
      JSON.stringify({
        model: "claude-opus-4-6",
        permissions: {
          allow: ["Bash(z:*)"],
          deny: ["Bash(zebra:*)"],
        },
        customFlag: true,
      }),
    );

    render(<ClaudeGlobalConfig />);

    await screen.findByLabelText(/context window/i);

    fireEvent.change(screen.getByPlaceholderText("e.g. Bash(git:*)"), {
      target: { value: "Bash(a:*)" },
    });
    const addButtons = screen.getAllByRole("button", { name: /add/i });
    const addAllowButton = addButtons[0];
    if (!addAllowButton) {
      throw new Error("Expected allow add button");
    }

    fireEvent.click(addAllowButton);

    fireEvent.change(screen.getByPlaceholderText("e.g. Bash(git push *)"), {
      target: { value: "Bash(alpha:*)" },
    });
    const addDenyButton = addButtons[1];
    if (!addDenyButton) {
      throw new Error("Expected deny add button");
    }

    fireEvent.click(addDenyButton);

    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(writeGlobalClaudeConfigMock).toHaveBeenCalledTimes(1);
    });

    const firstWriteCall = writeGlobalClaudeConfigMock.mock.calls[0];
    if (!firstWriteCall) {
      throw new Error("Expected config write call");
    }

    const [savedConfig] = firstWriteCall;
    if (savedConfig === undefined) {
      throw new Error("Expected saved config contents");
    }

    expect(JSON.parse(savedConfig)).toEqual({
      model: "claude-opus-4-6",
      permissions: {
        allow: ["Bash(a:*)", "Bash(z:*)"],
        deny: ["Bash(alpha:*)", "Bash(zebra:*)"],
      },
      customFlag: true,
    });
  });
});
