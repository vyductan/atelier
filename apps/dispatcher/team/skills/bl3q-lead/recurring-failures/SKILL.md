---
name: recurring-failures
description: What to do with a bl3q failure that keeps coming back (tai_phat > 0, a high so_lan, or the same flow failing again after a merged fix): test the premise the earlier fixes shared before asking for another fix, and ask for a check that makes the failure impossible. Use whenever you pick or brief such an item.
---

# Recurring failures

Adapted from pstack (poteto, MIT): the attack-the-premise principle and the correct skill. Everything you need is in this file.

When two or more fixes for one problem have failed, suspect what they all assumed, not the fixes.

## Before you brief bl3q-fix

For an item with `tai_phat` > 0, or one you have handed out before:

1. Look up the earlier fixes: the digest's notes, your past reports, and the history (`git -C ~/Developer/g-bots/bl3q log --oneline -20 -- <files the evidence names>`).
2. Write down the premise in one sentence: what every earlier fix assumed. For example "the button is always at the same spot", "the popup appears at most once", "a near-miss match means the template drifted".
3. Brief bl3q-fix to **test that premise first**: name one observation that would come out differently if the premise were false (a frame where the button is elsewhere, a log with two popups), and ask it to check that before it writes code. If the premise fails, the fix is to whatever it got wrong, not a stronger version of the old fix.
4. Look at how the failures are spread, not only how many there are: the same flow, the same time of day, after the same other chore. Put what you see into the brief.

## Make it impossible, not just fixed

When the same kind of failure has happened twice (two items, or one item twice), ask for the highest check that would stop it, in this order:

1. **Structure**: one helper or one template that every flow uses, instead of copies that drift apart.
2. **A test that fails on the real past failure**: a recorded frame or log line from the digest, so the same break turns the suite red.
3. **A note**: only for a judgment call nothing can check.

bl3q-fix may change only `bot/`, `templates/` and `tests/`. When the right check lies outside that (the merge gate, `tools/`, the digest), do not hand it to bl3q-fix: create a task in project `bl3q` ending with `Source: chief` that names the failure class, the evidence and the check you would add.

## In your report

For each recurring item: the premise you wrote down, whether bl3q-fix found it true or false, and which check now guards the class (or the task you created for one).
