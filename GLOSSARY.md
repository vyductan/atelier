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
