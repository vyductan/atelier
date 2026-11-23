#!/bin/zsh
# Installs team/settings/<bot>.json as each bot's cwd .claude/settings.json,
# and team/skills/<bot>/* as its cwd .claude/skills/.
# These files are the bots' hard limits (OpenMausBot runs claude with
# --setting-sources project); edit them here, review, then run this script.
#
# Path anchors in Claude Code permission rules: "~/x" is the home dir, "//x" is
# the filesystem root, and "/x" is RELATIVE TO THE SETTINGS FILE, so never write
# an absolute path with a single leading slash.
set -euo pipefail
here=${0:A:h}/settings
typeset -A cwd=(
  cos    "$HOME/.atelier/openmausbot/workspaces/cos"
  ops    "$HOME/.atelier/openmausbot/workspaces/ops"
  dev    "$HOME/Developer/vyductan-agent"
  review "$HOME/.vyductan-team/review"
  tester "$HOME/.vyductan-team/tester"
  bl3q-lead   "$HOME/.bl3q-team/lead"
  bl3q-fix    "$HOME/Developer/g-bots/bl3q-agent"
  bl3q-verifier "$HOME/.bl3q-team/review"
  intake      "$HOME/.atelier/openmausbot/workspaces/intake"
  bl3q-intake "$HOME/.atelier/openmausbot/workspaces/bl3q-intake"
)
for bot dir in ${(kv)cwd}; do
  [[ -d $dir ]] || { print -u2 "missing cwd for $bot: $dir"; exit 1; }
  mkdir -p "$dir/.claude"
  cp "$here/$bot.json" "$dir/.claude/settings.json"
  print "installed $bot -> $dir/.claude/settings.json"
  # Bot-only hooks: team/hooks/<bot>/* -> cwd .claude/hooks/. None today. Dropping a bot's
  # hooks here does not remove its installed copy: delete that by hand (a Dev worktree may
  # track a .claude/hooks of its own, so the script never deletes one).
  if [[ -d ${here:h}/hooks/$bot ]]; then
    # Copy beside, then swap: the hook path is never missing mid-install.
    rm -rf "$dir/.claude/hooks.new" "$dir/.claude/hooks.old"
    cp -R "${here:h}/hooks/$bot" "$dir/.claude/hooks.new"
    [[ -e $dir/.claude/hooks ]] && mv "$dir/.claude/hooks" "$dir/.claude/hooks.old"
    mv "$dir/.claude/hooks.new" "$dir/.claude/hooks"
    rm -rf "$dir/.claude/hooks.old"
    print "installed $bot hooks"
  fi
  # Bot-only skills: team/skills/<bot>/<skill>/ -> cwd .claude/skills/ (project
  # skills are the only ones --setting-sources project loads).
  if [[ -d ${here:h}/skills/$bot ]]; then
    for skill in ${here:h}/skills/$bot/*(/); do
      rm -rf "$dir/.claude/skills/${skill:t}"
      mkdir -p "$dir/.claude/skills"
      cp -R "$skill" "$dir/.claude/skills/"
      print "installed $bot skill ${skill:t}"
    done
  fi
done
# Shared worker rules (team/worker.md, after pstack's worker.md) -> cwd .claude/worker.md of
# every bot that does handed-out work; each SOUL's first line points there. Coordinators
# (CoS, bl3q-lead) and the intake/ops bots do not get it. In a git worktree the copy is
# untracked, so it goes in the repo's info/exclude, never in a commit.
for bot in dev review tester bl3q-fix bl3q-verifier; do
  dir=${cwd[$bot]}
  cp "${here:h}/worker.md" "$dir/.claude/worker.md.new" && mv "$dir/.claude/worker.md.new" "$dir/.claude/worker.md"
  print "installed $bot worker.md"
  if git -C "$dir" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    exclude=$(git -C "$dir" rev-parse --path-format=absolute --git-path info/exclude)
    mkdir -p "${exclude:h}"
    grep -qxF '.claude/worker.md' "$exclude" 2>/dev/null || print '.claude/worker.md' >> "$exclude"
  fi
done
# Dev's worktree tracks the repo's own .claude/settings.json; keep ours out of commits.
git -C "${cwd[dev]}" update-index --skip-worktree .claude/settings.json
