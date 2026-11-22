---
name: blast-radius
description: Extra checks for every bl3q branch you review: prove the new test really fails on main and passes on the branch, check the tests assert behaviour, and find the other flows the change could break. Use on every review, after reading the diff and before the full suite.
---

# Blast radius and proof

Adapted from pstack (poteto, MIT): the blast-radius skill and the prove-it-works and test-behavior-not-implementation principles. Everything you need is in this file.

The fix bot's report is a claim, not proof. Check the real thing.

## 1. The new test is red on main

For each test file the branch added or changed under `tests/` (`git -C ~/Developer/g-bots/bl3q-agent diff --name-only --diff-filter=AM main...HEAD -- tests/`):

```bash
W=~/Developer/g-bots/bl3q-agent; R=~/.bl3q-team/review/redcheck
rm -rf $R && mkdir -p $R
git -C $W archive main bot templates tests pyproject.toml | tar -x -C $R
git -C $W show HEAD:tests/<file>.py > $R/tests/<file>.py
cd $R && PYTHONDONTWRITEBYTECODE=1 $W/.venv/bin/python -m pytest tests/<file>.py -q -p no:cacheprovider -n 0 > ~/.bl3q-team/review/red-on-main.txt 2>&1; tail -3 ~/.bl3q-team/review/red-on-main.txt
```

This runs the branch's test against main's code. It must **fail**, and for the reason the problem states (an assert about the buggy behaviour). A test that passes on main proves nothing about the fix: say so in `reasons`. A failure only because a new function does not exist on main is weak: check the test also asserts the behaviour. Skip this step when the branch adds no test; its report must then say why no test was possible, and you judge that reason.

Delete `$R` when done.

## 2. The tests assert behaviour

A good test checks what the bot does with a screen or a log (which button it presses, which state it moves to, what it reads), so it fails when that breaks and keeps passing when only the internals change. Note a test that only mirrors the implementation (asserts a private helper was called, copies the new constant into the expectation): it would not catch the bug coming back.

## 3. What else the change could break

For every function, template key or threshold the diff changes:

- Find its other users: `grep -rn "<name>" ~/Developer/g-bots/bl3q-agent/bot ~/Developer/g-bots/bl3q-agent/tests`, and for a template, every flow that matches that key.
- For each other user, decide in one line whether the change is safe there and why. A lowered threshold is the usual risk: another screen may now match the template by mistake. Check the template against the other recorded frames that flow uses, if any exist in `tests/frames/`.
- Name the one fact the branch is safe because of, and check it by running code (a test, a match against a frame), not by reasoning alone.

## 4. In the verdict

Add to `reasons`: the red-on-main result (the last line of `red-on-main.txt`), whether the tests assert behaviour, and the other users you checked with a one-line verdict each. Reject when the new test passes on main without a stated reason, or when another user of the change would break.
