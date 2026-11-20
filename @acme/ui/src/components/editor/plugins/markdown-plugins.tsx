"use client";

import type { EditorState } from "lexical";
import { useEffect, useRef } from "react";
import { $convertFromMarkdownString } from "@lexical/markdown";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";

import { $convertToMarkdownDocument } from "../transformers/markdown-document-export";
import { MARKDOWN_DOCUMENT_TRANSFORMERS } from "../transformers/markdown-transformers";

// Plugin to initialize editor with markdown content
function InitialMarkdownPlugin({ markdown }: { markdown: string }) {
  const [editor] = useLexicalComposerContext();
  const isInitializedReference = useRef(false);

  useEffect(() => {
    if (isInitializedReference.current) return;

    // Only initialize if markdown is provided and not empty
    if (markdown) {
      editor.update(() => {
        $convertFromMarkdownString(markdown, MARKDOWN_DOCUMENT_TRANSFORMERS);
      });
    }

    isInitializedReference.current = true;
  }, [editor, markdown]);

  return null;
}

interface MarkdownPluginsProperties {
  defaultValue?: string;
  value?: string;
  onChange?: (markdown: string, editorState: EditorState) => void;
}

export function MarkdownPlugins({
  defaultValue,
  value,
  onChange,
}: MarkdownPluginsProperties) {
  return (
    <>
      <InitialMarkdownPlugin markdown={defaultValue ?? value ?? ""} />

      <OnChangePlugin
        ignoreSelectionChange={true}
        onChange={(editorState) => {
          editorState.read(() => {
            const markdown = $convertToMarkdownDocument();
            onChange?.(markdown, editorState);
          });
        }}
      />
    </>
  );
}

// Default export for dynamic imports
export default MarkdownPlugins;
