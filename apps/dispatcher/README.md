# Atelier Dispatcher

The bot team for vyductan.dev tasks: **OpenMausBot** runs the bots (`team/`), and
this **bridge** hands tasks to them and writes the results back. Spec: the
"Atelier Dispatcher" feature task on vyductan.dev (project `vyductan`).

## How work flows

1. You write a task in `todo` whose description has a line `Bot: Dev` (or `Bot: CoS`).
2. Every minute the bridge settles the run in flight, then — only when nothing is in
   flight — sends the oldest such task to that bot (`openmausbot send`, idempotent
   `--send-id`), moves the task to `in-progress` and comments the thread id.
3. When the run ends, the bot's report is quoted on the task:
   - completed → `todo` + `Triage: ready-for-human` (you review, merge, push);
   - failed → `blocked` with the reason; a rate limit also pauses the bridge.
4. A run waiting on an approval card is noted on the task once (after 30 min).
   **The bridge never approves anything.**

Rules: one run at a time (any bot), at most `maxRunsPerDay` runs, only configured
projects and bots, tasks carrying a `Triage:` line are left alone.

## Run

No dependencies and no build: Node 26 runs the TypeScript directly.

```sh
node src/main.ts status        # paused?, run in flight, runs today
node src/main.ts pause [why]   # stop handing out work
node src/main.ts resume
node src/main.ts tick          # one tick by hand
node --test test/              # unit tests (fakes, no network)
```

As a service: `atelier-dispatcher` in `~/.atelier/services.yaml`, log
`~/.atelier/logs/atelier-dispatcher.log` (one JSON line per event).

## Files

- `~/.atelier/dispatcher/config.json`: copy of `config.example.json`.
- `~/.atelier/dispatcher/state.json`: runs (finished ones kept 31 days).
- `~/.atelier/openmausbot/secrets/dispatcher-mcp-token`: the bridge's own bot session
  token (`vdt-bot:dispatcher-bridge`), from `pnpm -F web bot-session create` in
  vyductan.dev. Revoke with `bot-session revoke <id>`.
- `team/`: the OpenMausBot team (`openmausbot team apply team/team.yaml --port 28799`).

Typecheck (borrowing the monorepo's tsc):

```sh
../../node_modules/.bin/tsc --noEmit --strict --target es2024 --module nodenext \
  --moduleResolution nodenext --allowImportingTsExtensions --erasableSyntaxOnly \
  --types node --typeRoots ../../node_modules/@types src/*.ts test/*.ts
```
