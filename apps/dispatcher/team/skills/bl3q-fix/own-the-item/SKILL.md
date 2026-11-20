---
name: own-the-item
description: How bl3q-fix owns one item from brief to a code-ready branch, the way pstack's owner agents run unattended work - a finish condition, a loop of smallest-justified-change and real verification, a decision log, fixing what the verifier rejects, escalation when two attempts fail, and an honest stop when truly stuck. Use for every item bl3q-lead hands you, and for every rejected branch it hands back.
---

# Own the item

Adapted from pstack (poteto, MIT): the autopilot playbook, show-me-your-work, and the attack-the-premise principle. Everything you need is in this file. The way you fix is in your `fix-root-cause` skill; this file is how you carry the item.

You own the branch. You never own the verdict: bl3q-lead decides when bl3q-review checks your branch and gives you its reasons when it rejects. You never ask for a review and never contact bl3q-review or any other bot. Nobody is watching: do not ask the person anything, decide, log the decision, and keep going.

## Code-ready

Your branch is code-ready when all of these hold on its latest commit:

1. the reproducing test (or the stated reason none is possible) from `fix-root-cause`;
2. the brief's acceptance line holds;
3. the tests of the modules you touched pass.

Then report `ready`. bl3q-lead has the branch reviewed; an approved branch is merged into `main` by the merge gate (it re-checks everything and runs the full suite). You never merge.

## The branch

- A new item: `git switch -c agent/<date>-<key> main`.
- A branch handed back (rejected, or carried over from an earlier run): `git switch agent/<…>` (the branch the brief names, no `-c`), read its decision log first, and continue on top.
- If the worktree has uncommitted changes, stop and report that.

## The decision log

Keep `.audit/<branch with "/" replaced by "__">.tsv` in your working folder (git-ignored; never commit it). Create it with this header, and append one row per decision, as you make it:

```
time	step	decision	why	evidence	result
```

- `time`: local `YYYY-MM-DD HH:MM`.
- `step`: `repro`, `hypothesis`, `fix`, `verify`, `review`, `premise`, `escalate`, `stop`.
- `evidence`: a path (`.evidence/x.jpg`, a log line's file and time, a test id) or a command and its last output line. No evidence, no decision.
- `result`: `kept`, `reverted`, `red`, `green`, `reject`.

Tabs between fields; no tabs or newlines inside one. Write with Bash (`printf '%s\t%s\t…\n' … >> .audit/<file>.tsv`).

## The loop

Each turn of the loop: check code-ready, make the smallest change the evidence justifies, verify it against the real thing (run the test, read the actual value), then commit it or revert it, and log one row. A change that did not help is reverted, not left to ride.

When bl3q-lead hands a branch back with a review's reasons, log the rejection (step `review`, result `reject`), then treat each reason as a hypothesis to test, not an order: check it against the evidence, fix what holds, say why for what does not, and loop to code-ready again.

## When two attempts fail

When two of your attempts that rest on the same idea of the cause have been rejected, stop fixing and suspect the idea:

1. Write the premise in one sentence (log it, step `premise`): what both attempts assumed.
2. Test it directly with an observation that would come out differently if it were false: a frame, a log, a pure function call.
3. Run the next attempt through a subagent on a stronger model: use the Agent tool (subagents) with model `fable`, give it the brief, the premise result, the evidence paths, the rejected attempts and the review reasons, and the same limits you work under (only `bot/`, `templates/`, `tests/`; never touch spending guards; tests rules). Log it as step `escalate`. Review its change as your own before you commit it. If the Agent tool refuses that model, continue yourself.

## Stopping

Stop and report `stuck` only when you are truly stuck: the premise is tested, an escalated attempt failed, and nothing in the evidence points to a next hypothesis, or a few hours of attempts made no progress. Leave the branch and the log as they are. Write what you tried, what the evidence rules out, and what the person or a later run would need to go on. Never relax code-ready to declare victory, and never weaken a test to get there.

## The report

Start with one word: `ready` or `stuck`. Then: the branch, the full sha of its latest commit, the root cause in one sentence, what you changed since the last review (if any) and your answer to each review reason, the path of the decision log, and the rows a human should look at first (any `escalate`, any review reason you disagreed with, anything you were unsure of).
