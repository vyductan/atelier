#!/bin/zsh -f
# Brings up the e2e stack the Tester bot tests against, OUTSIDE its sandbox:
#
#     /bin/zsh -f /Users/vyductan/Developer/vyductan/apps/atelier/apps/dispatcher/team/bin/e2e-stack.sh        # up
#     /bin/zsh -f /Users/vyductan/Developer/vyductan/apps/atelier/apps/dispatcher/team/bin/e2e-stack.sh down   # stop
#
# Tester's `excludedCommands` lists exactly these two commands. Probed 2026-11-23: inside Claude
# Code's macOS sandbox `next dev` cannot start (Turbopack's FSEvents) and Chrome cannot start
# (Mach bootstrap denied), so both run here, and only TRUSTED code runs here:
#   - the app: a worktree pinned to origin/main (what review passed and Vercel deployed);
#   - the browser: `playwright run-server` from that same worktree, empty profile, no secrets.
# The Tester's own scenarios (untrusted: a bot wrote them) run in its sandbox and reach these
# two over localhost (:3100 app, :3111 browser). Nothing from the Tester's worktree runs here
# except `pnpm install --frozen-lockfile`, and only when its lockfile and manifests equal
# origin/main's.
#
# The database is the local e2e Supabase (apps/e2e/supabase), reset to seed.sql on every "up".
# `pnpm dev` on :3000 uses that same stack, so "up" also wipes what was entered there.
emulate -L zsh
setopt pipe_fail
export PATH=/Users/vyductan/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
REPO=/Users/vyductan/Developer/vyductan/apps/vyductan.dev
SRV=/Users/vyductan/Developer/vyductan-e2e
TST=/Users/vyductan/Developer/vyductan-tester
RUN=/Users/vyductan/.vyductan-team/tester/stack
mkdir -p $RUN

stop() {
  local f p
  for f in $RUN/app.pid $RUN/browser.pid; do
    [[ -r $f ]] && { pkill -P $(<$f) 2>/dev/null; kill $(<$f) 2>/dev/null; rm -f $f }
  done
  for p in 3100 3111; do
    lsof -ti tcp:$p -sTCP:LISTEN | xargs kill 2>/dev/null
  done
  for p in {1..20}; do
    lsof -ti tcp:3100,3111 -sTCP:LISTEN >/dev/null || return 0
    sleep 0.5
  done
  return 0
}

case "$#:${1:-}" in
  0:) ;;
  1:down) stop; print "e2e stack: stopped"; exit 0 ;;
  *) print -u2 "dùng: e2e-stack.sh [down]"; exit 2 ;;
esac

git -C $REPO fetch -q origin main || { print -u2 "git fetch hỏng"; exit 1 }
MAIN=$(git -C $REPO rev-parse origin/main)
for W in $SRV $TST; do
  [[ -d $W ]] || git -C $REPO worktree add -q --detach $W $MAIN || exit 1
  # Tracked files back to origin/main; untracked files (the Tester's scenarios) stay.
  git -C $W checkout -q --detach -f $MAIN && git -C $W reset -q --hard $MAIN || exit 1
done
git -C $SRV clean -fdq -e node_modules -e .next-e2e -e .turbo

# The Tester's Playwright config: the repo's, but the app and the browser are the two above, and
# results stay in its writable folder. Rewritten every time so it always matches this script.
BOT=$TST/apps/e2e/scenarios/_bot
mkdir -p $BOT
# The Tester's fixtures: the repo's, except the two that open Postgres directly (raw TCP to
# :55422, which its sandbox refuses; opening it would also open every other local port). The
# DB is reset by this script before each run, and assertions go through the UI.
rm -rf $BOT/fixtures && cp -R $TST/apps/e2e/fixtures $BOT/fixtures && cp $TST/apps/e2e/env.ts $BOT/env.ts
cat > $BOT/fixtures/db.ts <<'TS'
// Written by atelier team/bin/e2e-stack.sh for the Tester bot (rewritten on every "up").
// No direct database from the bot's sandbox: e2e-stack.sh resets the DB to the seed before each
// run, so a run holds ONE task's scenario; check results through the UI, not with SQL.
export async function resetData(): Promise<void> {}

