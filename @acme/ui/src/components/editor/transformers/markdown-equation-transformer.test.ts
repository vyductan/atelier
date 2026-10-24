import { $generateHtmlFromNodes, $generateNodesFromDOM } from "@lexical/html";
import { $isElementNode, createEditor } from "lexical";
import { describe, expect, test } from "vitest";

import { $isEquationNode } from "../nodes/equation-node";
import { nodes } from "../nodes/nodes";
import {
  lexicalContentToMarkdown,
  markdownToLexicalContent,
} from "../utils/lexical-converter";

const equationsIn = (markdown: string): string[] => {
  const found: string[] = [];
  const walk = (node: {
    type?: string;
    equation?: string;
    children?: unknown[];
  }) => {
    if (node.type === "equation" && node.equation !== undefined) {
      found.push(node.equation);
    }
    for (const child of node.children ?? []) walk(child as typeof node);
  };
  walk(markdownToLexicalContent(markdown).root as Parameters<typeof walk>[0]);
  return found;
};

describe("EQUATION markdown transformer", () => {
  test("reads $...$ math as an equation", () => {
    expect(equationsIn("Area is $\\pi r^2$ here.")).toStrictEqual(["\\pi r^2"]);
  });

  test("leaves prose with dollar amounts as text", () => {
    const markdown = 'sign: "$" ← modal hiển thị ($633, $56.97)';

    expect(equationsIn(markdown)).toStrictEqual([]);
    expect(lexicalContentToMarkdown(markdownToLexicalContent(markdown))).toBe(
      markdown,
    );
  });

  test("leaves two $param paths on one line as text", () => {
    const markdown =
      "service-catalog/$experience_id/components and allotments/$id/components";

    expect(equationsIn(markdown)).toStrictEqual([]);
  });
});

describe("EquationNode DOM export", () => {
  test("round-trips an equation with non-Latin1 characters", () => {
    const equation = String.raw`\text{Phí dịch vụ} \le 5`;
    const editor = createEditor({
      nodes,
      onError: (error) => {
        throw error;
      },
    });
    editor.setEditorState(
      editor.parseEditorState(
        JSON.stringify(markdownToLexicalContent(`$${equation}$`)),
      ),
    );

    // Threw InvalidCharacterError from btoa before the UTF-8 encoding.
    const html = editor
      .getEditorState()
      .read(() => $generateHtmlFromNodes(editor));
    expect(html).toContain("data-lexical-equation");

    let imported: string | undefined;
    editor.update(
      () => {
        const dom = new DOMParser().parseFromString(html, "text/html");
        for (const node of $generateNodesFromDOM(editor, dom)) {
          const found = [
            node,
            ...($isElementNode(node) ? node.getChildren() : []),
          ].find($isEquationNode);
          if (found) imported = found.getEquation();
        }
      },
      { discrete: true },
    );
    expect(imported).toBe(equation);
  });
});
