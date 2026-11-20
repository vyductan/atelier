---
name: fix-root-cause
description: How to fix one bl3q bug: reproduce it as a failing test from the evidence, find the first wrong decision in the code, fix it there and everywhere with the same fault, and prove it with red-then-green output. Use for every item bl3q-lead hands you.
---

# Fix the root cause

Adapted from pstack (poteto, MIT): the bug-fix playbook and the fix-root-causes, attack-the-premise and prove-it-works principles. Everything you need is in this file.

Every line you ship traces to evidence. A change that "might help" is a guess, not a fix: it does not ship. The smallest change the evidence justifies ships, nothing more.

## 1. Reproduce before you change anything

- Read the evidence you were given (digest fields, log lines, the copied screenshots in `.evidence/`). Find the code path that ran: the flow, the state, the template match or OCR read that decided what happened next.
- Turn the bug into a test that fails on the current code: a recorded frame from `tests/frames/` or your `.evidence/` copy, a recorded log line, or a pure function called with the values the log shows. Prefer a new test file.
- Run it and keep the red output. If it passes, your reading of the bug is wrong: go back to the evidence, do not start fixing.
- Only when the bug truly needs the live game (timing, an animation, the emulator itself), skip the test and say in your report exactly why, and what evidence you used instead.

## 2. Find the first wrong decision

- Ask "why" until the answer is a decision in the code that was wrong: a threshold, a branch, a state the flow did not expect, a screen it did not recognise.
- Then ask whether the state that triggered it is legitimate.
  - **Legitimate** (the game changed its UI, a popup that really appears, a slower load): handle it where the code broke. Lowering a template threshold for a near-miss match is this kind of fix.
  - **Should never exist** (the bot reached a screen it should not have been on): a guard where it surfaced only hides the bug. Find the earlier step that produced it and fix that.
- Retries, extra sleeps, swallowed exceptions, clamped values and "if this screen, just press back" are the usual ways to hide a bug. Use one only for a legitimate, transient state, and say so in the commit message.

## 3. Fix the pattern, not the instance

Search `bot/` and `templates/templates.json` for the same fault in other flows (the same template, the same helper, the same assumption). Fix those in the same branch when the evidence covers them; otherwise list them in your report.

## 4. When it broke again

If the item was fixed before and broke again (`tai_phat` > 0, or the lead says so), read the earlier fix (`git log --oneline -S <symbol> -- bot/ templates/`). Write down, in one sentence, what that fix assumed. Check that assumption against the new evidence before writing another fix that assumes it. If it does not hold, the fix is to whatever it got wrong, not a stronger version of the old fix.

## 5. Commit test first, then the fix

- Commit the failing test alone first (`test: reproduce <key>`), then the fix on top (`fix(<flow>): …`). The history then shows red, then green.
- Run the new test and the tests of the modules you touched on the fix commit; all green.

## 6. Report

Add to your usual report: the root cause in one sentence (the first wrong decision, file and function), whether the state was legitimate, other places with the same fault, and the test's output, red on the first commit and green on the second, pasted verbatim (the last lines are enough).
