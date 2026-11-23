#!/bin/zsh -f
# Review's verdict, as a file the vyductan gate (vdt_gate.py) reads:
#
#     /bin/zsh -f /Users/vyductan/Developer/vyductan/apps/atelier/apps/dispatcher/team/bin/review-verdict.sh <pass|fail> <task id> <reviewed sha>
#
# The branch comes from Dev's worktree, and its HEAD must still be the sha Review pinned when it
# started reading (Dev committing meanwhile = refused). The task id must match the branch.
# Writes `~/.vyductan-team/verdicts/<branch>.json`, a folder no bot's sandbox can write: Review
# runs Dev's code (tests, installs) in its sandbox, so a verdict there could be forged by the
# branch itself. This script is Review's `excludedCommands` entry and the ONLY writer. A pass
# there DEPLOYS production (team/bin/vdt_gate.py).
emulate -L zsh
# Fixed paths, no environment overrides: this runs OUTSIDE the sandbox, so nothing the caller
# sets may redirect it (tests run a copy with these two lines swapped).
W=/Users/vyductan/Developer/vyductan-agent
D=/Users/vyductan/.vyductan-team/verdicts
if [[ $# -ne 3 || ! "$1" =~ '^(pass|fail)$' || ! "$2" =~ '^[0-9a-f]{8}(-[0-9a-f-]+)?$' || ! "$3" =~ '^[0-9a-f]{40}$' ]]; then
  print -u2 "dùng: review-verdict.sh <pass|fail> <task id> <sha đã review>"
  exit 2
fi
B="$(git -C "$W" branch --show-current)"
S="$(git -C "$W" rev-parse HEAD)"
if [[ "$B" != "agent/${2[1,8]}" ]]; then
  print -u2 "worktree đang ở '$B', không phải agent/${2[1,8]} của task $2"
  exit 2
fi
if [[ "$S" != "$3" ]]; then  # full 40-char sha, exact: a prefix can be brute-forced
  print -u2 "HEAD là $S, Review đọc $3: có commit mới sau khi review — review lại"
  exit 2
fi
mkdir -p "$D" || exit 2
F="$D/${B//\//__}.json"
print -r -- "{\"branch\": \"$B\", \"sha\": \"$3\", \"verdict\": \"$1\", \"task\": \"$2\", \"at\": \"$(date '+%Y-%m-%d %H:%M')\"}" > "$F.tmp" \
  && mv "$F.tmp" "$F" && print "đã ghi: $1 cho $B @ $S"
