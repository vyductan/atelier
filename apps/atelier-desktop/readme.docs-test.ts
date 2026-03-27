import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const readme = readFileSync(new URL("README.md", import.meta.url), "utf8");
const plan = readFileSync(
  new URL(
    "../../docs/plans/2026-03-06-atelier-github-style-diff.md",
    import.meta.url,
  ),
  "utf8",
);

assert.match(readme, /pnpm tauri:dev/);
assert.doesNotMatch(readme, /pnpm atelier:dev/);
assert.doesNotMatch(readme, /Real-time status/);
assert.match(readme, /status labels/i);
assert.doesNotMatch(readme, /timestamps and preview refresh/i);
assert.doesNotMatch(plan, /pnpm atelier:dev/);
