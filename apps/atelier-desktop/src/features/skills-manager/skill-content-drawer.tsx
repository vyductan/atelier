import { useEffect, useState } from "react";
import { ExternalLink, FileText, FolderOpen, Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Button } from "@acme/ui/components/button";
import { CodeBlock } from "@acme/ui/components/code-block";
import { Drawer } from "@acme/ui/components/drawer";

import type { InstalledSkill } from "../../lib/skills-client";
import type { SkillFiles } from "../../lib/tauri";
import { getSkillFiles, openSkillPath, readSkillFile } from "../../lib/tauri";
import { languageOf, splitFrontMatter } from "./skill-content";

const markdownComponents = {
  h1: (props: React.ComponentPropsWithoutRef<"h1">) => (
    <h1 className="mt-5 mb-2 text-lg font-semibold first:mt-0" {...props} />
  ),
  h2: (props: React.ComponentPropsWithoutRef<"h2">) => (
    <h2
      className="mt-5 mb-2 border-b pb-1 text-base font-semibold"
      {...props}
    />
  ),
  h3: (props: React.ComponentPropsWithoutRef<"h3">) => (
    <h3 className="mt-4 mb-1.5 text-sm font-semibold" {...props} />
  ),
  p: (props: React.ComponentPropsWithoutRef<"p">) => (
    <p className="my-2 leading-relaxed" {...props} />
  ),
  ul: (props: React.ComponentPropsWithoutRef<"ul">) => (
    <ul className="my-2 list-disc space-y-1 pl-5" {...props} />
  ),
  ol: (props: React.ComponentPropsWithoutRef<"ol">) => (
    <ol className="my-2 list-decimal space-y-1 pl-5" {...props} />
  ),
  blockquote: (props: React.ComponentPropsWithoutRef<"blockquote">) => (
    <blockquote
      className="my-2 border-l-2 pl-3 text-muted-foreground"
      {...props}
    />
  ),
  a: (props: React.ComponentPropsWithoutRef<"a">) => (
    <a
      className="text-primary underline"
      target="_blank"
      rel="noreferrer"
      {...props}
    />
  ),
  table: (props: React.ComponentPropsWithoutRef<"table">) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-xs" {...props} />
    </div>
  ),
  th: (props: React.ComponentPropsWithoutRef<"th">) => (
    <th className="border px-2 py-1 text-left font-semibold" {...props} />
  ),
  td: (props: React.ComponentPropsWithoutRef<"td">) => (
    <td className="border px-2 py-1 align-top" {...props} />
  ),
  code({ className, children }: React.ComponentPropsWithoutRef<"code">) {
    if (className?.includes("language-")) {
      return (
        <CodeBlock language={className.replace("language-", "")}>
          {String(children).replace(/\n$/, "")}
        </CodeBlock>
      );
    }
    return (
      <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12px]">
        {children}
      </code>
    );
  },
} as const;

function FileBody({ name, text }: { name: string; text: string }) {
  const language = languageOf(name);
  if (language !== "markdown")
    return <CodeBlock language={language}>{text}</CodeBlock>;
  const { frontMatter, body } = splitFrontMatter(text);
  return (
    <>
      {frontMatter ? (
        <details className="mb-3 rounded-md border bg-muted/30 text-xs" open>
          <summary className="cursor-pointer px-2.5 py-1.5 font-medium text-muted-foreground">
            Front matter: what the agent reads to decide when to load it
          </summary>
          <pre className="overflow-x-auto px-2.5 pb-2 font-mono text-[12px] whitespace-pre-wrap">
            {frontMatter}
          </pre>
        </details>
      ) : null}
      <div className="text-sm">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={markdownComponents}
        >
          {body}
        </ReactMarkdown>
      </div>
    </>
  );
}

/** Loaded text of one file, tagged with which file it is. */
type Loaded = { file: string; text: string } | { file: string; error: string };

/**
 * One skill's files. Keyed by path, so opening another skill starts fresh;
 * state only changes in async callbacks.
 */
function SkillFilesView({
  path,
  onTarget,
}: {
  path: string;
  onTarget: (target: string) => void;
}) {
  const [files, setFiles] = useState<SkillFiles | { error: string } | null>(
    null,
  );
  const [picked, setPicked] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    let live = true;
    getSkillFiles(path)
      .then((listed) => {
        if (live) setFiles(listed);
      })
      .catch((error: unknown) => {
        if (live) setFiles({ error: String(error) });
      });
    return () => {
      live = false;
    };
  }, [path]);

  const listed = files && "files" in files ? files : null;
  const selected = picked ?? listed?.main ?? null;

  useEffect(() => {
    if (!listed || !selected) return;
    onTarget(`${listed.root}/${selected}`);
    let live = true;
    readSkillFile(listed.root, selected)
      .then((text) => {
        if (live) setLoaded({ file: selected, text });
      })
      .catch((error: unknown) => {
        if (live) setLoaded({ file: selected, error: String(error) });
      });
    return () => {
      live = false;
    };
  }, [listed, selected, onTarget]);

  const current = loaded?.file === selected ? loaded : null;
  const error =
    files && "error" in files
      ? files.error
      : current && "error" in current
        ? current.error
        : null;

  return (
    <div className="flex h-full min-h-0 gap-3">
      {listed && listed.files.length > 1 ? (
        <nav className="w-44 shrink-0 overflow-y-auto border-r pr-2 text-xs">
          {listed.files.map((file) => (
            <button
              key={file}
              type="button"
              onClick={() => setPicked(file)}
              title={file}
              className={`flex w-full items-center gap-1.5 truncate rounded px-1.5 py-1 text-left ${file === selected ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"}`}
            >
              <FileText className="size-3 shrink-0" />
              <span className="truncate">{file}</span>
            </button>
          ))}
          {listed.truncated ? (
            <p className="px-1.5 py-1 text-muted-foreground">
              More files in Finder…
            </p>
          ) : null}
        </nav>
      ) : null}
      <div className="min-w-0 flex-1 overflow-y-auto pr-1">
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : current && "text" in current ? (
          <FileBody name={current.file} text={current.text} />
        ) : (
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        )}
      </div>
    </div>
  );
}

/** Read-only view of a skill's files; editing happens in the editor. */
export function SkillContentDrawer({
  skill,
  onClose,
}: {
  skill: InstalledSkill | null;
  onClose: () => void;
}) {
  // The file on screen, for the editor/Finder buttons; the skill path until one loads.
  const [target, setTarget] = useState<string | null>(null);
  const openTarget = target ?? skill?.path ?? "";
  const title = skill?.plugin
    ? `${skill.plugin.kind === "command" ? "/" : ""}${skill.plugin.invokeName}`
    : skill?.name;

  return (
    <Drawer
      open={skill !== null}
      onClose={() => {
        setTarget(null);
        onClose();
      }}
      placement="right"
      size={760}
      resizable
      title={<span className="font-mono text-sm">{title}</span>}
      extra={
        <div className="flex gap-1.5">
          <Button
            type="default"
            size="small"
            icon={<ExternalLink className="size-3.5" />}
            onClick={() => void openSkillPath(openTarget, false)}
            disabled={!openTarget}
          >
            Open in editor
          </Button>
          <Button
            type="default"
            size="small"
            icon={<FolderOpen className="size-3.5" />}
            onClick={() => void openSkillPath(openTarget, true)}
            disabled={!openTarget}
          >
            Finder
          </Button>
        </div>
      }
    >
      {skill ? (
        <SkillFilesView
          key={skill.path}
          path={skill.path}
          onTarget={setTarget}
        />
      ) : null}
    </Drawer>
  );
}
