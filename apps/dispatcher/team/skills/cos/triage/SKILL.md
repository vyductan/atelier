---
name: triage
description: Triage vyductan.dev tasks (projects vyductan, bl3q) through needs-triage / needs-info / ready-for-agent / ready-for-human / wontfix, check them against the code, grill when vague, and write agent briefs. Use whenever the person asks what needs attention, asks to look at, judge, sort or hand out a task, says "triage", or moves a task to a state.
---

# Triage

Adapted from mattpocock's `/triage` skill for vyductan.dev tasks instead of GitHub issues. Everything you need is in this file: your folder is unreadable, so you cannot open files next to it.

A task is the issue. Its status plus a `Triage:` line at the top of its description is its state:

| State | Task |
| --- | --- |
| needs-triage | status `planning` |
| needs-info | status `blocked` + `Triage: needs-info` |
| ready-for-agent | status `todo`, no `Triage:` line (with a `Bot:` line the bridge hands it out at once) |
| ready-for-human | status `todo` + `Triage: ready-for-human` |
| wontfix | status `archived` |

Every triaged task has one category, written as the task `type` (`bug` or `feat`), and one state. Moving to a state without a `Triage:` line means deleting any existing one. A `blocked` task without a `Triage:` line waits on another task (its `Blocked by:` line), not on info. `in-progress`, `testing` and `completed` are the work's own lifecycle: leave them alone. If a task's lines contradict each other (say `Bot:` and `Triage: ready-for-human`), say so and ask before touching it.

Usual path: a new task starts at needs-triage, then goes to needs-info, ready-for-agent, ready-for-human or wontfix. needs-info returns to needs-triage once the person answers. The person can override at any time; flag a move that looks odd and ask first.

Start every brief, triage note or closing note you write with the line `> *CoS viết khi phân loại.*`

## Show what needs attention

List, oldest first, with a count and one line each:

1. `planning` tasks never triaged (no `## Triage Notes`, no brief).
2. `planning` tasks with triage in progress.
3. `Triage: needs-info` tasks where the person has written since your last notes.

Let the person pick.

## Triage one task

1. **Gather context.** Read the whole task (description, comments, dates) and any earlier `## Triage Notes`, so you never re-ask what is settled. Read the code it is about under `~/Developer`, using the app's `GLOSSARY.md` terms (the root `GLOSSARY-MAP.md` lists them) and its ADRs. Two checks, and say where you looked:
   - **Already built?** Search the code for the behaviour by concept, not by the request's wording. If it exists, it is an already-built wontfix.
   - **Rejected before?** Search archived tasks (`list_tasks` status `archived`, `find_task_by_name`) for a `## Out of scope` note on the same concept, matching by idea not keyword. If one matches, quote its reason and ask whether the person still agrees: confirm (close this one as a repeat, linking the old task), reconsider (triage as normal), or they differ (triage as normal).
2. **Recommend and wait.** Give your category and state with the reason, plus a short summary of the code involved (including whether it already exists). Write nothing yet.
3. **Check the claim.** You cannot run code, so check by reading: for a bug, follow the reported steps through the code path and say whether it holds up (confirmed, with the path; not found; or not enough detail, which points to needs-info). Say plainly that you read it, not ran it.
4. **Grill if needed.** If the request is vague, ask in rounds. Each round: every question that can be answered now (not ones that hang on an open answer), numbered, each with your recommended answer worded so "yes" accepts it. Wait, then ask the next round. When the person's word clashes with a glossary term, say so and propose the precise term. Look facts up yourself; only decisions go to the person. Stop when nothing is left assumed.
5. **Apply the outcome** once the person agrees, in one update:
   - **ready-for-agent**, one small piece in `vyductan`: write an `## Agent Brief` into the task, then `Bot: Dev` as the first line, status `todo`. The bridge sends the whole description to Dev, so the brief is Dev's contract.
   - **ready-for-agent**, bigger than one piece: propose a split (the `## Plan` contract in your instructions); each piece's `scope` is that piece's brief in short.
   - **bl3q**: never a `Bot:` line. Write the brief and leave it `Triage: ready-for-human` for the person to hand to bl3q-lead.
   - **ready-for-human**: the same brief plus a `**Why a person:**` line (judgment call, outside access, design decision, manual testing). Status `todo` + `Triage: ready-for-human`.
   - **needs-info**: `## Triage Notes` (below), status `blocked` + `Triage: needs-info`.
   - **wontfix**, status `archived`, with a closing note that depends on why:
     - *already built*: say where it lives. Write no `## Out of scope`: that is for rejected requests, not built ones.
     - *rejected bug*: a short polite reason.
     - *rejected enhancement*: an `## Out of scope` section, so a later request for the same thing finds it: the concept in a few words, then why (scope, a technical constraint, a deliberate choice). Never "not now": that is a deferral, not a rejection.
   - **needs-triage**: just set it; a short note if there is partial progress.

## Quick state override

If the person says "move X to ready-for-agent", trust them: say what you will write (status, lines, note), then do it without grilling. If it goes to ready-for-agent with no brief, ask whether they want one first.

## Resuming

If earlier `## Triage Notes` exist, read them, check whether the person has answered the open questions, and present the updated picture before going on. Never re-ask what is settled.

## Agent Brief

Durable and behavioural: it may sit for weeks while files move. Say what, not how ("the API returns 404 for a missing task", not "add an if on line 40"). No file paths or line numbers. Every criterion independently checkable. Say what is out of scope so the agent does not gold-plate.

```markdown
## Agent Brief

**Category:** bug / enhancement
**Summary:** one line

**Current behavior:** what happens now (for a bug, the broken behaviour).
**Desired behavior:** what should happen, edge cases and errors included.
**Key interfaces:**
- types, function signatures, config shapes, routes to look for, and what changes
**Acceptance criteria:**
- [ ] criterion 1
- [ ] criterion 2
**Out of scope:**
- what not to touch
```

## Triage Notes (needs-info)

Record everything settled, so the work is not lost:

```markdown
## Triage Notes

**What we've established so far:**
- …

**What we still need from you:**
- specific, answerable questions; never "please give more info"
```
