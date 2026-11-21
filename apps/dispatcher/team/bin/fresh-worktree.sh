#!/bin/zsh
# Puts Dev's worktree on a fresh origin/main before a NEW task (owner 2026-11-21: CoS hands
# Dev its tasks itself, so the bridge no longer prepares the worktree). Dev calls exactly
#
#     /bin/zsh -f /Users/vyductan/Developer/vyductan/apps/atelier/apps/dispatcher/team/bin/fresh-worktree.sh
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
#
# Unsandboxed git must not FIND its repo through files Dev can write: `$WT/.git` and the
# worktree's admin dir (`.git/worktrees/vyductan-agent`, in Dev's allowWrite) could point
# it at a config of Dev's making (core.sshCommand, a filter, an alias), which would run
# here outside the sandbox. So the repo is pinned with GIT_DIR/GIT_WORK_TREE, the pointer
# files must hold exactly what `git worktree add` wrote, and a per-worktree config (which
# the admin dir could carry) is refused. The main repo's .git/config stays out of Dev's
# reach (not in its allowWrite).
set -u
# `-f` skips zsh startup files. Then every exported variable is dropped and only a fixed
# set is exported again, unconditionally: nothing the caller sets (PATH, HOME, ZDOTDIR,
# GIT_*, SSH_*, or a marker meant to skip this step) reaches git or ssh. HOME is fixed,
# not inherited: git reads the owner's global config (credentials) from it.
for name in ${(f)"$(typeset +x)"}; do
  unset "$name" 2>/dev/null
done
export HOME=/Users/vyductan USER=vyductan LANG=en_US.UTF-8 PATH=/usr/bin:/bin:/usr/sbin:/sbin
# Belt and braces (the loop above already dropped them): the variables that make git or
# ssh run a program of the caller's choosing, named one by one.
unset GIT_SSH GIT_SSH_COMMAND GIT_SSH_VARIANT GIT_EXEC_PATH GIT_ASKPASS SSH_ASKPASS \
  SSH_ASKPASS_REQUIRE GIT_EDITOR GIT_PAGER GIT_PROXY_COMMAND GIT_EXTERNAL_DIFF \
  GIT_CONFIG_GLOBAL GIT_CONFIG_SYSTEM GIT_TEMPLATE_DIR GIT_TRACE GIT_TRACE2 \
  GIT_TRACE2_EVENT GIT_TRACE2_PERF GIT_ALLOW_PROTOCOL GIT_PROTOCOL_FROM_USER \
  LD_PRELOAD DYLD_INSERT_LIBRARIES DYLD_LIBRARY_PATH ZDOTDIR BASH_ENV ENV 2>/dev/null
WT=/Users/vyductan/Developer/vyductan-agent
ADMIN=/Users/vyductan/Developer/vyductan/apps/vyductan.dev/.git/worktrees/vyductan-agent
TEMPLATE=${0:A:h:h}/settings/dev.json

stop() { echo "STOP: $1"; exit "${2:-6}"; }
[[ -f "$WT/.git" && ! -L "$WT/.git" && "$(<"$WT/.git")" == "gitdir: $ADMIN" ]] ||
  stop "$WT/.git does not point at $ADMIN; the owner must check the worktree."
[[ -d "$ADMIN" && ! -L "$ADMIN" && -f "$ADMIN/commondir" && ! -L "$ADMIN/commondir" && "$(<"$ADMIN/commondir")" == "../.." ]] ||
  stop "the worktree's commondir is not ../..; the owner must check the worktree."
[[ ! -e "$ADMIN/config" && ! -L "$ADMIN/config" && ! -e "$ADMIN/config.worktree" && ! -L "$ADMIN/config.worktree" ]] ||
  stop "the worktree carries its own git config; the owner must check it."

# The checks above can race a Dev process still running in the background, so git is
# told every location outright instead: GIT_COMMON_DIR means it never reads `commondir`,
# and with it set (and extensions.worktreeConfig off in the main repo) no config file in
# the admin dir is read. What git still reads from Dev-writable places (the admin dir's
# HEAD and index, the worktree's files) is data, not configuration.
export GIT_DIR=$ADMIN GIT_COMMON_DIR=/Users/vyductan/Developer/vyductan/apps/vyductan.dev/.git
export GIT_WORK_TREE=$WT GIT_CONFIG_NOSYSTEM=1
unset GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_CONFIG GIT_CONFIG_PARAMETERS GIT_CONFIG_COUNT
git() {
  /usr/bin/git -c core.fsmonitor= -c core.hooksPath=/dev/null -c core.sshCommand=ssh \
    -c protocol.allow=never -c protocol.https.allow=always -c protocol.ssh.allow=always \
    -c submodule.recurse=false -c fetch.recurseSubmodules=false -c diff.ignoreSubmodules=all \
    -c core.attributesFile=/dev/null -c core.pager=cat "$@"
}

[[ "$(/usr/bin/git --git-dir="$GIT_COMMON_DIR" config --get extensions.worktreeConfig)" != true ]] ||
  stop "the main repo enables per-worktree config; the owner must check it."
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
