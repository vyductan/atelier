#!/bin/zsh
# PreToolUse hook for bl3q-lead (owner's choice 2026-11-20): the ONLY shell command this
# bot may run is the one below, matched as an exact string. The bot runs `approval: full`,
# so an `allow` rule would restrict nothing; a hook that exits 2 blocks the call whatever
# the approval level. Installed by install-settings.sh into the bot's cwd .claude/hooks/.
#
# The command starts the daily bl3q run detached through the launchd wrapper
# (tools/lich_chay.sh: BOT_CHAY_NEN=1, 2h cap, log reports/lich-hang_ngay.log). It must be
# detached because a full `bot web` run outlasts the Bash tool's 10-minute limit.
# `echo $!` prints the run's PID so the bot can put an OpenMausBot wait card on it
# (wait_until process_gone <PID>): the chat then shows the run as in progress.
CHO_PHEP='/usr/bin/nohup /bin/zsh /Users/vyductan/Developer/g-bots/bl3q/tools/lich_chay.sh hang_ngay 7200 web --xac-nhan >/dev/null 2>&1 & echo $!'
cmd=$(/opt/homebrew/bin/jq -r '.tool_input.command // ""') || exit 2
[[ "$cmd" == "$CHO_PHEP" ]] && exit 0
print -u2 "bl3q-lead chỉ được chạy đúng một lệnh: $CHO_PHEP"
exit 2
