#!/bin/zsh -f
# Review's verdict, as a file the vyductan gate (vdt_gate.py) reads:
#
#     /bin/zsh -f /Users/vyductan/Developer/vyductan/apps/atelier/apps/dispatcher/team/bin/review-verdict.sh <pass|fail> <task id>
#
# Branch and sha come from Dev's worktree itself, never from a brief, so the gate pushes
# exactly what Review read. The task id must match the branch (`agent/<first 8 of the id>`).
# Writes `~/.vyductan-team/review/runs/verdicts/<branch>.json` (Review's sandbox writes runs/;
# CoS and Ops are denied that folder, Dev cannot read it). A pass there DEPLOYS production.
emulate -L zsh
W="${REVIEW_WORKTREE:-/Users/vyductan/Developer/vyductan-agent}"
D="${REVIEW_VERDICTS:-/Users/vyductan/.vyductan-team/review/runs/verdicts}"
if [[ $# -ne 2 || ! "$1" =~ '^(pass|fail)$' || ! "$2" =~ '^[0-9a-f]{8}(-[0-9a-f-]+)?$' ]]; then
  print -u2 "dùng: review-verdict.sh <pass|fail> <task id>"
  exit 2
fi
B="$(git -C "$W" branch --show-current)"
S="$(git -C "$W" rev-parse HEAD)"
if [[ "$B" != "agent/${2[1,8]}" ]]; then
  print -u2 "worktree đang ở '$B', không phải agent/${2[1,8]} của task $2"
  exit 2
fi
mkdir -p "$D" || exit 2
F="$D/${B//\//__}.json"
print -r -- "{\"branch\": \"$B\", \"sha\": \"$S\", \"verdict\": \"$1\", \"task\": \"$2\", \"at\": \"$(date '+%Y-%m-%d %H:%M')\"}" > "$F.tmp" \
  && mv "$F.tmp" "$F" && print "đã ghi: $1 cho $B @ $S"
