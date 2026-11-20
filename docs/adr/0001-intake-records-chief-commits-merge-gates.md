# Intake bots record reports but never start a bot; the Chief may commit work; the human gate is the merge

Each team gets its own intake bot (`Intake` for vyductan, `bl3q-intake` for bl3q) that turns the owner's reports into tasks. An intake bot leaves its tasks in `triage`, `idea` or `blocked`: it never sets `todo` or priority and never writes a `Bot:` or `Plan:` line, the only things the bridge acts on. The tasks server enforces this per bot token, not just the bot's soul, because hard limits can allow or deny a tool but never a value passed to it.

The Chief, by contrast, may create tasks, set `todo`, write `Bot:` lines and approve plans, leaving a comment with its reason each time it commits work. This reverses the 2026-11-18 rule (`ff2a09b`) that took `create_task` away from the Chief to keep the owner inside the loop from words to running code. The owner chose to move that gate from the start of the loop (committing to work) to its end (the merge): in vyductan the owner still merges and pushes; in bl3q the merge gate's checks (guard tokens, baseline) are the last stop, as they already were once bl3q-lead could hand work out with `coordinate_bots`.

## Considered Options

- **Keep the Chief unable to create or commit work.** Owner in the loop at the start, but every task the Chief spots during triage, or every merge of duplicates, would wait on the owner.
- **Let the Chief do intake too.** Fewer bots, but intake is chatty, cheap work for Sonnet, and mixing recording with routing puts an Opus bot in every phone report.
- **One shared intake bot for both projects.** One place to chat, but it has to guess the project; per-team bots make the chat you pick the routing.
- **Keep `planning` as one status.** It mixed "waiting for a decision" with "parked idea", so what needs deciding could not be filtered. Split into `triage` and `idea`. The owner first named the incoming state "backlog"; `triage` was chosen because in common trackers "backlog" means reviewed-but-later, which is what `idea` means here.

## Consequences

The remaining risk is prompt injection through what the Chief reads (reports, logs, code): a planted line could get it to commit work for Dev. In vyductan the owner's merge catches it; in bl3q only the merge gate's code does.
