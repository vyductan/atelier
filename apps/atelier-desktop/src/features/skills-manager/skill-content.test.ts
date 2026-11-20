import { describe, expect, it } from "vitest";

import { languageOf, splitFrontMatter } from "./skill-content";

describe("splitFrontMatter", () => {
  it("separates the YAML block from the body", () => {
    expect(
      splitFrontMatter("---\nname: a\ndescription: b\n---\n# Title\n"),
    ).toEqual({
      frontMatter: "name: a\ndescription: b",
      body: "# Title\n",
    });
  });

  it("leaves files without front matter whole", () => {
    expect(splitFrontMatter("# Just text\n---\n")).toEqual({
      frontMatter: null,
      body: "# Just text\n---\n",
    });
    expect(splitFrontMatter("---\nnever closed")).toEqual({
      frontMatter: null,
      body: "---\nnever closed",
    });
  });
});

describe("languageOf", () => {
  it("maps extensions to how the drawer shows them", () => {
    expect(languageOf("SKILL.md")).toBe("markdown");
    expect(languageOf("scripts/run.sh")).toBe("bash");
    expect(languageOf(".mcp.json")).toBe("json");
    expect(languageOf("LICENSE")).toBe("text");
  });
});
