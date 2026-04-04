// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SessionTranscript } from "./session-transcript";

vi.mock("@acme/ui/components/code-block", () => ({
  CodeBlock: ({ children, language }: { children: string; language?: string }) => (
    <pre data-language={language ?? "plain"}>{children}</pre>
  ),
}));

afterEach(() => {
  cleanup();
});

describe("SessionTranscript", () => {
  it("renders tool calls collapsed by default while preserving surrounding text", () => {
    render(
      <SessionTranscript
        messages={[
          {
            role: "assistant",
            text: 'Before<tool_use name="Skill">{"skill":"using-superpowers"}</tool_use>After',
          },
        ]}
        isLoading={false}
        bottomRef={{ current: null }}
      />,
    );

    expect(screen.getByText("Before")).toBeTruthy();
    expect(screen.getByText("After")).toBeTruthy();

    const details = document.querySelector("details");
    if (!(details instanceof HTMLDetailsElement)) {
      throw new TypeError("Expected tool call details element");
    }

    expect(details.open).toBe(false);
    expect(screen.getByText("Skill tool call")).toBeTruthy();
  });

  it("pretty prints valid JSON payloads inside tool calls", async () => {
    render(
      <SessionTranscript
        messages={[
          {
            role: "assistant",
            text: '<tool_use name="Skill">{"skill":"using-superpowers"}</tool_use>',
          },
        ]}
        isLoading={false}
        bottomRef={{ current: null }}
      />,
    );

    const details = document.querySelector("details");
    if (!(details instanceof HTMLDetailsElement)) {
      throw new TypeError("Expected tool call details element");
    }

    fireEvent.click(screen.getByText("Skill tool call"));

    await waitFor(() => {
      const codeBlock = document.querySelector('pre[data-language="json"]');
      if (!(codeBlock instanceof HTMLPreElement)) {
        throw new TypeError("Expected JSON code block");
      }

      expect(codeBlock.textContent).toBe(`{
  "skill": "using-superpowers"
}`);
    });
  });

  it("falls back to raw content when the tool payload is not valid JSON", async () => {
    render(
      <SessionTranscript
        messages={[
          {
            role: "assistant",
            text: '<tool_use name="Skill">not-json</tool_use>',
          },
        ]}
        isLoading={false}
        bottomRef={{ current: null }}
      />,
    );

    fireEvent.click(screen.getByText("Skill tool call"));

    await waitFor(() => {
      expect(screen.getByText("not-json")).toBeTruthy();
      const codeBlock = document.querySelector("pre");
      if (!(codeBlock instanceof HTMLPreElement)) {
        throw new TypeError("Expected fallback code block");
      }

      expect(codeBlock.dataset.language).toBe("plain");
    });
  });

  it("preserves raw payload whitespace for invalid tool content", async () => {
    render(
      <SessionTranscript
        messages={[
          {
            role: "assistant",
            text: '<tool_use name="Skill">  not-json  </tool_use>',
          },
        ]}
        isLoading={false}
        bottomRef={{ current: null }}
      />,
    );

    fireEvent.click(screen.getByText("Skill tool call"));

    await waitFor(() => {
      const codeBlock = document.querySelector("pre");
      if (!(codeBlock instanceof HTMLPreElement)) {
        throw new TypeError("Expected fallback code block");
      }

      expect(codeBlock.textContent).toBe("  not-json  ");
      expect(codeBlock.dataset.language).toBe("plain");
    });
  });
});
