#!/bin/zsh
# Installs team/settings/<bot>.json as each bot's cwd .claude/settings.json.
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
  bl3q-lead   "$HOME/.bl3q-team/lead"
  bl3q-fix    "$HOME/Developer/g-bots/bl3q-agent"
  bl3q-review "$HOME/.bl3q-team/review"
)
for bot dir in ${(kv)cwd}; do
  [[ -d $dir ]] || { print -u2 "missing cwd for $bot: $dir"; exit 1; }
  mkdir -p "$dir/.claude"
  cp "$here/$bot.json" "$dir/.claude/settings.json"
  print "installed $bot -> $dir/.claude/settings.json"
done
# Dev's worktree tracks the repo's own .claude/settings.json; keep ours out of commits.
git -C "${cwd[dev]}" update-index --skip-worktree .claude/settings.json
