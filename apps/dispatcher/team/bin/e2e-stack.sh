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
#   - the browser: one Chromium launched here with fixed options, confined by sandbox-exec.
# The Tester's own scenarios (untrusted: a bot wrote them) run in its sandbox and reach these
# two over localhost (:3100 app, :3111 browser, which is itself confined by sandbox-exec). Nothing from the Tester's worktree runs here
# except `pnpm install --frozen-lockfile`, and only when its lockfile and manifests equal
# origin/main's.
#
# The database is the local e2e Supabase (apps/e2e/supabase), reset to seed.sql on every "up".
# `pnpm dev` on :3000 uses that same stack, so "up" also wipes what was entered there.
emulate -L zsh
setopt pipe_fail
umask 077  # logs, pid files, the browser's config and the generated Playwright config: owner only
export PATH=/Users/vyductan/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
REPO=/Users/vyductan/Developer/vyductan/apps/vyductan.dev
SRV=/Users/vyductan/Developer/vyductan-e2e
TST=/Users/vyductan/Developer/vyductan-tester
# Script state lives outside everything the Tester can write (its cwd is ~/.vyductan-team/tester).
RUN=/Users/vyductan/.vyductan-team/e2e-stack
mkdir -p $RUN
[[ -d $RUN && ! -L $RUN && -O $RUN ]] || { print -u2 "$RUN không phải thư mục thật của chủ"; exit 1 }

stop() {
  local f p
  for f in $RUN/app.pid $RUN/browser.pid; do
    [[ -f $f && ! -L $f ]] || continue
    p=$(<$f)
    [[ $p =~ '^[0-9]+$' ]] && { pkill -P "$p" 2>/dev/null; kill "$p" 2>/dev/null }
    rm -f -- $f
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

# The Tester's Playwright config and fixtures go in scenarios/_botfix, which its sandbox cannot
# write (it writes only scenarios/_bot): this script runs outside the sandbox and must never write
# into a folder the bot controls (a symlink there would redirect the write anywhere).
BOT=$TST/apps/e2e/scenarios/_bot
FIX=$TST/apps/e2e/scenarios/_botfix
# A fresh random ws path each run: only the generated config knows it, so no other local process
# can guess the browser's address (it is never printed).
WSPATH=$(uuidgen | tr A-Z a-z)
[[ -L $BOT || -L $FIX ]] && { print -u2 "_bot/_botfix là symlink — dừng"; exit 1 }
[[ -d $BOT ]] || mkdir $BOT
rm -rf -- $FIX && mkdir $FIX || exit 1
cp -R $TST/apps/e2e/fixtures $FIX/fixtures && cp $TST/apps/e2e/env.ts $FIX/env.ts || exit 1
cat > $FIX/fixtures/db.ts <<'TS'
// Written by atelier team/bin/e2e-stack.sh for the Tester bot (rewritten on every "up").
// No direct database from the bot's sandbox (raw TCP to :55422): e2e-stack.sh resets the DB to the
// seed before each run, so a run holds ONE task's scenario; check results through the UI, not SQL.
export async function resetData(): Promise<void> {}

export async function query<T extends object>(_text: string, _params: unknown[] = []): Promise<T[]> {
  throw new Error("query(): no direct DB access for the Tester bot — assert through the UI");
}
TS
cat > $FIX/playwright.config.ts <<TS
// Written by atelier team/bin/e2e-stack.sh for the Tester bot (rewritten on every "up").
// The repo's config, but tests come from ../_bot, the app (:3100) and the browser (ws :3111/e2e)
// run outside the bot's sandbox, the DB was reset by the script, and results go to ../_bot/.results.
import base from "../../playwright.config";

export default {
  ...base,
  testDir: "../_bot",
  testIgnore: [".results/**"],
  globalSetup: undefined,
  webServer: undefined,
  outputDir: "../_bot/.results/test-results",
  reporter: [
    ["list"],
    ["json", { outputFile: "../_bot/.results/results.json" }],
    ["html", { open: "never", outputFolder: "../_bot/.results/report" }],
  ],
  use: { ...base.use, connectOptions: { wsEndpoint: "ws://127.0.0.1:3111/$WSPATH" } },
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
# CI=1 skips env validation: this worktree has no .env, so no production key ever loads. Modules
# that build a client at import time still need SOMETHING: a dummy RESEND_API_KEY (found by the
# Tester 2026-11-23: without it every tRPC route 500s; the dummy can never send real email).
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
  RESEND_API_KEY=re_e2e_not_a_real_key \
  nohup pnpm dev > $RUN/app.log 2>&1 & print $! > $RUN/app.pid)
# The browser: ONE Chromium this script launches with fixed options (`launchServer`), so a client
# can only connect to it, never launch another program or pass its own options (`run-server`
# would let the bot's test code choose the executable and args, outside its sandbox). It runs
# under sandbox-exec: no reads or writes in the home folder but its own files, and network only
# to the e2e app; --host-resolver-rules makes every other host unresolvable too.
PWCORE=($SRV/node_modules/.pnpm/playwright-core@*/node_modules/playwright-core/index.mjs(N))
[[ ${#PWCORE} -eq 1 ]] || { print -u2 "không tìm được đúng một playwright-core trong $SRV"; exit 1 }
cat > $RUN/browser.sb <<SB
(version 1)
(allow default)
(deny file-read* file-write* (subpath "/Users/vyductan"))
(allow file-read* (literal "/Users/vyductan") (literal "/Users/vyductan/Library") (literal "/Users/vyductan/Library/Caches")
  (literal "/Users/vyductan/Developer") (literal "$SRV") (literal "/Users/vyductan/.vyductan-team"))
(allow file-read* (subpath "/Users/vyductan/Library/Caches/ms-playwright") (subpath "$SRV/node_modules") (subpath "$RUN"))
(deny file-write*)
(allow file-write* (subpath "$RUN/browser-home") (literal "/dev/null") (subpath "/dev/fd") (literal "/dev/dtracehelper"))
(deny network-outbound (remote ip "*:*"))
(allow network-outbound (remote ip "localhost:3100"))
SB
cat > $RUN/browser-server.mjs <<'JS'
const { chromium } = await import(process.env.PW_CORE);
const server = await chromium.launchServer({
  host: "127.0.0.1", port: 3111, wsPath: process.env.WSPATH, headless: true,
  args: ["--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1"],
});
console.log("Listening"); // never the endpoint: its random path is the only thing guarding the browser
JS
rm -rf -- $RUN/browser-home && mkdir -p $RUN/browser-home/tmp
(HOME=$RUN/browser-home TMPDIR=$RUN/browser-home/tmp WSPATH=$WSPATH PLAYWRIGHT_BROWSERS_PATH=/Users/vyductan/Library/Caches/ms-playwright PW_CORE=${PWCORE[1]} nohup sandbox-exec -f $RUN/browser.sb ${$(command -v node):A} $RUN/browser-server.mjs > $RUN/browser.log 2>&1 & print $! > $RUN/browser.pid)

for i in {1..90}; do
  code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3100/sign-in)
  [[ $code == 200 ]] && grep -q Listening $RUN/browser.log && { print "e2e stack: ready (app :3100, browser on :3111, DB reset, origin/main ${MAIN:0:9}); config: scenarios/_botfix/playwright.config.ts"; exit 0 }
  sleep 2
done
print -u2 "e2e stack: chưa lên sau 180s (xem $RUN/app.log, $RUN/browser.log)"
exit 1
