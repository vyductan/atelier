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
  bl3q-lead   "$HOME/.bl3q-team/lead"
  bl3q-fix    "$HOME/Developer/g-bots/bl3q-agent"
  bl3q-review "$HOME/.bl3q-team/review"
)
for bot dir in ${(kv)cwd}; do
  [[ -d $dir ]] || { print -u2 "missing cwd for $bot: $dir"; exit 1; }
  mkdir -p "$dir/.claude"
  cp "$here/$bot.json" "$dir/.claude/settings.json"
  print "installed $bot -> $dir/.claude/settings.json"
  # Bot-only hooks: team/hooks/<bot>/* -> cwd .claude/hooks/ (bl3q-lead's Bash whitelist).
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
# Dev's worktree tracks the repo's own .claude/settings.json; keep ours out of commits.
git -C "${cwd[dev]}" update-index --skip-worktree .claude/settings.json
