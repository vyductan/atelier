# Atelier

The owner's local agent workshop: the bots that run on OpenMausBot, the bridge that hands them tasks, and the limits each bot works under.

## Language

### Bot permissions

**Approval mode**:
How often a bot must stop and ask the owner before using a tool (`ask`, `edits`, `auto`, `full`, `custom`). It decides how many approval cards appear, never what the bot is able to do.
_Avoid_: permission level, autonomy, bypass

**Hard limits**:
What a bot can never do, whatever its approval mode: the deny rules, readable folders and OS sandbox in the bot's settings file. The copy in the repo is the truth; the installed copy must match it.
_Avoid_: permissions (alone), settings

**Approval card**:
A request in the chat asking the owner to allow or deny one tool call of a bot.
_Avoid_: prompt, popup, confirmation

**Thread override**:
An approval mode chosen for one conversation thread only, kept until changed back; the bot's own approval mode and its other threads are unchanged.
_Avoid_: session allow, temporary mode

### bl3q team

**Merge gate**:
The code (not a bot) that lands an approved bl3q branch on `main` after its own checks; the only thing allowed to move `main`.
_Avoid_: auto-merge, merge bot

**Baseline**:
The set of tests already failing on a given `main` commit; a branch is judged by failures not in it, never by a zero count.
_Avoid_: green suite, known failures

**Guard token**:
A name in the game bot's code that marks a spending safeguard (for example `confirm_dialog`, `_has_vnd`); their count may never drop, in code or in tests.
_Avoid_: money check, safety flag

**Loosened test**:
An existing test changed so it accepts more than before (an assert removed, an expected value moved to match new code) without showing the test itself was wrong.
_Avoid_: test fix, test update

### Skills

**Invoked name**:
The name an agent calls a skill by, and the name its history records each use under: the bare name for a standalone skill, `plugin:name` for a skill shipped in a plugin. A skill's uses are counted by its invoked name.
_Avoid_: skill id, slug

**Namesake**:
One of two or more skills from different sources that share an invoked name, such as `tdd` from two skill collections. History cannot tell namesakes apart by name alone.
_Avoid_: duplicate, conflict, clone

**Manual-only skill**:
A skill the model may never start on its own; it runs only when the owner types its slash command.
_Avoid_: hidden skill, disabled skill
