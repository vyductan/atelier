---
name: install-deps
description: Install the vyductan.dev workspace dependencies (node_modules) in Dev's worktree before running a typecheck, lint or tests. Use at the start of every review, before any pnpm/vitest/tsc command.
---

# Install dependencies in Dev's worktree

Your sandbox lets this work, and only this way: the npm registry (plus `cdn.sheetjs.com`, one tarball in the lockfile) is reachable, the worktree's `node_modules` folders are writable, and pnpm keeps its store, cache and state in `~/.vyductan-team/review/pnpm`. The owner's own pnpm store under `~/Library` is off limits on purpose: an install script from a bot-written lockfile must not be able to touch it.

1. Install exactly what the branch's lockfile says, from the worktree root, with output kept in your folder:

   ```bash
   W=~/Developer/vyductan-agent; P=~/.vyductan-team/review/pnpm
   cd $W && XDG_CACHE_HOME=$P/cache XDG_STATE_HOME=$P/state XDG_DATA_HOME=$P/data \
     pnpm install --frozen-lockfile --store-dir $P/store > ~/.vyductan-team/review/runs/install.txt 2>&1; echo "exit $?"
   tail -20 ~/.vyductan-team/review/runs/install.txt
   ```

   The first install fills the store and takes a while; later ones reuse it and take seconds when nothing changed.
2. Never drop `--frozen-lockfile`, never run `pnpm add`, `pnpm update` or `pnpm install` without it, and never edit `package.json`, `pnpm-lock.yaml` or `pnpm-workspace.yaml`: you check Dev's dependencies, you do not change them.
3. If the branch changed `package.json`, `pnpm-lock.yaml` or `pnpm-workspace.yaml` (see `git -C $W diff --name-only origin/main...HEAD`), say so in your review: the owner should look at new or upgraded packages when merging.
4. If the install fails, quote the error's last lines, say "could not install", and judge from the code. A failed install is not by itself a fail: a lockfile out of date with `package.json` is (Dev broke the install), a network or sandbox error is not.
5. Then run the narrowest checks as usual. If one still fails on a blocked write (a cache or build info file outside `node_modules`), say which path it was blocked on: that is "could not run", not a fail.
