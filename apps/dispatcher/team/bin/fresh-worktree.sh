#!/bin/zsh
# Puts Dev's worktree on a fresh origin/main before a NEW task (owner 2026-11-21: CoS hands
# Dev its tasks itself, so the bridge no longer prepares the worktree). Dev calls exactly
#
#     /bin/zsh /Users/vyductan/Developer/vyductan/apps/atelier/apps/dispatcher/team/bin/fresh-worktree.sh
#
# as its one command outside the sandbox (excludedCommands in team/settings/dev.json): the
# fetch needs the main repo's git data, which the sandbox does not let Dev write. No
# arguments, so nothing Dev passes reaches this unsandboxed shell. Does what the bridge's
# gitWorkspace.prepare did, in the same order:
#   1. Dev's installed settings must equal the reviewed template (a bot with Bash could
#      rewrite its own limits; a mismatch stops here instead of handing it work);
#   2. the worktree must be clean;
#   3. fetch origin main and detach at it. Dev then creates agent/<task id> itself.
# A rework stays on its branch and never runs this.
set -u
WT=/Users/vyductan/Developer/vyductan-agent
TEMPLATE=${0:A:h:h}/settings/dev.json
git() { /usr/bin/git -C "$WT" -c core.fsmonitor= -c core.hooksPath=/dev/null "$@"; }

if ! /usr/bin/cmp -s "$TEMPLATE" "$WT/.claude/settings.json"; then
  echo "STOP: Dev's installed settings differ from team/settings/dev.json; the owner must run install-settings.sh."
  exit 2
fi
if [[ -n "$(git status --porcelain)" ]]; then
  echo "STOP: the worktree has uncommitted changes; report them, do not discard them."
  exit 3
fi
git fetch -q origin main || { echo "STOP: git fetch origin main failed."; exit 4; }
git switch -q --detach origin/main || { echo "STOP: could not switch to origin/main."; exit 5; }
echo "ready: detached at $(git rev-parse --short HEAD) (origin/main). Now: git switch -c agent/<first 8 chars of the task id>"