export async function query<T extends object>(_text: string, _params: unknown[] = []): Promise<T[]> {
  throw new Error("query(): no direct DB access for the Tester bot — assert through the UI");
}
TS
cat > $BOT/playwright.config.ts <<'TS'
// Written by atelier team/bin/e2e-stack.sh for the Tester bot (do not edit: rewritten on every "up").
// Same as apps/e2e/playwright.config.ts, but the app (:3100) and the browser (ws :3111) run
// outside the bot's sandbox, the DB was already reset by the script, and results stay here.
import base from "../../playwright.config";

export default {
  ...base,
  testDir: ".",
  testIgnore: [".results/**"],
  globalSetup: undefined,
  webServer: undefined,
  outputDir: ".results/test-results",
  reporter: [
    ["list"],
    ["json", { outputFile: ".results/results.json" }],
    ["html", { open: "never", outputFolder: ".results/report" }],
  ],
  use: { ...base.use, connectOptions: { wsEndpoint: "ws://127.0.0.1:3111/" } },
};
TS

# Dependencies: only origin/main's lockfile is ever installed (checked above by the reset).
for W in $SRV $TST; do
  stamp=$W/node_modules/.e2e-lock-$(git -C $W rev-parse HEAD:pnpm-lock.yaml)
  if [[ ! -e $stamp ]]; then
    (cd $W && CI=1 pnpm install --frozen-lockfile --prefer-offline >> $RUN/install.log 2>&1) || { print -u2 "pnpm install hỏng ở $W (xem $RUN/install.log)"; exit 1 }
    rm -f $W/node_modules/.e2e-lock-*(N) && : > $stamp
  fi
done

stop
(cd $SRV/apps/e2e && { pnpm -s db:start >> $RUN/db.log 2>&1; pnpm -s db:reset >> $RUN/db.log 2>&1 }) || { print -u2 "reset DB e2e hỏng (xem $RUN/db.log)"; exit 1 }

# Same values as apps/e2e/env.ts `serverEnv` (local-only keys of the e2e Supabase, no secrets).
# CI=1 skips env validation: this worktree has no .env, so no production key ever loads.
# Keys of the local e2e Supabase, read from its CLI: they are the public defaults every local
# stack ships with, but are never written here (GitHub push protection flags them as secrets).
KEYS=$(cd $SRV/apps/e2e && pnpm -s exec supabase status -o env --workdir . 2>/dev/null)
key() { print -r -- "$KEYS" | sed -n "s/^$1=\"\(.*\)\"\$/\1/p" }
PUB=$(key PUBLISHABLE_KEY) SVC=$(key SECRET_KEY) JWT=$(key JWT_SECRET)
[[ -n $PUB && -n $SVC && -n $JWT ]] || { print -u2 "không đọc được key từ supabase status"; exit 1 }
DB=postgresql://postgres:postgres@127.0.0.1:55422/postgres
SECRET=e2e-auth-secret-not-used-anywhere-else-0000
(cd $SRV/apps/web && CI=1 PORT=3100 NEXT_DIST_DIR=.next-e2e SUPABASE_DATABASE_URL=$DB SUPABASE_DATABASE_URL_NON_POOLING=$DB \
  NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55421 NEXT_PUBLIC_SUPABASE_ANON_KEY=$PUB \
  SUPABASE_SERVICE_ROLE_KEY=$SVC \
  SUPABASE_JWT_SECRET=$JWT \
  AUTH_SECRET=$SECRET BETTER_AUTH_SECRET=$SECRET AUTH_COOKIE_PREFIX=better-auth \
  nohup pnpm dev > $RUN/app.log 2>&1 & print $! > $RUN/app.pid)
(cd $SRV/apps/e2e && nohup ./node_modules/.bin/playwright run-server --port 3111 --host 127.0.0.1 > $RUN/browser.log 2>&1 & print $! > $RUN/browser.pid)

for i in {1..90}; do
  code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3100/sign-in)
  [[ $code == 200 ]] && grep -q Listening $RUN/browser.log && { print "e2e stack: ready (app :3100, browser ws://127.0.0.1:3111/, DB reset, origin/main ${MAIN:0:9})"; exit 0 }
  sleep 2
done
print -u2 "e2e stack: chưa lên sau 180s (xem $RUN/app.log, $RUN/browser.log)"
exit 1
