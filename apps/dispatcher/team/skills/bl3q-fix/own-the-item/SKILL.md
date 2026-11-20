---
name: own-the-item
description: How bl3q-fix owns one item from brief to an approved branch, the way pstack's owner agents run unattended work - a finish condition, a loop of smallest-justified-change and real verification, a decision log, an independent verifier, escalation when two attempts fail, and an honest stop when truly stuck. Use for every item bl3q-lead hands you.
---

# Own the item

Adapted from pstack (poteto, MIT): the autonomous-run and autopilot playbooks, show-me-your-work, and the attack-the-premise principle. Everything you need is in this file. The way you fix is in your `fix-root-cause` skill; this file is how you carry the item to the end.

You own this item until bl3q-review approves it, it is deferred, or you are truly stuck. Nobody is watching: do not ask the person anything, decide, log the decision, and keep going.

## The finish condition

Done means all of these hold on your branch's latest commit:

1. the reproducing test (or the stated reason none is possible) from `fix-root-cause`;
2. the brief's acceptance line holds;
3. the tests of the modules you touched pass;
4. bl3q-review's verdict on that exact sha is `approve`.

The merge gate then merges it into `main` by itself (it re-checks everything and runs the full suite). You never merge.

## The branch

- A new item: `git switch -c agent/<date>-<key> main`.
- An item the brief says is carried over (deferred or unfinished from an earlier run): `git switch agent/<…>` (the branch it names, no `-c`), read its decision log first, and continue from there.
- If the worktree has uncommitted changes, stop and report that.

## The decision log

Keep `.audit/<branch with "/" replaced by "__">.tsv` in your working folder (git-ignored; never commit it). Create it with this header, and append one row per decision, as you make it:

```
time	step	decision	why	evidence	result
```

- `time`: local `YYYY-MM-DD HH:MM`.
- `step`: `repro`, `hypothesis`, `fix`, `verify`, `review`, `premise`, `escalate`, `stop`.
- `evidence`: a path (`.evidence/x.jpg`, a log line's file and time, a test id) or a command and its last output line. No evidence, no decision.
- `result`: `kept`, `reverted`, `red`, `green`, `approve`, `reject`, `defer`.

Tabs between fields; no tabs or newlines inside one. Write with Bash (`printf '%s\t%s\t…\n' … >> .audit/<file>.tsv`).

## The loop

Each turn of the loop: check the finish condition, make the smallest change the evidence justifies, verify it against the real thing (run the test, read the actual value), then commit it or revert it, and log one row. A change that did not help is reverted, not left to ride.

When your branch meets conditions 1 to 3, ask bl3q-review with coordinate_bots (`in_my_folder: false`, it works in its own folder). Give it the branch, the full commit sha, the problem and acceptance from your brief, and the path of your decision log. Wait for its verdict and log it.

- `approve`: you are done. Report.
- `reject`: read every reason. Each is a hypothesis to test, not an order: check it against the evidence, then fix what holds, commit, and ask bl3q-review again with the new sha.
- `defer` (the game bot is running, or someone is at the machine): stop here and report `deferred`, with the branch and sha. bl3q-lead brings the item back later.

## When two attempts fail

When bl3q-review has rejected two attempts that rest on the same idea of the cause, stop fixing and suspect the idea:

1. Write the premise in one sentence (log it, step `premise`): what both attempts assumed.
2. Test it directly with an observation that would come out differently if it were false: a frame, a log, a pure function call.
3. Run the next attempt through a subagent on a stronger model: use the Agent tool (subagents) with model `fable`, give it the brief, the premise result, the evidence paths, the rejected attempts and the review reasons, and the same limits you work under (only `bot/`, `templates/`, `tests/`; never touch spending guards; tests rules). Log it as step `escalate`. Review its change as your own before you commit it. If the Agent tool refuses that model, continue yourself.

## Stopping

Stop and report `stuck` only when you are truly stuck: the premise is tested, an escalated attempt failed, and nothing in the evidence points to a next hypothesis, or a few hours of attempts made no progress. Leave the branch and the log as they are. Write in your report what you tried, what the evidence rules out, and what the person or a later run would need to go on. Never relax the finish condition to declare victory, and never weaken a test to get there.

## The report

Start with one word: `approved`, `deferred` or `stuck`. Then: the branch, the full sha, the root cause in one sentence, the review verdicts in order, the path of the decision log, and the rows a human should look at first (any `escalate`, any review reason you disagreed with, anything you were unsure of).
