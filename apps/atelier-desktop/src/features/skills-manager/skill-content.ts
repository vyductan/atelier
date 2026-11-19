/** Splits a Markdown file into its `---` front matter (raw YAML) and body. */
export function splitFrontMatter(text: string): {
  frontMatter: string | null;
  body: string;
} {
  const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(
    text,
  );
  if (!match) return { frontMatter: null, body: text };
  return { frontMatter: match[1] ?? "", body: text.slice(match[0].length) };
}

const LANGUAGES: Record<string, string> = {
  json: "json",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  py: "python",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  tsx: "tsx",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  html: "html",
  css: "css",
  sql: "sql",
};

/** "markdown" for `.md`, a highlighter language for code, else "text". */
export function languageOf(file: string): string {
  const ext = file.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "md" || ext === "mdx") return "markdown";
  return LANGUAGES[ext] ?? "text";
}
